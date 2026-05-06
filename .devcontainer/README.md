# Sandboxed Claude Code

Run Claude Code with `--dangerously-skip-permissions` inside a container whose
egress is restricted to a known allowlist: `registry.npmjs.org`,
`api.anthropic.com`, and a few VS Code endpoints. **No GitHub access by
default** — neither HTTPS nor SSH. **No telemetry hosts** (sentry, statsig).
The repo is bind-mounted at `/workspace`; the rest of the container
filesystem is ephemeral.

## Layout

This setup follows the
[official "add Claude Code to your dev container"](https://code.claude.com/docs/en/devcontainer#add-claude-code-to-your-dev-container)
path: a small `Dockerfile` plus the
[Claude Code Dev Container Feature](https://github.com/anthropics/devcontainer-features/tree/main/src/claude-code).
The Feature installs the CLI; the Dockerfile only adds the dependencies the
firewall script needs and wires up sudo. `init-firewall.sh` started as a
copy of the [reference container](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
script with the allowlist tightened (no GitHub, no telemetry, no SSH). It's
installed in the image as `/usr/local/bin/sandbox-firewall.sh` to avoid
collision with the Feature's own bundled `init-firewall.sh`.

| File                  | Why it's here                                                              |
| --------------------- | -------------------------------------------------------------------------- |
| `devcontainer.json`   | Declares the Feature, `NET_ADMIN`/`NET_RAW` caps, mounts, post-start hook |
| `Dockerfile`          | Adds `iptables`/`ipset`/`dig`, sudoers rule for firewall                  |
| `init-firewall.sh`    | Default-DROP egress + ipset allowlist; self-tests at startup              |

## What's enforced

- **Network**: iptables default-DROP with an `ipset`-backed allowlist resolved
  at container start. `init-firewall.sh` is the source of truth for which
  hosts are reachable; edit it and rebuild to change the policy.
- **Filesystem**: only the bind-mounted workspace is writable from outside;
  everything else is container-local and goes away with the container.

The firewall script self-tests at startup: it fails the container if it can
reach `https://example.com` (should be blocked) or can't reach
`https://api.anthropic.com` (should be allowed).

## Run it

One-shot first-time setup (assumes a working `docker` CLI + engine, e.g.
Colima already running):

```sh
bash .devcontainer/setup.sh
```

That script:
- Adds `SHIPPABLE_HOST_REPO` to `~/.zshrc` (or `~/.bashrc`) pointing at the
  main repo — used by the bind mount that makes `git` work in worktrees.
- Adds a `yolo` shell function that builds-or-reuses the container and
  attaches Claude Code with `--dangerously-skip-permissions`.
- Builds the container.

After that, from any worktree:

```sh
yolo
```

Re-run `bash .devcontainer/setup.sh` if you want to rebuild from scratch
(it ends with `up`, which picks up `.devcontainer/` changes; pass
`--remove-existing-container` to `up` directly to force).

## Verify the firewall is active

After `up`, confirm a blocked host fails fast and `iptables` policy is DROP:

```sh
npx -y @devcontainers/cli exec --workspace-folder . curl -v --connect-timeout 3 https://github.com
# expected: non-zero exit, "Connection refused" / "Network unreachable"

npx -y @devcontainers/cli exec --workspace-folder . sudo iptables -L OUTPUT -n
# expected: "Chain OUTPUT (policy DROP)" with one ACCEPT line for the allowed-domains ipset
```

If `OUTPUT` shows `policy ACCEPT`, the firewall didn't run — check `up`'s
output for a `postStartCommand` failure and re-run with
`--remove-existing-container`.

## Worktrees and `git status`

A worktree's `.git` is a file containing an absolute host path back to the
main repo's `.git/worktrees/<name>` directory. For `git status` to work
inside the container, that absolute path needs to resolve in the
container's filesystem. `devcontainer.json` does this by bind-mounting
`$SHIPPABLE_HOST_REPO/.git` at the same path inside the container.

Set `SHIPPABLE_HOST_REPO` in your shell rc to the absolute path of the
main checkout (the one that owns `.git/worktrees/`):

```sh
export SHIPPABLE_HOST_REPO=/Users/you/path/to/shippable
```

If you forget, `up` fails with a mount error pointing at `/.git`.

This works for both worktree patterns:

| Worktree at                        | yolo from there | git inside container |
| ---------------------------------- | --------------- | -------------------- |
| `<main>/.claude/worktrees/<name>`  | ✅              | ✅                   |
| `../shippable-<name>` (sibling)    | ✅              | ✅                   |
| Main repo itself                   | ✅              | ✅                   |

The mount is read-write — commits inside the container reach the host's
real `.git`. A compromised session could rewrite history; if that matters,
make the mount `readonly` and run `git commit` from the host.

## Sharing host skills/agents/commands

Your global `~/.claude/skills/` is bind-mounted read-only at
`/home/node/.claude/skills` so the same skills you use on the host are
available inside the container. Auth, settings, and history stay in the
per-container volume.

To share other parts of your host config (also read-only), add to `mounts`
in `devcontainer.json`:

```json
"source=${localEnv:HOME}/.claude/agents,target=/home/node/.claude/agents,type=bind,readonly",
"source=${localEnv:HOME}/.claude/commands,target=/home/node/.claude/commands,type=bind,readonly",
"source=${localEnv:HOME}/.claude/CLAUDE.md,target=/home/node/.claude/CLAUDE.md,type=bind,readonly",
```

Don't bind-mount the *whole* `~/.claude` — that pulls in your auth token
and session history, which defeats most of the per-container isolation.

A `.claude/skills/` directory inside the repo is already visible via the
workspace bind mount, no extra config needed.

## VS Code

If you have the Dev Containers extension installed, open the repo and pick
"Reopen in Container." The `postStartCommand` runs `init-firewall.sh`; if
it fails, the container won't be considered ready and the extension will
surface the error.

## Editing the allowlist

The `for domain in ...` block in `init-firewall.sh` lists every domain that
gets DNS-resolved and added to `allowed-domains`. To add a host, add it
there. To allow GitHub, add `github.com` and `api.github.com` (and reinstate
the `iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT` lines if you need git
over SSH). After edits, rebuild the image — the firewall is applied at
container start, not on each command.

## Caveats

- **TLS is not inspected.** The allowlist is hostname/IP based. A compromised
  agent could in principle domain-front via an allowlisted CDN. If that
  matters, swap in a TLS-terminating proxy.
- **Don't mount sensitive sockets or credentials.** Mounting the Docker
  socket, `~/.ssh`, or cloud credential files into the container voids the
  isolation. Anthropic's docs explicitly warn that with
  `--dangerously-skip-permissions`, a compromised session can exfiltrate
  anything reachable inside the container — including the Claude Code OAuth
  token in `/home/node/.claude` — over any allowlisted domain.
- **First run is slow.** The image build pulls Node 20, installs apt
  packages, and runs the Feature's install script.
