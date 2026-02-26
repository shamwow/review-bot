import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

interface RunClaudeCodeOptions {
  checkoutPath: string;
  promptPath: string;
  mcpConfigPath: string;
  userMessage: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  label: string;
}

interface RunClaudeCodeResult {
  output: string;
  reviewCycleId: string;
}

async function saveTranscript(
  reviewCycleId: string,
  stdout: string,
  stderr: string,
): Promise<void> {
  const dir = config.TRANSCRIPT_DIR;
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, `${reviewCycleId}.json`), stdout);

  if (stderr.length > 0) {
    await writeFile(join(dir, `${reviewCycleId}.stderr.log`), stderr);
  }
}

async function pruneTranscripts(keep: number = 30): Promise<void> {
  const dir = config.TRANSCRIPT_DIR;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const withStats = await Promise.all(
    entries.map(async (name) => {
      const fullPath = join(dir, name);
      const s = await stat(fullPath);
      return { fullPath, mtimeMs: s.mtimeMs };
    }),
  );

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const toDelete = withStats.slice(keep);
  await Promise.all(
    toDelete.map((f) => rm(f.fullPath, { force: true })),
  );
}

export function runClaudeCode(
  options: RunClaudeCodeOptions,
): Promise<RunClaudeCodeResult> {
  const {
    checkoutPath,
    promptPath,
    mcpConfigPath,
    userMessage,
    model,
    maxTurns,
    timeoutMs,
    label,
  } = options;

  const reviewCycleId = `${Date.now()}-${label}`;

  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--output-format",
      "json",
      "--model",
      model,
      "--max-turns",
      String(maxTurns),
      "--thinking",
      "enabled",
      "--append-system-prompt-file",
      promptPath,
      "--mcp-config",
      mcpConfigPath,
      "--dangerously-skip-permissions",
    ];

    const child = spawn("claude", args, {
      cwd: checkoutPath,
      env: {
        ...process.env,
        CLAUDECODE: "",
        ...(process.env.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Send user message via stdin
    child.stdin.write(userMessage);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      saveTranscript(reviewCycleId, stdout, stderr)
        .then(() => pruneTranscripts())
        .catch((e) => logger.warn({ err: e }, "Failed to save transcript on timeout"))
        .finally(() => {
          reject(
            new Error(`Claude Code timed out after ${timeoutMs}ms\nstderr: ${stderr}`),
          );
        });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      saveTranscript(reviewCycleId, stdout, stderr)
        .then(() => pruneTranscripts())
        .catch((e) => logger.warn({ err: e }, "Failed to save transcript"))
        .then(() => {
          if (code === 0) {
            resolve({ output: stdout, reviewCycleId });
          } else {
            reject(
              new Error(
                `Claude Code exited with code ${code}\nstderr: ${stderr}\nstdout: ${stdout}`,
              ),
            );
          }
        });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
