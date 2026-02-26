import { Octokit } from "@octokit/rest";

export type CIState = "passed" | "failed" | "pending";

export interface CIResult {
  state: CIState;
  summary: string;
  failedChecks: Array<{ name: string; conclusion: string; url: string | null }>;
}

export async function checkCI(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<CIResult> {
  const [checkRuns, combinedStatus] = await Promise.all([
    octokit.rest.checks.listForRef({ owner, repo, ref }),
    octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref }),
  ]);

  const runs = checkRuns.data.check_runs;
  const statuses = combinedStatus.data.statuses;

  // No CI configured — treat as pass
  if (runs.length === 0 && statuses.length === 0) {
    return {
      state: "passed",
      summary: "No CI checks configured — treating as passed.",
      failedChecks: [],
    };
  }

  const failedChecks: CIResult["failedChecks"] = [];

  // Check Runs (GitHub Actions)
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const conclusion = run.conclusion ?? "unknown";
    if (
      conclusion === "failure" ||
      conclusion === "cancelled" ||
      conclusion === "timed_out"
    ) {
      failedChecks.push({
        name: run.name,
        conclusion,
        url: run.html_url,
      });
    }
  }

  // Commit Statuses (legacy/third-party CI)
  for (const status of statuses) {
    if (status.state === "failure" || status.state === "error") {
      failedChecks.push({
        name: status.context,
        conclusion: status.state,
        url: status.target_url,
      });
    }
  }

  if (failedChecks.length > 0) {
    const names = failedChecks.map((c) => c.name).join(", ");
    return {
      state: "failed",
      summary: `CI failed: ${names}`,
      failedChecks,
    };
  }

  // Check if any are still running
  const pendingRuns = runs.some((r) => r.status !== "completed");
  const pendingStatuses = statuses.some((s) => s.state === "pending");

  if (pendingRuns || pendingStatuses) {
    const completedRuns = runs.filter((r) => r.status === "completed").length;
    const completedStatuses = statuses.filter(
      (s) => s.state !== "pending",
    ).length;
    return {
      state: "pending",
      summary: `CI in progress: ${completedRuns}/${runs.length} check runs, ${completedStatuses}/${statuses.length} statuses completed.`,
      failedChecks: [],
    };
  }

  // All completed, none failed
  const total = runs.length + statuses.length;
  return {
    state: "passed",
    summary: `All ${total} CI checks passed.`,
    failedChecks: [],
  };
}
