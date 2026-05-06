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

if grep -q "^alias yolo=" "$shell_rc" 2>/dev/null; then
    sed -i.bak '/^alias yolo=/d' "$shell_rc" && rm -f "$shell_rc.bak"
    echo "removed old 'alias yolo=' from $shell_rc"
fi

if grep -qE '^(# yolo-begin|yolo\(\) \{)' "$shell_rc" 2>/dev/null; then
    awk '
        /^# yolo-begin/      { in_marked=1; next }
        in_marked && /^# yolo-end/ { in_marked=0; next }
        in_marked            { next }
        /^yolo\(\) \{/       { in_legacy=1; next }
        in_legacy && /^\}$/  { in_legacy=0; next }
        in_legacy            { next }
        { print }
    ' "$shell_rc" > "$shell_rc.tmp" && mv "$shell_rc.tmp" "$shell_rc"
    echo "removed previous yolo() definition from $shell_rc"
fi

cat >> "$shell_rc" <<'EOF'
# yolo-begin (managed by .devcontainer/setup.sh — re-run setup.sh to update)
yolo() {
    local worktree_name=""
    local args=()
    local arg
    for arg in "$@"; do
        case "$arg" in
            --worktree=*) worktree_name="${arg#--worktree=}" ;;
            *)            args+=("$arg") ;;
        esac
    done

    local workspace="."
    if [[ -n "$worktree_name" ]]; then
        : "${SHIPPABLE_HOST_REPO:?yolo: SHIPPABLE_HOST_REPO not set — re-run .devcontainer/setup.sh}"
        local parent repo_name safe_name
        parent="$(dirname "$SHIPPABLE_HOST_REPO")"
        repo_name="$(basename "$SHIPPABLE_HOST_REPO")"
        safe_name="${worktree_name//\//-}"
        workspace="$parent/${repo_name}-${safe_name}"
        if [[ ! -d "$workspace" ]]; then
            if git -C "$SHIPPABLE_HOST_REPO" show-ref --verify --quiet "refs/heads/$worktree_name"; then
                git -C "$SHIPPABLE_HOST_REPO" worktree add "$workspace" "$worktree_name" || return 1
            else
                git -C "$SHIPPABLE_HOST_REPO" worktree add -b "$worktree_name" "$workspace" || return 1
            fi
            echo "yolo: created worktree at $workspace"
        else
            echo "yolo: reusing existing worktree at $workspace"
        fi
    fi

    npx -y @devcontainers/cli up --workspace-folder "$workspace" \
        && npx -y @devcontainers/cli exec --workspace-folder "$workspace" claude --dangerously-skip-permissions "${args[@]}"
}
# yolo-end
EOF
echo "installed yolo() function in $shell_rc"

export SHIPPABLE_HOST_REPO="$repo_root"
echo "building devcontainer (slow first time)..."
npx -y @devcontainers/cli up --workspace-folder "$repo_root"

echo ""
echo "Done. Open a fresh shell (or 'source $shell_rc'), then run 'yolo' from any worktree."
