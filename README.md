# shippable

Shippable is an early **prototype** of an AI-assisted code review tool that accompanies you as you work through a diff. Shippable helps you figure out where to start, how things relate to each other, and what you've already reviewed.

The code itself is a throwaway at this point, meant to explore a concept. Please don't use this in any kind of production setting. 

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

Three entry points:

- `/` is the live app.
- `/gallery.html` is a screen catalog that renders every UI state against canned fixtures. This is the intended surface for design work — way faster than driving the live app with the keyboard to reach an edge case.
- `?cs=<id>` on the main app jumps straight to a specific sample ChangeSet, which is handy if you need to reproduce a fixture state manually.