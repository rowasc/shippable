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
firewall script needs and wires up sudo. `init-firewall.sh` is copied verbatim
from the [reference container](https://github.com/anthropics/claude-code/tree/main/.devcontainer).

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

## Run it (Podman, terminal-only)

The `@devcontainers/cli` shells out to a `docker` binary, so on a podman
host you also need a `docker` CLI pointed at podman's socket. One-time
setup:

```sh
brew install podman docker          # if not already installed
podman machine init                 # only if no machine exists yet
podman machine start                # required after every reboot

# tell the docker CLI where podman's socket lives
echo 'export DOCKER_HOST="unix://$(podman machine inspect --format "{{.ConnectionInfo.PodmanSocket.Path}}" 2>/dev/null)"' >> ~/.zshrc
source ~/.zshrc

docker ps                           # sanity check: empty list, no error
```

Build and start the container (slow first time — apt install + Feature
install):

```sh
npx -y @devcontainers/cli up --workspace-folder .
```

Run Claude inside it:

```sh
npx -y @devcontainers/cli exec --workspace-folder . claude --dangerously-skip-permissions
```

A handy alias for daily use:

```sh
echo "alias yolo='npx -y @devcontainers/cli exec --workspace-folder . claude --dangerously-skip-permissions'" >> ~/.zshrc
source ~/.zshrc
yolo
```

Re-run `up` only when you've edited `.devcontainer/` or rebooted.

## Verify the firewall is active

After `up`, confirm a blocked host fails fast and `iptables` policy is DROP:

```sh
npx -y @devcontainers/cli exec --workspace-folder . curl -sI --connect-timeout 3 https://github.com
# expected: non-zero exit, no headers (network unreachable)

npx -y @devcontainers/cli exec --workspace-folder . sudo iptables -L OUTPUT -n
# expected: "Chain OUTPUT (policy DROP)" with one ACCEPT line for the allowed-domains ipset
```

If `OUTPUT` shows `policy ACCEPT`, the firewall didn't run — re-run `up`.

## Run it (Docker / VS Code)

If you have Docker Desktop and the VS Code Dev Containers extension, open
the repo in VS Code and pick "Reopen in Container." The `postStartCommand`
runs `init-firewall.sh`; if it fails, the container won't be considered
ready.

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
- **Don't mount sensitive sockets or credentials.** Mounting the docker /
  podman socket, `~/.ssh`, or cloud credential files into the container voids
  the isolation. Anthropic's docs explicitly warn that with
  `--dangerously-skip-permissions`, a compromised session can exfiltrate
  anything reachable inside the container — including the Claude Code OAuth
  token in `/home/node/.claude` — over any allowlisted domain.
- **First run is slow.** The image build pulls Node 20, installs apt
  packages, and runs the Feature's install script.
