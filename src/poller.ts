import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runReviewPipeline } from "./review/pipeline.js";
import type { PRInfo } from "./review/types.js";

const processing = new Set<string>();

async function pollOnce(octokit: Octokit): Promise<void> {
  logger.debug("Polling for PRs with bot-review-needed label");

  const query = `is:pr is:open label:bot-review-needed org:${config.GITHUB_ORG}`;
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 30,
  });

  logger.debug({ count: data.total_count }, "Found PRs");

  for (const item of data.items) {
    const key = `${item.repository_url}#${item.number}`;
    if (processing.has(key)) {
      logger.debug({ key }, "Skipping PR already being processed");
      continue;
    }

    // Extract owner/repo from repository_url
    // Format: https://api.github.com/repos/{owner}/{repo}
    const repoMatch = item.repository_url.match(/repos\/([^/]+)\/([^/]+)$/);
    if (!repoMatch) {
      logger.warn({ url: item.repository_url }, "Could not parse repository URL");
      continue;
    }

    const [, owner, repo] = repoMatch;

    // Get the PR details to find the branch
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: item.number,
    });

    const prInfo: PRInfo = {
      owner,
      repo,
      number: item.number,
      branch: pr.head.ref,
      title: pr.title,
    };

    processing.add(key);
    logger.info({ pr: key, title: prInfo.title }, "Starting review pipeline");

    // Run pipeline without awaiting — allows concurrent reviews
    runReviewPipeline(octokit, prInfo)
      .catch((err) => {
        logger.error({ pr: key, err }, "Pipeline failed unexpectedly");
      })
      .finally(() => {
        processing.delete(key);
      });
  }
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
