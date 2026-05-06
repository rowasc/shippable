#!/usr/bin/env bash
# First-time setup for the sandboxed Claude Code devcontainer.
# Idempotent — safe to re-run.
#
# Run once:   bash .devcontainer/setup.sh
# Then:       yolo (from any worktree)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

absolute_git_dir="$(cd "$SCRIPT_DIR" && git rev-parse --absolute-git-dir 2>/dev/null || true)"
case "$absolute_git_dir" in
    */worktrees/*) main_git="${absolute_git_dir%/worktrees/*}" ;;
    "")            echo "ERROR: not inside a git repository" >&2; exit 1 ;;
    *)             main_git="$absolute_git_dir" ;;
esac
repo_root="$(dirname "$main_git")"

shell_rc="$HOME/.zshrc"
[[ -f "$HOME/.bashrc" && ! -f "$shell_rc" ]] && shell_rc="$HOME/.bashrc"

command -v docker >/dev/null 2>&1 \
    || { echo "ERROR: docker CLI not found. Install docker (and an engine like Colima)." >&2; exit 1; }
docker ps >/dev/null 2>&1 \
    || { echo "ERROR: docker engine not reachable. Start it (e.g. 'colima start')." >&2; exit 1; }

if ! grep -q "^export SHIPPABLE_HOST_REPO=" "$shell_rc" 2>/dev/null; then
    {
        echo ""
        echo "# Sandboxed Claude Code (.devcontainer/setup.sh)"
        echo "export SHIPPABLE_HOST_REPO=\"$repo_root\""
    } >> "$shell_rc"
    echo "added SHIPPABLE_HOST_REPO=\"$repo_root\" to $shell_rc"
fi

if ! grep -q "^yolo()" "$shell_rc" 2>/dev/null; then
    cat >> "$shell_rc" <<'EOF'

yolo() {
    npx -y @devcontainers/cli up --workspace-folder . \
        && npx -y @devcontainers/cli exec --workspace-folder . claude --dangerously-skip-permissions
}
EOF
    echo "added yolo() function to $shell_rc"
fi

export SHIPPABLE_HOST_REPO="$repo_root"
echo "building devcontainer (slow first time)..."
npx -y @devcontainers/cli up --workspace-folder "$repo_root"

echo ""
echo "Done. Open a fresh shell (or 'source $shell_rc'), then run 'yolo' from any worktree."
