import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runReviewPipeline } from "./review/pipeline.js";
import { runWritePipeline } from "./writer/pipeline.js";
import { handleCIPending } from "./writer/ci-handler.js";
import type { PRInfo } from "./review/types.js";

const processing = new Set<string>();

async function pollForLabel(
  octokit: Octokit,
  label: string,
  handler: (octokit: Octokit, pr: PRInfo) => Promise<void>,
): Promise<void> {
  logger.debug({ label }, "Polling for PRs with label");

  // List all repos the token has access to (owned + collaborator)
  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    affiliation: "owner,collaborator",
    per_page: 100,
  });

  logger.debug({ repoCount: repos.length, label }, "Fetched accessible repos");

  for (const repo of repos) {
    // List open issues/PRs with the label
    const issues = await octokit.rest.issues.listForRepo({
      owner: repo.owner.login,
      repo: repo.name,
      labels: label,
      state: "open",
      per_page: 30,
    });

    // Filter to only pull requests (issues with pull_request field)
    const prs = issues.data.filter((issue) => issue.pull_request);

    for (const item of prs) {
      const key = `${repo.owner.login}/${repo.name}#${item.number}`;
      if (processing.has(key)) {
        logger.debug({ key }, "Skipping PR already being processed");
        continue;
      }

      const { data: pr } = await octokit.rest.pulls.get({
        owner: repo.owner.login,
        repo: repo.name,
        pull_number: item.number,
      });

      const prInfo: PRInfo = {
        owner: repo.owner.login,
        repo: repo.name,
        number: item.number,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        title: pr.title,
      };

      processing.add(key);
      logger.info({ pr: key, title: prInfo.title, label }, "Starting pipeline");

      // Run pipeline without awaiting — allows concurrent processing
      handler(octokit, prInfo)
        .catch((err) => {
          logger.error({ pr: key, err }, "Pipeline failed unexpectedly");
        })
        .finally(() => {
          processing.delete(key);
        });
    }
  }
}

async function pollOnce(octokit: Octokit): Promise<void> {
  await pollForLabel(octokit, "bot-review-needed", runReviewPipeline);
  await pollForLabel(octokit, "bot-changes-needed", runWritePipeline);
  await pollForLabel(octokit, "bot-ci-pending", handleCIPending);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startPoller(octokit: Octokit): void {
  logger.info(
    { intervalMs: config.POLL_INTERVAL_MS },
    "Starting poller",
  );

  // Run immediately on start
  pollOnce(octokit).catch((err) => {
    logger.error({ err }, "Initial poll failed");
  });

  intervalId = setInterval(() => {
    pollOnce(octokit).catch((err) => {
      logger.error({ err }, "Poll cycle failed");
    });
  }, config.POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down poller");
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    // Wait for in-progress reviews to complete
    if (processing.size > 0) {
      logger.info(
        { count: processing.size },
        "Waiting for in-progress reviews to complete",
      );
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
