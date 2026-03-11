import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";

// __dirname points to dist/integration at runtime; fixtures live in src/integration
const __compiledDir = dirname(fileURLToPath(import.meta.url));
const __fixturesDir = join(__compiledDir, "..", "..", "src", "integration", "fixtures");

export interface TestFixture {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
  baseBranch: string;
  runId: string;
  clonePath: string;
}

export async function createTestPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  token: string,
  runId: string,
  testCase?: string,
): Promise<TestFixture> {
  const clonePath = mkdtempSync(join(tmpdir(), "ironsha-integration-"));
  const branch = `integration-test/${runId}`;
  const patchPath = join(__fixturesDir, "ios-review.patch");

  // Clone the fixture repo
  execSync(
    `git clone https://x-access-token:${token}@github.com/${owner}/${repo}.git .`,
    { cwd: clonePath, stdio: "pipe" },
  );

  // Create and checkout new branch
  execSync(`git checkout -b ${branch}`, { cwd: clonePath, stdio: "pipe" });

  // Apply the patch
  execSync(`git apply ${patchPath}`, { cwd: clonePath, stdio: "pipe" });

  // Commit and push
  execSync(`git add -A`, { cwd: clonePath, stdio: "pipe" });
  execSync(
    `git -c user.name="ironsha-test" -c user.email="test@ironsha" commit -m "[${runId}] test fixture changes"`,
    { cwd: clonePath, stdio: "pipe" },
  );
  execSync(`git push origin ${branch}`, { cwd: clonePath, stdio: "pipe" });

  // Create the PR
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `[${runId}] Fix date picker layout jump and dynamic header spacing`,
    head: branch,
    base: "main",
    body: [
      "## Summary",
      "- measure the dashboard header height dynamically so the scroll content stays aligned when the header switches states",
      "- present the graphical date picker in a fixed-height sheet to prevent the header/layout jump",
      "- add accessibility identifiers for day cells and date picker toolbar buttons to support UI automation",
      "",
      "## Testing",
      "- `build_sim` for scheme `Zenith` on the iPhone 16 simulator: passed",
      "- `test_sim` for scheme `Zenith`: not available because the scheme is not configured for the test action",
      "- manual validation on the iPhone 16 simulator:",
      "  - long-pressed the week strip to open the `Go to Date` sheet",
      "  - verified the sheet presents cleanly and the header remains stable",
      "",
      `<sub>ironsha integration test · ${testCase ? `<b>${testCase}</b> · ` : ""}${runId}</sub>`,
    ].join("\n"),
  });

  return {
    owner,
    repo,
    prNumber: pr.number,
    branch,
    baseBranch: "main",
    runId,
    clonePath,
  };
}

export async function ensureLabelExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color: "ededed",
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 422) throw err;
  }
}

export async function cleanupTestPR(
  octokit: Octokit,
  fixture: TestFixture,
): Promise<void> {
  try {
    await octokit.rest.pulls.update({
      owner: fixture.owner,
      repo: fixture.repo,
      pull_number: fixture.prNumber,
      state: "closed",
    });
  } catch {
    // best-effort
  }

  try {
    await octokit.rest.git.deleteRef({
      owner: fixture.owner,
      repo: fixture.repo,
      ref: `heads/${fixture.branch}`,
    });
  } catch {
    // best-effort
  }
}

export function cleanupClone(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
