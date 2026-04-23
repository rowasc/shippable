# shippable

Shippable is an early **prototype** of an AI-assisted code review tool that accompanies you as you work through a diff. Shippable helps you figure out where to start, how things relate to each other, and what you've already reviewed.

## Running it

Everything lives in `web/`. There's no root `package.json` yet.

```
cd web
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build — the canonical "did I break typing" check
npm run lint      # eslint
npm run preview   # serve the production build
```

There's no test runner wired up yet. `npm run build` is the typecheck for now.

Two entry points:

- `/` is the live app.
- `/gallery.html` is a screen catalog that renders every UI state against canned fixtures. This is the intended surface for design work — way faster than driving the live app with the keyboard to reach an edge case.

`?cs=<id>` on the main app jumps straight to a specific sample ChangeSet, which is handy if you need to reproduce a fixture state manually.

## Shape of the code

Two layers, deliberately split:

- **Core** — `src/types.ts`, `state.ts`, `guide.ts`, `symbols.ts`, `parseDiff.ts`, plus the fixtures and keymap. No DOM, no React. This is the stuff a future TUI renderer would also need.
- **Renderer** — `App.tsx` and everything under `src/components/`. React, rendering, events, key handling.

The renderer isn't fully "dumb" yet — a lot of components still read state and call `dispatch` directly. The direction of travel is a view-model layer between core and components so presenters become pure, but that migration is in-flight.
