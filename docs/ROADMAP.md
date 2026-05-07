# Roadmap

The goal of this app is an exceptional review experience that gets you from idea to shippable code faster.

The following are some loosely set plans for our first alpha release, and what will come next.

## Release 0.1.0 - local-first review tooling

We are focusing on the core of the idea and experience; how to make the review experience itself as good as it can be, with a focus on locally available diffs first.

### Local reviews

- you can point it to any URL .diff 
- you can point it to any two branches in your filesystem
- you can paste any diff

### Runners as first-class citizens

- Code runner; select-to-run, write-your own. Wasm enabled runners for JS, PHP, and TS. More options to come later :) 

### Reporter

- Collects all the tests for a method, shows them inline - what's covered, what isn't, if there's a cov report we can also even use it, but if not, can be inferred with AI and static analysis

- "Does this test do anything?" mode - avoid useless tests

### AI-enabled review UX

- Select code to send to an AI to review from a prompt library, mantain your own.

- Review-while-they-work workflows - as your agents work, you review your worktrees based on the last changeset committed. It uses your agent's context and chat, and you can feed your review back to the agent with feedback to continue after it wraps up the next task, or to a new agent. See `docs/plans/share-review-comments.md` for the MCP-pull design that ships the reviewer→agent half, and `docs/plans/worktrees.md` for the worktree ingest plan more broadly.
    - can we send feedback to a live session, too,? That'd be excellent, to steer the session live.
    - we should test the results a bit, or give the user the option between live and non-live operations mode 

- AI Inspector - "Claude, review this diff" results in a much easier to inspect experience, with comments inlined into the web UI, symbols highlighted and reachable, and one-click verification/fixup workflows for potential bugs.

### LSP

Click-through definition at a minimum

### Basics
- A macOS `.dmg` we'd be happy handing to a teammate to use.
- Tests and CI, so we're not the bottleneck for every release.
- Local storage of reviews.
- AI reviewer integration. Initially only Anthropic APIs are supported.
- Local-only human review workflows, with local storage mechanisms (SQLite)
- Review any file or diff.
- .diff URL ingest (no auth support) - paste a .diff and we fetch it for you


## Release 0.2.0 - connectivity

- Connect with any MCP.
- Bring-your-own-key for whichever model you want to use. We will add support for various popular APIs and models, prioritizing OpenAI.
- Send reviews to GitHub / view reviews from GitHub.

## Shipping first

## Coming right after

**GitHub ingest, prototype — v0 shipped.** Paste a PR URL and it loads: diff, metadata, line-anchored review comments, PR conversation. Works with github.com and GHE; per-host PAT; read-only on this pass. See `docs/sdd/gh-connectivity/spec.md`. Follow-ups: push-back to GitHub (posting review comments), expand-context for remote PR files, worktree-backed clone ingest.

**Coverage markers.** A section is "covered" when both you and an AI have looked at it. We already track each separately; this is mostly UI plus the small bit of state that joins them.

**Micro-skills / contextual skill loaders.** Auto-pull a skill into the active set when the diff matches its scope — a Gutenberg block, a new plugin's config. The skill machinery is in place; we need the matching layer on top.

**Spend caps and monitoring** - Don't spend more than X/day or Y/review

**Hosted backend and shared reviews.** Reviews you can pick up from another machine, or that a teammate can keep working on. This is still a maybe.

**GitHub two-way.** Post review threads back as PR comments. Pairs with the hosted backend.

**TUI mode.** On the wishlist.

## What we're not doing

- We're not building our own PR system or diff format.
- We're not chasing IDE integrations. Web and desktop are enough surface for now.
- We're not adding cloud-anything before the local product is something we actually use day to day.
