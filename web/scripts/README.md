# Regenerating the main README GIF

```
npm run demo                     # run every storyboard
npm run demo -- --only <name>    # run one by name
```

Each demo is a storyboard under `web/scripts/storyboards/` — a plain list of `press`, `wait`, and `shot` steps plus the output path. The runner starts Vite on port 5199, drives a real Chrome with Playwright, then stitches screenshots into a GIF with ffmpeg. Shot timing (how long each frame lingers) lives on the `shot` step itself, so there's one place to edit when you tweak a flow.

Adding a new demo = dropping a new `*.mjs` file in that directory. Requires `ffmpeg` on `PATH` and a local Chrome install; `playwright-core` reuses the system browser instead of downloading Chromium.

## Running the smoke suite

```
npm run test:smoke
npm run test:smoke -- --list
npm run test:smoke -- --include coderunner,themes
```

`test:smoke` is the unified entrypoint for the Playwright-based smoke scripts that can run against this repo's local web app alone. The runner starts Vite on `127.0.0.1:5198`, exports that URL to each smoke script, runs the default suite sequentially, and exits nonzero on the first failure.

Not every `scripts/smoke-*.mjs` file is part of the default suite. Some older scripts still target the removed selection-pill CodeRunner UI, `smoke-prompts.mjs` needs the separate prompt-library server on `:3001`, and the theme-specific markdown-preview smoke stays opt-in to keep the default path narrower. Use `--list` to see the registry and the reason each excluded script is not part of the boring default path.
