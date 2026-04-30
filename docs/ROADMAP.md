# Roadmap

We're aiming to put a real, signed `.dmg` of Shippable in people's hands on **May 16, 2026**. This is the cut for that release, and what we plan to do next.

## What v1 means

- A macOS `.dmg` we'd be happy handing to a teammate. Signed and notarised is the bar we want; if the certificate paperwork isn't sorted by the 16th we'll ship unsigned with clear "right-click → Open" instructions and chase signing right after.
- Tests and CI, so we're not the bottleneck for every release.
- Reviews still live on your machine. No login, no sync, no shared state — that comes later.
- Bring-your-own-key for whichever model you want to use.

## Shipping by May 16

**Multi-provider model picker.** Claude is the default (Sonnet 4.6). Add GPT and a local Ollama option. Keys live in the macOS Keychain — same pattern we already use for `ANTHROPIC_API_KEY`, just one entry per provider. Picker lives in settings; no per-prompt switching.

**Block-level review as a primitive.** Right now review happens at two grains: the line you just passed and the file you signed off on. Most actual review work lives in the middle — "this 12-line helper looks wrong," "I want a second opinion on this regex," "let an agent verify this loop while I keep moving." We're making that middle a real object.

A block is a contiguous range you select and then act on: hand it to an agent for a focused pass, attach a comment thread, flag it as needing another pair of eyes, or pin it as an entry point in the plan. Blocks stick around as you keep moving, so anything you delegated is still there when the agent comes back. Routing those asks to an actual teammate's machine is a backend problem and lives in the next phase.

**Release plumbing.** Tests for the parts that hurt when they break — the diff parser, the plan-evidence invariant, the runner sandbox, the origin allowlist. CI on every push. Signing and notarisation if we can land the certificate work in time; otherwise unsigned with a known first-launch step and signing as the first follow-up.

## Coming right after

**GitHub ingest, prototype.** Paste a `.diff` URL or a PR URL and it loads. Read-only at this stage — we don't post anything back. Cheapest unlock we have for reviewing work that isn't on your laptop.

**Coverage markers.** A section is "covered" when both you and an AI have looked at it. We already track each separately; this is mostly UI plus the small bit of state that joins them.

**Micro-skills / contextual skill loaders.** Auto-pull a skill into the active set when the diff matches its scope — a Gutenberg block, a new plugin's config. The skill machinery is in place; we need the matching layer on top.

## Later

**Hosted backend and shared reviews.** Reviews you can pick up from another machine, or that a teammate can keep working on. A8c-only at first.

**GitHub two-way.** Post review threads back as PR comments. Pairs with the hosted backend.

**Persistent storage that isn't a browser tab.** SQLite inside the Tauri shell is the obvious fit; the exact call gets easier once the hosted backend has shape.

**TUI mode.** On the wishlist, not on the runway.

## What we're not doing

- We're not building our own PR system or diff format.
- We're not chasing IDE integrations. Web and desktop are enough surface for now.
- We're not adding cloud-anything before the local product is something we'd actually want to use ourselves.
