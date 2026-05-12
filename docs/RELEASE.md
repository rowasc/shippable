# Releasing

`npm run release` cuts a GitHub pre-release for the version currently in `src-tauri/tauri.conf.json`. It builds both `aarch64` and `x64` DMGs, tags `v<version>`, pushes the tag to `origin`, and creates the release with both DMGs attached.

## One-time setup

On top of the desktop build prereqs in `README.md`:

```
rustup target add aarch64-apple-darwin x86_64-apple-darwin
gh auth login
```

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
- tags `v<version>`, pushes the tag to `origin`
- creates the GitHub release with `gh release create`, attaching both DMGs, with auto-generated notes from commits since the previous `v*` tag

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
