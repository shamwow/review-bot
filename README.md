# review-bot

A polling daemon that reviews pull requests using Claude Code CLI. Supports iOS (SwiftUI), Android (Kotlin/Compose), Go webservers, and React webapps.

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`claude` available on PATH)
- A GitHub Personal Access Token with `repo` and `read:org` scopes

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Fill in your `.env`:
   ```bash
   # Required
   GITHUB_TOKEN=ghp_your_token_here

   # Claude authentication (pick one):
   #   Option 1: API key
   ANTHROPIC_API_KEY=sk-ant-your_key_here
   #   Option 2: Max plan — run `claude login` first, leave ANTHROPIC_API_KEY unset
   ```

   The token must belong to the GitHub account that will post reviews. The bot polls all repos this account owns or is a collaborator on.

## Running

Development (with file watching):
```bash
npm run dev
```

Production:
```bash
npm start
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with `repo` and `read:org` scopes |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key. Omit if using Max plan auth |
| `CLAUDE_MODEL` | No | `claude-opus-4-6` | Model for review passes |
| `MAX_REVIEW_TURNS` | No | `30` | Max agentic turns per review pass |
| `POLL_INTERVAL_MS` | No | `60000` | Polling interval in milliseconds |
| `REVIEW_TIMEOUT_MS` | No | `600000` | Timeout per Claude Code invocation |
| `WORK_DIR` | No | `/tmp/review-bot` | Directory for cloning PR branches |
| `TRANSCRIPT_DIR` | No | `/tmp/review-bot/transcripts` | Directory for Claude Code transcript logs |
| `LOG_LEVEL` | No | `info` | Log level (`debug`, `info`, `warn`, `error`) |

## Debugging with Claude Code

Since review-bot spawns `claude` CLI as a child process, you cannot run it directly from inside a Claude Code session (nested sessions are blocked). Use this workflow instead:

1. Start review-bot in a **separate terminal** (not inside Claude Code):
   ```bash
   npm run dev
   ```

2. Open Claude Code in another terminal to make code changes. The `npm run dev` file watcher (`tsx watch`) will automatically restart the bot when source files change.

3. After making changes, Claude Code should trigger a review cycle and wait for it to complete:
   - Swap the label on the target PR:
     ```bash
     gh pr edit <number> --repo <owner>/<repo> \
       --remove-label "bot-changes-needed" \
       --add-label "bot-review-needed"
     ```
   - Poll the PR labels until `bot-review-needed` is replaced (the bot swaps it to `bot-changes-needed` or `human-review-needed` when done):
     ```bash
     while gh pr view <number> --repo <owner>/<repo> --json labels \
       | jq -e '.labels[].name == "bot-review-needed"' > /dev/null 2>&1; do
       sleep 10
     done
     ```
   - Check the result by reading the latest PR comments and the final label.

## How it works

The bot polls GitHub every 60 seconds for open PRs with the `bot-review-needed` label across all repos the token has access to. For each PR it finds:

1. Clones the PR branch into a temp directory
2. Runs the project's build and test commands (from `CLAUDE.md` or `README.md`)
3. If build/tests pass, runs two Claude Code review passes (architecture + detailed)
4. Posts review comments and swaps labels (`bot-changes-needed` or `human-review-needed`)

See [ARCHITECTURE.md](ARCHITECTURE.md) for full design details and [CONTRIBUTING.md](CONTRIBUTING.md) for the LLM compatibility guide.
