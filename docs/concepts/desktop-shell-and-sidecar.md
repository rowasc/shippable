# Dev mode: desktop shell and sidecar

## What it is
The native packaging model for the desktop app. This is an internal concept, not a userland one.

## What it does
- Wraps the web app in a Tauri shell.
- Spawns the backend as a sidecar process on a dynamic loopback port.
- Exposes the sidecar port and keychain actions through Tauri commands.
- Keeps the desktop bundle self-contained instead of requiring the user to run a separate server manually.
