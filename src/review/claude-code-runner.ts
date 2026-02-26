import { spawn } from "node:child_process";

interface RunClaudeCodeOptions {
  checkoutPath: string;
  promptPath: string;
  mcpConfigPath: string;
  userMessage: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export function runClaudeCode(options: RunClaudeCodeOptions): Promise<string> {
  const {
    checkoutPath,
    promptPath,
    mcpConfigPath,
    userMessage,
    model,
    maxTurns,
    timeoutMs,
  } = options;

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
      reject(
        new Error(`Claude Code timed out after ${timeoutMs}ms\nstderr: ${stderr}`),
      );
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Claude Code exited with code ${code}\nstderr: ${stderr}\nstdout: ${stdout}`,
          ),
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
