# Shippable

A code review tool that walks you through a diff. Built for the case where you just spent the morning telling an agent what to build and now you have to read what it wrote — or you came back from lunch to ten new PRs and don't know where to start.

## What it does today

- Open a diff (paste or upload). The app gives you a plan: a one-line headline, what the change is trying to do, a structure map of the files and symbols involved, and up to three suggested entry points. Every claim it makes points back to a specific file, hunk, or symbol — no claims float free of evidence.
- Move through the diff with the keyboard. The cursor tracks every line you've passed over, and a gutter rail shows what you've actually read. Files get a single explicit "I'm done with this one" gesture.
- AI notes show up inline on the lines they're about. You can ack them, reply to them, or hand them to the runner — for JS/TS and PHP hunks, you can execute the snippet in the browser and verify the note's claim in one click.
- A prompt library ships with the app (`explain this hunk`, `security review`, `suggest tests`, `summarise for PR`). You pick one, run it on a hunk, and the result streams back. Prompts are editable.
- Reviews persist across reloads. There's a screen catalog (`/gallery.html`) for design work and a `?cs=<id>` shortcut for jumping to fixtures.

## Where it runs

- Web app, dev-served by Vite.
- Native macOS app — same web app wrapped in Tauri, with the backend compiled into a single binary and bundled inside the `.dmg`. No Node, no browser dev server, no separate install.

## What it isn't yet

- It only takes pasted or uploaded diffs. No URL ingest, no GitHub/GitLab integration.
- Reviews live in localStorage. Nothing syncs anywhere; teammates can't see each other's reviews.
- Only Claude. The server defaults to `claude-sonnet-4-6`; override with the `CLAUDE_MODEL` env var.
- No tests, no CI. `npm run build` is the typecheck.
- The `.dmg` is unsigned.

## Why it exists

Most review tooling is built around editing or around bots that comment on PRs. The bet here is that the review side of the loop deserves its own first-class tool — one that helps a human reviewer stay present, track what they've seen, and not turn long sessions into LGTM parties. See `IDEA.md` for the longer version.
