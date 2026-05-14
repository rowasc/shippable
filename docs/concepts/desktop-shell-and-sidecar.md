# Dev mode: desktop shell and sidecar

## What it is
The native packaging model for the desktop app. This is an internal concept, not a userland one.

## What it does
- Wraps the web app in a Tauri shell.
- Spawns the backend as a sidecar process on a dynamic loopback port.
- Exposes the sidecar port and keychain actions through Tauri commands.
- Keeps the desktop bundle self-contained instead of requiring the user to run a separate server manually.

## Port discovery file
The Tauri shell tells the web UI the sidecar's ephemeral port over its IPC channel (`get_sidecar_port`). Out-of-process clients on the same box — today, the MCP server — have no such channel, so the sidecar also writes the port to an OS-conventional path on launch:

- macOS: `~/Library/Application Support/Shippable/port.json`
- Linux: `$XDG_DATA_HOME/Shippable/port.json` (or `~/.local/share/Shippable/port.json`)
- Windows: `%LOCALAPPDATA%/Shippable/port.json`

The file is written atomically (temp + rename) and removed on clean shutdown. Readers should health-check the listed port before trusting it — stale files (sidecar killed without cleanup) need to fall through to whatever default the client uses.

Canonical implementation: `server/src/port-file.ts`.
