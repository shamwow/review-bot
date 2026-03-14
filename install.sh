#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Agents ---
CLAUDE_AGENT_DIR="${HOME}/.claude/agents"
mkdir -p "$CLAUDE_AGENT_DIR"
for agent in implement plan; do
  ln -sf "$SCRIPT_DIR/.claude/agents/$agent.md" "$CLAUDE_AGENT_DIR/$agent.md"
  echo "Installed $agent agent → $CLAUDE_AGENT_DIR/$agent.md (symlink)"
done

# --- Commands ---
CLAUDE_CMD_DIR="${HOME}/.claude/commands"
mkdir -p "$CLAUDE_CMD_DIR"
for cmd in learn save load; do
  ln -sf "$SCRIPT_DIR/commands/$cmd.md" "$CLAUDE_CMD_DIR/$cmd.md"
  echo "Installed /$cmd → $CLAUDE_CMD_DIR/$cmd.md (symlink)"
done

# Install for Codex if codex config dir exists
CODEX_DIR="${HOME}/.codex"
if [ -d "$CODEX_DIR" ]; then
  CODEX_CMD_DIR="$CODEX_DIR/commands"
  mkdir -p "$CODEX_CMD_DIR"
  for cmd in learn save load; do
    ln -sf "$SCRIPT_DIR/commands/$cmd.md" "$CODEX_CMD_DIR/$cmd.md"
    echo "Installed /$cmd → $CODEX_CMD_DIR/$cmd.md (symlink)"
  done
fi

# --- CLAUDE.md lesson lookup instruction ---
CLAUDE_MD="${HOME}/.claude/CLAUDE.md"
LESSONS_MARKER="# Lessons"

if [ -f "$CLAUDE_MD" ] && grep -qF "$LESSONS_MARKER" "$CLAUDE_MD"; then
  echo "Lessons instruction already present in $CLAUDE_MD — skipping."
else
  # Append with a blank line separator if file already has content
  if [ -f "$CLAUDE_MD" ] && [ -s "$CLAUDE_MD" ]; then
    echo "" >> "$CLAUDE_MD"
  fi
  cat >> "$CLAUDE_MD" << 'CLAUDE_INSTRUCTIONS'

# Lessons

Before responding to each user prompt, search for relevant lessons using `qmd query "<query>" --collection project-lessons --collection user-lessons --top 5 2>/dev/null`. Write two queries: one for the **technical approach** (techniques, patterns, frameworks) and one for the **workflow/process** of executing this type of task (e.g. "modifying claude code skills", "shipping a PR", "updating a dependency"). Focus on underlying skills, not surface-level task descriptions. For example, a task about "group food items from a photo on a dashboard" should query for `"SwiftUI expandable list sections API response grouping"`, not `"grouping food entries from photo scan"`. If qmd is not available, skip silently. If results are returned, consider them as context — they contain hard-won lessons from previous sessions. Do not mention that you searched for lessons unless the user asks.
CLAUDE_INSTRUCTIONS
  echo "Added lessons instruction to $CLAUDE_MD"
fi

# Add lesson lookup to AGENTS.md for Codex compatibility
if [ -d "$CODEX_DIR" ]; then
  AGENTS_MD="${CODEX_DIR}/AGENTS.md"
  AGENTS_MARKER="# Lessons"
  if [ -f "$AGENTS_MD" ] && grep -qF "$AGENTS_MARKER" "$AGENTS_MD"; then
    echo "Lessons instruction already present in $AGENTS_MD — skipping."
  else
    if [ -f "$AGENTS_MD" ] && [ -s "$AGENTS_MD" ]; then
      echo "" >> "$AGENTS_MD"
    fi
    cat >> "$AGENTS_MD" << 'AGENTS_INSTRUCTIONS'

# Lessons

Before starting work, read all .lessons/*.md and ~/.codex/.lessons/*.md files for lessons from previous sessions. Consider them as context — they contain hard-won patterns and pitfalls.
AGENTS_INSTRUCTIONS
    echo "Added lessons instruction to $AGENTS_MD"
  fi
fi

# --- Stop hook ---
CLAUDE_SCRIPT_DIR="${HOME}/.claude/scripts"
mkdir -p "$CLAUDE_SCRIPT_DIR"
ln -sf "$SCRIPT_DIR/scripts/stop-hook.sh" "$CLAUDE_SCRIPT_DIR/stop-hook.sh"
echo "Installed stop-hook.sh → $CLAUDE_SCRIPT_DIR/stop-hook.sh (symlink)"

# Add Stop hook to enforce lesson lookup
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
STOP_HOOK_CMD="${CLAUDE_SCRIPT_DIR}/stop-hook.sh"

if command -v jq &>/dev/null; then
  # Create settings.json if it doesn't exist
  [ -f "$CLAUDE_SETTINGS" ] || echo '{}' > "$CLAUDE_SETTINGS"

  # Remove any existing qmd-related Stop hooks, then add the current one
  TMPFILE=$(mktemp)
  jq --arg cmd "$STOP_HOOK_CMD" '
    .hooks //= {} |
    .hooks.Stop //= [] |
    .hooks.Stop = [.hooks.Stop[] | select(.hooks | all(
      ((.command // "" | contains("stop-hook")) or (.prompt // "" | contains("qmd query"))) | not
    ))] |
    .hooks.Stop += [{
      "hooks": [{
        "type": "command",
        "command": $cmd
      }]
    }]
  ' "$CLAUDE_SETTINGS" > "$TMPFILE" && mv "$TMPFILE" "$CLAUDE_SETTINGS"
  echo "Installed Stop hook for lesson lookup enforcement in $CLAUDE_SETTINGS"
else
  echo "Warning: jq not found — could not install Stop hook. Install jq and re-run, or manually add the hook to $CLAUDE_SETTINGS"
fi

echo ""
echo "Done. Available:"
echo "  Agents:   implement, plan"
echo "  Commands: /learn, /save, /load"
