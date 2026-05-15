# Releasing

`npm run release` cuts a GitHub pre-release for the version currently in `src-tauri/tauri.conf.json`. It builds both `aarch64` and `x64` DMGs, tags `v<version>`, pushes the tag to `origin`, and creates the release with both DMGs attached.

## One-time setup

```
brew tap oven-sh/bun && brew install bun
cargo install tauri-cli --version "^2.0"
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:setup
gh auth login
```

`bun` compiles `server/` into the bundled sidecar binary. `tauri-cli` is the Tauri 2 build driver. `rustup target add` covers cross-arch DMGs (Apple Silicon + Intel). `npm run desktop:setup` installs `web/` and `server/` deps. `gh auth login` is only needed for the publishing step.

## Building a DMG without publishing

```
npm run build:dmg
```

Output:

- `src-tauri/target/release/bundle/macos/Shippable.app`
- `src-tauri/target/release/bundle/dmg/Shippable_<version>_aarch64.dmg`

`build:dmg` runs `cargo tauri build -b app` first — `src-tauri/tauri.conf.json` wires in the pre-build steps (compile `server/` into the bundled sidecar, build `web/` into `web/dist`). The final `.dmg` is then packaged with `hdiutil` rather than Tauri's built-in DMG step (which relies on Finder AppleScript and is brittle in headless or sandboxed environments) — `scripts/build-dmg.mjs` handles this.

## Iterating on the desktop shell

For quick iteration on the Rust shell or the frontend:

```
npm run desktop:dev
```

Runs the React app via Vite in a native Tauri window with hot reload. The pre-dev hook in `src-tauri/tauri.conf.json` compiles the bundled sidecar first, so you don't need a separate `bun run build:sidecar` step.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json`. Commit and push.
2. Run:

   ```
   npm run release
   ```

The script:

- refuses a dirty working tree (override with `--allow-dirty`)
- refuses if `v<version>` already exists locally or on `origin`
- warns if you're not on `main`
- builds DMGs for both architectures via `scripts/build-dmg.mjs --target=...`
- drafts release notes (themed changelog via `claude -p` if the Claude Code CLI is installed and authed, raw commit list otherwise) and opens them in `$EDITOR` for you to edit
- after you save+quit, prompts `Publish v<version>?` — answer `y` to continue, anything else aborts (no tag created)
- tags `v<version>`, pushes the tag to `origin`
- creates the GitHub release with `gh release create`, attaching both DMGs, using your edited notes

Pass `--skip-build` to reuse DMGs from a previous run (e.g. if the publish step failed after a successful build).

## Pre-release vs stable

Releases are marked **pre-release** by default — Shippable is still a prototype. Flip an individual release to stable from the GitHub UI or:

```
gh release edit v<version> --prerelease=false
```

## What recipients see

The DMGs are **unsigned and un-notarized**. First launch trips Gatekeeper. Two ways past it, both included in the release notes:

- **Finder:** right-click the `.app` → Open → confirm once.
- **Terminal:** `xattr -dr com.apple.quarantine /Applications/Shippable.app` — strips the quarantine attribute, no dialog.

Signing and notarization require an Apple Developer ID plus `codesign` + `xcrun notarytool submit` + `xcrun stapler staple` in the build flow. Not currently wired up.

## Per-arch builds outside the release flow

`scripts/build-dmg.mjs` takes an optional `--target=<rust-triple>`:

```
node scripts/build-dmg.mjs                              # host arch
node scripts/build-dmg.mjs --target=aarch64-apple-darwin
node scripts/build-dmg.mjs --target=x86_64-apple-darwin
```

The script ensures the matching `bun`-compiled sidecar exists before invoking `cargo tauri build`. Cross-arch sidecars are built via `bun run build:sidecar:x64` in `server/`.

## Extension points

- **Signing/notarization** — add `codesign` + `notarytool` between the `.app` build and the `hdiutil` packaging in `scripts/build-dmg.mjs`.
- **Universal binary** — `lipo` the two `.app` bundles into a single fat binary to ship one DMG instead of two.
- **CI** — the script runs unattended and is portable to a `macos-latest` GitHub Actions runner. Sidecar cross-compile via `bun` works in CI; signing additionally requires importing the Developer ID certificate into the runner's keychain.
