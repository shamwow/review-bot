import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BuildResult } from "./types.js";

const execAsync = promisify(exec);

const MAX_OUTPUT_LENGTH = 2000;

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function extractCommands(content: string): string[] {
  const commands: string[] = [];

  // Match fenced code blocks near build/test sections
  const sectionPattern =
    /##?\s*(Build|Test|Quick Reference|Development|Getting Started).*?\n([\s\S]*?)(?=\n##?\s|\n$)/gi;
  let sectionMatch;
  while ((sectionMatch = sectionPattern.exec(content)) !== null) {
    const sectionBody = sectionMatch[2];

    // Extract commands from code blocks
    const codeBlockPattern = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;
    let blockMatch;
    while ((blockMatch = codeBlockPattern.exec(sectionBody)) !== null) {
      const lines = blockMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      commands.push(...lines.map((l) => l.replace(/^\$\s*/, "")));
    }

    // Extract inline commands (lines starting with $)
    const inlinePattern = /^\s*\$\s+(.+)$/gm;
    let inlineMatch;
    while ((inlineMatch = inlinePattern.exec(sectionBody)) !== null) {
      commands.push(inlineMatch[1]);
    }
  }

  return commands;
}

export async function runBuildAndTests(
  checkoutPath: string,
): Promise<BuildResult> {
  const claudeMd = await readFileIfExists(join(checkoutPath, "CLAUDE.md"));
  const readmeMd = await readFileIfExists(join(checkoutPath, "README.md"));

  const allContent = [claudeMd, readmeMd].filter(Boolean).join("\n\n");
  const commands = extractCommands(allContent);

  if (commands.length === 0) {
    return { success: true, output: "No build/test commands found" };
  }

  const outputs: string[] = [];

  for (const cmd of commands) {
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: checkoutPath,
        timeout: 300_000, // 5 minute timeout per command
      });
      outputs.push(`$ ${cmd}\n${stdout}${stderr}`);
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      const failOutput = `$ ${cmd}\n${execErr.stdout ?? ""}${execErr.stderr ?? ""}`;
      outputs.push(failOutput);
      const combined = outputs.join("\n\n");
      return {
        success: false,
        output: combined.slice(-MAX_OUTPUT_LENGTH),
      };
    }
  }

  return {
    success: true,
    output: outputs.join("\n\n"),
  };
}
