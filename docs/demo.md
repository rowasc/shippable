# Demo (`/demo.html`)

Self-contained, scripted walkthrough of the app. Served by Vite at `/demo.html`. Plays a sequence of pre-built frames over the real UI — same components, same reducer, seeded `ReviewState`. Opens paused so a recorder can frame the shot.

Not the gallery. `/gallery.html` is just the static screen catalog — no playback.

## Files

- `web/demo.html` — entry, mounts `/src/demo.tsx`.
- `web/src/demo.tsx` — renders `<Demo />`.
- `web/src/components/Demo.tsx` — **everything lives here.** Frames, playback, keymap, overlay wiring.

## Adding or editing a frame — prompt

> In `web/src/components/Demo.tsx`, add a frame to the array returned by `buildFrames()`. A frame is a `Frame`: `caption` (string shown over the stage), `state` (a `ReviewState` — start from `fresh()` and use `withCursor(state, fileId, hunkId, lineIdx)` to position the cursor), `overlay` (one of `none`, `plan`, `help`, `load`, `promptPicker`, `runnerInline` with a `source` string, `runnerFree`), optional `themeId` (`"light" | "dark" | "dollhouse" | "dollhouse-noir"` — sticky across frames once set; don't snap back), optional `durationMs` (defaults to 6500), optional `showGuide`. Two changesets are pre-bound at the top of the file: `CS` (cs-42 preferences), `PREF_FILE`, `STORAGE_FILE`. To seed acks/replies/selection/reviewedFiles, build the state inline like the existing frames do — see f5State (ack + reply), f6State (block selection + comment), f7State (file fully read + signed off). The theme showcase is hard-coded as the last frame in `<Demo>`'s effect (`idx === themeDemoIdx`); if you want a new last frame, move that branch.

## Playback shortcuts (already wired)

- `⌃/⌘ Space` play/pause · `⌃/⌘ ←/→` prev/next · `⌃/⌘ .` toggle controls
- Hover pauses. Inside the stage all live-app keys work (`j/k`, `c`, `r`, `m`, `?`, `p`, `Shift+L`, `Shift+R`, etc.).

## Run it

```sh
cd web && npm run dev
# open http://localhost:5173/demo.html
```

