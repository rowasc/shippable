# Roadmap

We're aiming to put a first alpha (0.1.0) out by **May 16, 2026**. This is what will make the cut for the release.


## Release 0.1.0 - local-first review tooling

- A macOS `.dmg` we'd be happy handing to a teammate to use.
- Tests and CI, so we're not the bottleneck for every release.
- AI reviewer integration. Initially only Anthropic APIs are supported.
- Local-only human review workflows, with local storage mechanisms (SQLite)
- Review any file or diff.
- .diff URL ingest (no auth support) - paste a .diff and we fetch it for you


## Release 0.2.0 - connectivity

- Connect with any MCP.
- Bring-your-own-key for whichever model you want to use. We will add support for various popular APIs and models.
- Send reviews to GitHub / view reviews from GitHub.

## Shipping first

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

**TUI mode.** On the wishlist.

## What we're not doing

- We're not building our own PR system or diff format.
- We're not chasing IDE integrations. Web and desktop are enough surface for now.
- We're not adding cloud-anything before the local product is something we'd actually want to use ourselves.
