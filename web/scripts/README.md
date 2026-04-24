# Regenerating the main README GIF

```
npm run demo                     # run every storyboard
npm run demo -- --only <name>    # run one by name
```

Each demo is a storyboard under `web/scripts/storyboards/` — a plain list of `press`, `wait`, and `shot` steps plus the output path. The runner starts Vite on port 5199, drives a real Chrome with Playwright, then stitches screenshots into a GIF with ffmpeg. Shot timing (how long each frame lingers) lives on the `shot` step itself, so there's one place to edit when you tweak a flow.

Adding a new demo = dropping a new `*.mjs` file in that directory. Requires `ffmpeg` on `PATH` and a local Chrome install; `playwright-core` reuses the system browser instead of downloading Chromium.