function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Environment variable ${name} must be a number, got: "${raw}"`,
    );
  }
  return parsed;
}

export const config = {
  GITHUB_TOKEN: requireEnv("GITHUB_TOKEN"),
  ANTHROPIC_API_KEY: optionalEnv("ANTHROPIC_API_KEY", ""),

  CLAUDE_MODEL: optionalEnv("CLAUDE_MODEL", "claude-opus-4-6"),
  MAX_REVIEW_TURNS: optionalNumericEnv("MAX_REVIEW_TURNS", 30),
  POLL_INTERVAL_MS: optionalNumericEnv("POLL_INTERVAL_MS", 60_000),
  REVIEW_TIMEOUT_MS: optionalNumericEnv("REVIEW_TIMEOUT_MS", 600_000),
  WORK_DIR: optionalEnv("WORK_DIR", "/tmp/review-bot"),
  TRANSCRIPT_DIR: optionalEnv("TRANSCRIPT_DIR", "/tmp/review-bot/transcripts"),
  LOG_LEVEL: optionalEnv("LOG_LEVEL", "info"),
} as const;
