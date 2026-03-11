import "dotenv/config";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const OWNER = "shamwow";
const REPO = "ironsha-ios-test-fixture";
const BOT_LABELS = [
  "bot-review-needed",
  "bot-changes-needed",
  "human-review-needed",
];

// Set config env vars before any ironsha imports
process.env.WORK_DIR = "/tmp/ironsha-integration-test";
process.env.TRANSCRIPT_DIR = "/tmp/ironsha-integration-test/transcripts";

describe("iOS review integration", { timeout: 900_000, skip: !GITHUB_TOKEN }, async () => {
  // Dynamic imports so config picks up our env overrides
  const { createTestPR, ensureLabelExists, cleanupTestPR, cleanupClone } =
    await import("./helpers.js");
  const { pollForLabel } = await import("../poller.js");
  const { runReviewPipeline } = await import("../review/pipeline.js");

  const useMockLlm =
    process.env.npm_lifecycle_event === "test:integration:mock_llm";
  const mockAgent = useMockLlm
    ? (await import("./mock-agent.js")).mockAgentRunner
    : undefined;

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  // Ensure labels exist once for the suite
  for (const label of BOT_LABELS) {
    await ensureLabelExists(octokit, OWNER, REPO, label);
  }

  // Track all fixtures for cleanup
  const fixtures: Awaited<ReturnType<typeof createTestPR>>[] = [];

  after(async () => {
    for (const f of fixtures) {
      await cleanupTestPR(octokit, f);
      cleanupClone(f.clonePath);
    }
  });

  const pollerTest = "poller discovers the PR by title filter";
  it(pollerTest, async () => {
    const runId = `ironsha-t-${randomBytes(6).toString("hex")}`;
    const fixture = await createTestPR(octokit, OWNER, REPO, GITHUB_TOKEN!, runId, pollerTest);
    fixtures.push(fixture);

    await octokit.rest.issues.addLabels({
      owner: OWNER,
      repo: REPO,
      issue_number: fixture.prNumber,
      labels: ["bot-review-needed"],
    });

    const discovered: import("../review/types.js").PRInfo[] = [];

    // Retry polling — GitHub's API may not surface the label immediately
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await pollForLabel(
        octokit,
        "bot-review-needed",
        async (_oct, pr) => {
          discovered.push(pr);
        },
        runId,
      );
      if (discovered.length > 0) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }

    assert.equal(discovered.length, 1, "handler should be called exactly once");
    assert.equal(discovered[0].owner, OWNER);
    assert.equal(discovered[0].repo, REPO);
    assert.equal(discovered[0].number, fixture.prNumber);
    assert.ok(discovered[0].title.includes(runId));
  });

  const pipelineTest = "full review pipeline posts comments and swaps labels";
  it(pipelineTest, async () => {
    const runId = `ironsha-t-${randomBytes(6).toString("hex")}`;
    const fixture = await createTestPR(octokit, OWNER, REPO, GITHUB_TOKEN!, runId, pipelineTest);
    fixtures.push(fixture);

    await octokit.rest.issues.addLabels({
      owner: OWNER,
      repo: REPO,
      issue_number: fixture.prNumber,
      labels: ["bot-review-needed"],
    });

    const prInfo: import("../review/types.js").PRInfo = {
      owner: fixture.owner,
      repo: fixture.repo,
      number: fixture.prNumber,
      branch: fixture.branch,
      baseBranch: fixture.baseBranch,
      title: `[${runId}] Fix date picker layout jump and dynamic header spacing`,
    };

    await runReviewPipeline(octokit, prInfo, mockAgent);

    // Check that the PR has at least one review or comment
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner: OWNER,
      repo: REPO,
      pull_number: fixture.prNumber,
    });
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: OWNER,
      repo: REPO,
      issue_number: fixture.prNumber,
    });
    // Fail if any comment is an error posted by the pipeline
    const errorComments = comments.filter((c) =>
      c.body?.includes("Ironsha Error"),
    );
    assert.equal(
      errorComments.length,
      0,
      `Pipeline posted error comment(s):\n${errorComments.map((c) => c.body).join("\n---\n")}`,
    );

    const totalFeedback = reviews.length + comments.length;
    assert.ok(totalFeedback > 0, "PR should have at least one review or comment");

    // Check labels
    const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
      owner: OWNER,
      repo: REPO,
      issue_number: fixture.prNumber,
    });
    const labelNames = labels.map((l) => l.name);

    assert.ok(
      !labelNames.includes("bot-review-needed"),
      "bot-review-needed label should be removed",
    );
    assert.ok(
      labelNames.includes("bot-changes-needed") ||
        labelNames.includes("human-review-needed"),
      "either bot-changes-needed or human-review-needed label should be present",
    );
  });
});
