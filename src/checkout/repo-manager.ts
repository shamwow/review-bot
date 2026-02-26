import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ClonePROptions {
  owner: string;
  repo: string;
  branch: string;
  prNumber: number;
  token: string;
  workDir: string;
}

export async function clonePR(options: ClonePROptions): Promise<string> {
  const { owner, repo, branch, prNumber, token, workDir } = options;
  const targetDir = join(
    workDir,
    `review-${owner}-${repo}-${prNumber}-${Date.now()}`,
  );

  await mkdir(workDir, { recursive: true });

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await execFileAsync("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    branch,
    cloneUrl,
    targetDir,
  ]);

  return targetDir;
}

export async function pruneCheckouts(
  workDir: string,
  keep: number = 30,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(workDir);
  } catch {
    return; // workDir doesn't exist yet
  }

  const reviewDirs = entries.filter((e) => e.startsWith("review-"));

  // Get stats for sorting by creation time
  const withStats = await Promise.all(
    reviewDirs.map(async (name) => {
      const fullPath = join(workDir, name);
      const s = await stat(fullPath);
      return { name, fullPath, mtimeMs: s.mtimeMs };
    }),
  );

  // Sort newest first
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Delete everything beyond `keep`
  const toDelete = withStats.slice(keep);
  await Promise.all(
    toDelete.map((dir) => rm(dir.fullPath, { recursive: true, force: true })),
  );
}
