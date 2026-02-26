import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { startPoller } from "./poller.js";

const octokit = new Octokit({ auth: config.GITHUB_TOKEN });

logger.info(
  { org: config.GITHUB_ORG, model: config.CLAUDE_MODEL },
  "review-bot starting",
);

startPoller(octokit);
