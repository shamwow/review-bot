# Multi-Platform PR Review Bot

## Context

A background service that reviews PRs via a label-driven workflow between two LLM bots (a code submitter bot and this review bot). Supports 4 platforms: **iOS (SwiftUI)**, **Android (Kotlin/Compose)**, **Go webservers**, and **React webapps**. Uses **Claude Code CLI** as the review engine — it can freely explore the codebase, run builds/tests/linters, and produce review comments. Runs as a polling daemon.

## File Structure

```
review-bot/
├── src/
│   ├── index.ts                      # Entry point: start poller
│   ├── poller.ts                     # Poll GitHub API every 60s for labeled PRs
│   ├── config.ts                     # Env var loading/validation
│   ├── logger.ts                     # Pino structured logger
│   ├── github/
│   │   ├── client.ts                # Octokit instance (PAT auth)
│   │   ├── comments.ts             # Fetch existing PR comment threads
│   │   ├── review-poster.ts         # Post PR reviews via GitHub API
│   │   └── labeler.ts               # Swap labels on PRs
│   ├── checkout/
│   │   └── repo-manager.ts          # Clone PR branch into temp dir, prune old dirs
│   ├── review/
│   │   ├── types.ts                  # ReviewResult, CommentThread, etc.
│   │   ├── pipeline.ts              # Orchestrator: clone → build → test → review passes → post
│   │   ├── platform-detector.ts     # Detect project type from file extensions
│   │   ├── build-runner.ts          # Run build/test commands from CLAUDE.md / README.md
│   │   ├── claude-code-runner.ts    # Invoke Claude Code CLI for each review pass
│   │   └── result-parser.ts         # Parse Claude Code output into structured review data
│   ├── prompts/
│   │   ├── base.md                  # Shared preamble (output format, thread handling rules)
│   │   ├── architecture-pass.md     # Pass 1: architecture + ARCHITECTURE.md review
│   │   └── detailed-pass.md         # Pass 2: line-level code quality review
│   └── guides/                       # Review guides shipped with service
│       ├── IOS_CODE_REVIEW.md
│       ├── ANDROID_CODE_REVIEW.md
│       ├── GOLANG_CODE_REVIEW.md
│       └── REACT_CODE_REVIEW.md
├── package.json
├── tsconfig.json
└── .env.example
```

## Key Design: Polling

The bot polls GitHub's search API every **60 seconds** for open PRs with the `bot-review-needed` label. No webhooks, no public endpoint.

**Authentication**: GitHub Personal Access Token (PAT) via `@octokit/rest`.

**Poll query**: `GET /search/issues?q=is:pr+is:open+label:bot-review-needed+org:{ORG}`

**Deduplication**: In-memory `Set<string>` tracks PRs currently being processed to avoid double-processing across consecutive polls.

## Key Design: Claude Code CLI as Review Engine

Instead of crafting manual API calls, building dependency graphs, and parsing linter output ourselves, the bot invokes **Claude Code CLI** (`claude`) against the checked-out repo. Claude Code can:

- Read any file in the repo (follows references, explores dependencies)
- Run the project's linter via the terminal
- Run builds and tests via the terminal
- Understand `CLAUDE.md`, `README.md`, and `ARCHITECTURE.md` natively
- Produce structured output via `--output-format json`

The bot invokes Claude Code via `child_process.execFile`:

```bash
claude --print \
  --output-format json \
  --model {CLAUDE_MODEL} \
  --max-turns {MAX_REVIEW_TURNS} \
  --thinking \
  --append-system-prompt-file {prompt_file} \
  --mcp-config {mcp_config_path} \
  --dangerously-skip-permissions \
  "{user_message}"
```

Key flags:
- `--print` — non-interactive (single prompt in, response out)
- `--output-format json` — structured results
- `--model {CLAUDE_MODEL}` — configurable model, defaults to `claude-opus-4-6`
- `--max-turns {MAX_REVIEW_TURNS}` — configurable max agentic turns, defaults to `30`
- `--thinking` — enables extended thinking for higher-quality reasoning during review
- `--append-system-prompt-file` — adds review instructions **on top of** Claude Code's default prompt, preserving its built-in tools (Read, Grep, Glob, Bash, etc.)
- `--mcp-config` — loads custom MCP server providing GitHub comment tools
- `--dangerously-skip-permissions` — skips permission prompts (safe in our controlled CI context)
- Working directory is set to the checkout path, so Claude Code reads `CLAUDE.md` and `ARCHITECTURE.md` from the repo automatically

### Why `--append-system-prompt-file` not `--system-prompt-file`

