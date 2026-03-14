#!/usr/bin/env bash
set -euo pipefail

# --- Agents ---
for agent in implement plan; do
  rm -f "${HOME}/.claude/agents/$agent.md"
  echo "Removed $agent agent"
done

# --- Commands ---
for cmd in learn save load; do
  rm -f "${HOME}/.claude/commands/$cmd.md"
  echo "Removed /$cmd command"
done

# Remove Codex commands if present
for cmd in learn save load; do
  rm -f "${HOME}/.codex/commands/$cmd.md"
done

# --- Stop hook ---
rm -f "${HOME}/.claude/scripts/stop-hook.sh"
echo "Removed stop-hook.sh"

# Remove Stop hook entry from settings.json
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
if [ -f "$CLAUDE_SETTINGS" ] && command -v jq &>/dev/null; then
  TMPFILE=$(mktemp)
  jq '
    if .hooks?.Stop then
      .hooks.Stop = [.hooks.Stop[] | select(.hooks | all(
        ((.command // "" | contains("stop-hook")) or (.prompt // "" | contains("qmd query"))) | not
      ))] |
      if .hooks.Stop == [] then del(.hooks.Stop) else . end |
      if .hooks == {} then del(.hooks) else . end
    else . end
  ' "$CLAUDE_SETTINGS" > "$TMPFILE" && mv "$TMPFILE" "$CLAUDE_SETTINGS"
  echo "Removed Stop hook from $CLAUDE_SETTINGS"
fi

echo ""
echo "Done. All ironsha components uninstalled."
