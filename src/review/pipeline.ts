import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clonePR, pruneCheckouts } from "../checkout/repo-manager.js";
import { setLabel } from "../github/labeler.js";
import { postReview } from "../github/review-poster.js";
import {
  postResolvedReply,
  postGeneralComment,
} from "../github/comments.js";
import { runBuildAndTests } from "./build-runner.js";
import { runClaudeCode } from "./claude-code-runner.js";
import { detectPlatform } from "./platform-detector.js";
import { parseArchitectureResult, parseDetailedResult } from "./result-parser.js";
import type {
  PRInfo,
  MergedReviewResult,
  ReviewComment,
  ThreadResponse,
} from "./types.js";

function buildPromptFile(pass: "architecture-pass" | "detailed-pass", platform: string): string {
  const promptsDir = join(import.meta.dirname, "..", "prompts");
  const guidesDir = join(import.meta.dirname, "..", "guides");

  const base = readFileSync(join(promptsDir, "base.md"), "utf-8");
  const passPrompt = readFileSync(join(promptsDir, `${pass}.md`), "utf-8");
  const guide = readFileSync(
    join(guidesDir, `${platform.toUpperCase()}_CODE_REVIEW.md`),
    "utf-8",
  );

  const combined = [base, passPrompt, guide].join("\n\n---\n\n");

  const tempDir = join(tmpdir(), "review-bot-prompts");
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `${pass}-${platform}-${Date.now()}.md`);
  writeFileSync(tempPath, combined);
  return tempPath;
}