`--system-prompt` replaces the entire default prompt — Claude Code loses its built-in tools and behaviors. `--append-system-prompt-file` adds our review instructions while preserving Claude Code's default capabilities (file reading, terminal access, glob/grep, etc.). This is critical — we want Claude Code to behave like Claude Code, with additional review-specific guidance.

## Key Design: GitHub MCP Server for PR Comments

Instead of pre-fetching all comment threads and stuffing them into the prompt, we give Claude Code the official [GitHub MCP server](https://github.com/github/github-mcp-server) (`@github/mcp-server`). This provides tools to list PR comments, read thread details, and more — on demand during the review.

**MCP config passed to Claude Code:**
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@github/mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "{token}"
      }
    }
  }
}
```

The pipeline writes this config to a temp file before each Claude Code invocation. The user message tells Claude Code which PR to review (owner/repo/number), and it uses the GitHub MCP tools to fetch comments, threads, and diff context as needed.

## Key Design: System Prompt Architecture

The system prompt is composed from layers, tuned per review pass and per platform.

### Prompt layers

```
[Claude Code default prompt]          ← preserved via --append-system-prompt-file
  + base.md                           ← shared rules: output format, thread handling, "REVIEW BOT RESOLVED" semantics
  + {pass}-specific instructions      ← architecture-pass.md OR detailed-pass.md
  + {PLATFORM}_CODE_REVIEW.md         ← platform-specific review guide
```

These are concatenated into a single file before invocation. The pipeline builds a temp prompt file per pass:

```typescript
const prompt = [
  readFileSync("prompts/base.md"),
  readFileSync(`prompts/${pass}.md`),
  readFileSync(`guides/${platform}_CODE_REVIEW.md`),
].join("\n\n---\n\n");
writeFileSync(tempPromptPath, prompt);
```

## Key Design: Build + Test Gate

Before running the review, the bot runs the project's build and test commands. These are discovered from `CLAUDE.md` or `README.md` in the repo (each project documents its build/test commands there).

**If build or tests fail:**
- The bot posts a comment with the failure output (truncated to a reasonable length)
- Removes all labels, adds `bot-changes-needed`
- Skips the Claude Code review passes entirely (fail fast)

**If build and tests pass:** proceed to the two-pass review.

## Key Design: Two-Pass Review via Claude Code

Each review cycle runs **two Claude Code sessions** sequentially against the checkout:

### Pass 1: Architecture Review
High-level review focused on design and structure. Reads `ARCHITECTURE.md`, evaluates structural impact, flags if `ARCHITECTURE.md` needs updating.

### Pass 2: Detailed Line-Level Review
Granular review focused on code quality. Runs the project's linter, reviews for correctness, performance, memory management, error handling, security, and testing gaps.

### Merging Results
- Combine architecture + detail comments, deduplicate by file+line proximity
- Merge thread responses — Pass 1 takes precedence on conflicts
- Validate every unresolved thread has a response

## Key Design: Label-Driven Review Cycle

### Labels

| Label | Meaning | Applied by |
|---|---|---|
| `bot-review-needed` | PR is ready for the review bot to examine | Code submitter bot |
| `bot-changes-needed` | Review bot found issues; submitter must respond | Review bot |
| `human-review-needed` | Review bot approved; ready for human | Review bot |

### Lifecycle

```
Code submitter opens PR, adds `bot-review-needed`
  │
  ▼
Poller finds PR → runs full pipeline:
  1. Clone PR branch into temp dir
  2. Run build + tests (from CLAUDE.md / README.md)
  │
  ├─ Build/tests fail:
  │   Post failure comment, remove all labels, add `bot-changes-needed`
  │
  └─ Build/tests pass:
      3. Pass 1: Claude Code architecture review
      4. Pass 2: Claude Code detailed review
      5. Merge results, validate thread coverage
      │
      ├─ Unresolved comments remain:
      │   Post new comments, reply to threads
      │   Remove all labels, add `bot-changes-needed`
      │
      └─ No unresolved comments:
          Reply "REVIEW BOT RESOLVED" on all open threads
          Post "LGTM" review
          Remove all labels, add `human-review-needed`
```

Adding any label **removes all other bot labels first**. Only one label is active at a time.

## Key Design: Platform Detection

`platform-detector.ts` inspects file extensions in the diff to select the review guide:

| Extension pattern | Platform | Guide file |
|---|---|---|
| `*.swift` | ios | `IOS_CODE_REVIEW.md` |
| `*.kt`, `*.kts` | android | `ANDROID_CODE_REVIEW.md` |
| `*.go` | golang | `GOLANG_CODE_REVIEW.md` |
| `*.tsx`, `*.ts`, `*.jsx` | react | `REACT_CODE_REVIEW.md` |