function buildMcpConfig(token: string): string {
  const mcpConfig = {
    mcpServers: {
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@github/mcp-server"],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: token,
        },
      },
    },
  };

  const tempDir = join(tmpdir(), "review-bot-mcp");
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `mcp-config-${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(mcpConfig, null, 2));
  return tempPath;
}

function mergeResults(
  archResult: ReturnType<typeof parseArchitectureResult>,
  detailResult: ReturnType<typeof parseDetailedResult>,
): MergedReviewResult {
  // Combine comments, dedup by file+line proximity
  const allComments: ReviewComment[] = [
    ...archResult.architecture_comments,
    ...detailResult.detail_comments,
  ];

  const deduped: ReviewComment[] = [];
  for (const comment of allComments) {
    const isDuplicate = deduped.some(
      (existing) =>
        existing.path === comment.path &&
        existing.line !== null &&
        comment.line !== null &&
        Math.abs(existing.line - comment.line) <= 2 &&
        existing.body === comment.body,
    );
    if (!isDuplicate) {
      deduped.push(comment);
    }
  }

  // Merge thread responses — architecture pass takes precedence
  const threadMap = new Map<string, ThreadResponse>();
  for (const tr of detailResult.thread_responses) {
    threadMap.set(tr.thread_id, tr);
  }
  for (const tr of archResult.thread_responses) {
    threadMap.set(tr.thread_id, tr); // overwrites detail pass
  }

  const summaryParts = [archResult.summary, detailResult.summary].filter(
    Boolean,
  );

  return {
    comments: deduped,
    thread_responses: Array.from(threadMap.values()),
    architecture_update_needed: archResult.architecture_update_needed,
    summary: summaryParts.join("\n\n") || "Review complete.",
  };
}

function makeFooter(threadId: string, reviewId?: string): string {
  const tag = reviewId
    ? `thread::${threadId} | review::${reviewId}`
    : `thread::${threadId}`;
  return `\n\n---\n<sub>${tag}</sub>`;
}

export async function runReviewPipeline(
  octokit: Octokit,
  pr: PRInfo,
): Promise<void> {
  const log = logger.child({
    pr: `${pr.owner}/${pr.repo}#${pr.number}`,
  });

  let checkoutPath: string | undefined;
  let reviewId: string | undefined;

  try {
    // 1. Clone PR branch
    log.info("Cloning PR branch");
    checkoutPath = await clonePR({
      owner: pr.owner,
      repo: pr.repo,
      branch: pr.branch,
      prNumber: pr.number,
      token: config.GITHUB_TOKEN,
      workDir: config.WORK_DIR,
    });
    log.info({ checkoutPath }, "Cloned successfully");

    // 2. Run build + tests
    log.info("Running build and tests");
    const buildResult = await runBuildAndTests(checkoutPath);

    if (!buildResult.success) {
      log.warn("Build/tests failed, posting failure comment");
      await postGeneralComment(
        octokit,
        pr.owner,
        pr.repo,
        pr.number,
        `## Build/Test Failure\n\n\`\`\`\n${buildResult.output}\n\`\`\`` + makeFooter(randomUUID()),
      );
      await setLabel(octokit, pr.owner, pr.repo, pr.number, "bot-changes-needed");
      return;
    }
    log.info("Build and tests passed");

    // 3. Detect platform
    const platform = detectPlatform([pr.branch]); // Will be overridden by diff files
    // Get changed files from the PR for better platform detection
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      per_page: 100,
    });
    const detectedPlatform = detectPlatform(files.map((f) => f.filename));

    if (!detectedPlatform) {
      log.warn("Could not detect platform from changed files");
      await postGeneralComment(
        octokit,
        pr.owner,
        pr.repo,
        pr.number,
        "Could not detect project platform from changed files. Skipping review." + makeFooter(randomUUID()),
      );
      await setLabel(octokit, pr.owner, pr.repo, pr.number, "bot-changes-needed");
      return;
    }
    log.info({ platform: detectedPlatform }, "Detected platform");

    // 4. Build prompt files and MCP config
    const archPromptPath = buildPromptFile("architecture-pass", detectedPlatform);
    const detailPromptPath = buildPromptFile("detailed-pass", detectedPlatform);
    const mcpConfigPath = buildMcpConfig(config.GITHUB_TOKEN);

    const userMessage = [
      `Review PR #${pr.number} in ${pr.owner}/${pr.repo}.`,
      `Title: ${pr.title}`,
      `Branch: ${pr.branch}`,
      `Use the GitHub MCP tools to read PR comments and threads.`,
      `Read the diff with: git diff origin/main...HEAD`,
    ].join("\n");

    // Generate a single review ID for this pipeline run
    reviewId = randomUUID();
    log.info({ reviewId }, "Generated review ID");

    // 5. Pass 1: Architecture review
    log.info("Running architecture review pass");
    const archRaw = await runClaudeCode({
      checkoutPath,
      promptPath: archPromptPath,
      mcpConfigPath,
      userMessage,
      model: config.CLAUDE_MODEL,
      maxTurns: config.MAX_REVIEW_TURNS,
      timeoutMs: config.REVIEW_TIMEOUT_MS,
      reviewId,
      pass: "architecture",
    });
    const archResult = parseArchitectureResult(archRaw);
    log.info(
      {
        comments: archResult.architecture_comments.length,
        threads: archResult.thread_responses.length,
        reviewId,
      },
      "Architecture pass complete",
    );

    // 6. Pass 2: Detailed review
    log.info("Running detailed review pass");
    const detailRaw = await runClaudeCode({
      checkoutPath,
      promptPath: detailPromptPath,
      mcpConfigPath,
      userMessage,
      model: config.CLAUDE_MODEL,
      maxTurns: config.MAX_REVIEW_TURNS,
      timeoutMs: config.REVIEW_TIMEOUT_MS,
      reviewId,
      pass: "detailed",
    });
    const detailResult = parseDetailedResult(detailRaw);
    log.info(
      {
        comments: detailResult.detail_comments.length,
        threads: detailResult.thread_responses.length,
        reviewId,
      },
      "Detailed pass complete",
    );

    // 7. Merge results
    const merged = mergeResults(archResult, detailResult);

    // 8. Post results
    // Post "REVIEW BOT RESOLVED" on resolved threads
    for (const tr of merged.thread_responses) {
      if (tr.resolved) {
        const footer = makeFooter(randomUUID(), reviewId);
        try {
          await postResolvedReply(
            octokit,
            pr.owner,
            pr.repo,
            pr.number,
            Number(tr.thread_id),
            footer,
          );
        } catch (err: any) {
          if (err?.status === 404) {
            // Not an inline review comment — fall back to general comment
            log.info({ threadId: tr.thread_id }, "Inline reply 404, falling back to general comment");
            try {
              await postGeneralComment(
                octokit,
                pr.owner,
                pr.repo,
                pr.number,
                `REVIEW BOT RESOLVED (thread::${tr.thread_id})${footer}`,
              );
            } catch (fallbackErr) {
              log.warn({ threadId: tr.thread_id, err: fallbackErr }, "Failed to post resolved fallback comment");
            }
          } else {
            log.warn({ threadId: tr.thread_id, err }, "Failed to post resolved reply");
          }
        }
      }
    }

    // Post feedback on unresolved threads
    for (const tr of merged.thread_responses) {
      if (!tr.resolved && tr.response) {
        const footer = makeFooter(randomUUID(), reviewId);
        try {
          await octokit.rest.pulls.createReplyForReviewComment({
            owner: pr.owner,
            repo: pr.repo,
            pull_number: pr.number,
            comment_id: Number(tr.thread_id),
            body: tr.response + footer,
          });
        } catch (err) {
          log.warn({ threadId: tr.thread_id, err }, "Failed to post thread response");
        }
      }
    }

    // Post new review comments
    if (merged.comments.length > 0) {
      const commentsWithFooter = merged.comments.map((c) => ({
        ...c,
        body: c.body + makeFooter(randomUUID(), reviewId),
      }));
      await postReview(
        octokit,
        pr.owner,
        pr.repo,
        pr.number,
        commentsWithFooter,
        merged.summary + makeFooter(randomUUID(), reviewId),
      );
    }

    // Post architecture update request if needed
    if (merged.architecture_update_needed.needed) {
      await postGeneralComment(
        octokit,
        pr.owner,
        pr.repo,
        pr.number,
        `## ARCHITECTURE.md Update Needed\n\n${merged.architecture_update_needed.reason ?? "This PR changes the project architecture. Please update ARCHITECTURE.md."}` + makeFooter(randomUUID(), reviewId),
      );
    }

    // 9. Determine outcome and swap labels
    const hasUnresolved = merged.thread_responses.some((tr) => !tr.resolved);
    const hasNewComments = merged.comments.length > 0;

    if (hasUnresolved || hasNewComments) {
      log.info("Review has unresolved items, requesting changes");
      await setLabel(octokit, pr.owner, pr.repo, pr.number, "bot-changes-needed");
    } else {
      log.info("Review passed, marking for human review");
      if (merged.comments.length === 0) {
        await postGeneralComment(
          octokit,
          pr.owner,
          pr.repo,
          pr.number,
          `LGTM! All review comments have been addressed.` + makeFooter(randomUUID(), reviewId),
        );
      }
      await setLabel(octokit, pr.owner, pr.repo, pr.number, "human-review-needed");
    }

    // 10. Prune old checkouts
    await pruneCheckouts(config.WORK_DIR, 30);
  } catch (err) {
    log.error({ err }, "Review pipeline failed");
    try {
      await postGeneralComment(
        octokit,
        pr.owner,
        pr.repo,
        pr.number,
        `## Review Bot Error\n\nThe review pipeline encountered an error. Please check the bot logs.\n\n\`\`\`\n${String(err)}\n\`\`\`` + makeFooter(randomUUID(), reviewId),
      );
      await setLabel(octokit, pr.owner, pr.repo, pr.number, "bot-changes-needed");
    } catch (postErr) {
      log.error({ postErr }, "Failed to post error comment");
    }
  }
}
