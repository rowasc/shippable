<!--
  LANDING.md — markdown equivalent of landing-mockup.html.
  Intended render theme: Persimmon — warm cream paper (#FCF6EE), saturated orange-red accent (#D7401C).
  See landing-mockup.html for the visual reference.
-->

<div align="center">

# Shippable

**Agents help. You sign your name.**

_A review surface for everything you sign off on, typed or generated._

Agents make diffs cheap. The human reviewing them is the bottleneck — and the one on the hook when something breaks in production.

[Open a diff](#) · [Read the source](#) · [GitHub comparison](../plans/comparison-github-code-reviews.md)

</div>

---

## The shift

Most of the code you review now wasn't typed by anyone you know. Some of it was written by your team. More of it was written by their agents. A growing share was written by your own agent — code you specced and never typed, sitting in a 1,500-line diff you have to read like a stranger's.

Reviewer bots help with some of that. They surface real issues, shorten some loops, do their work. They don't change the fact that a human still has to read the diff, decide what to trust, and put their name on the merge.

## What it does

Given a git diff:

- **Builds a review plan.** Every summary links back to a file, hunk, or symbol, so you can check the claim before accepting it.
- **Tracks reading at the line level.** Long sessions don't reset. Step away and come back to the line you stopped on.
- **Verifies claims inline.** Run code, query LSP, run linters or type checks, follow a symbol — without leaving the review.
- **Persists locally.** AI passes and your reading accumulate. Your earlier review feeds the next one.
- **Hands feedback to the next agent run.** Structured follow-up, not a chat log dumped into a prompt.
- **Works before there's a PR.** Local diffs today; worktrees, URLs, and PR-by-number next.

---

> **Agents help.**  
> **You sign your name.**  
> _Shippable is the part in between._

---

## Where it sits

| Tool | Relationship |
|---|---|
| **Pi** | Composable harness. Bring it for primitives; use Shippable as the dedicated review pass inside that workflow. |
| **Conductor** | Runs agent workspaces and merges. Shippable doesn't run them; it helps you decide what came out. |
| **Codex** | Full build-and-ship platform. Shippable is the supervision layer if you want the review pass to stay deliberate. |
| **Claude Code Review** | Strong PR-comment automation; complementary. Their output is comments. Shippable's output is review state you can carry forward. |
| **GitHub PR review** | The system of record. Once Shippable has GitHub connectivity, it becomes a layer on top — pull PRs in for the heavier read, push conclusions back out as comments. User-authenticated, not another bot in the repo. [Full comparison](../plans/comparison-github-code-reviews.md). |

## Coming next

Local-first today. Next on the roadmap:

- Worktree ingest and "what changed since I last reviewed"
- Reading-path suggestions that surface dependencies and callers
- Contextual skill loaders for repo- and framework-specific patterns
- Structured one-way feedback to the next agent run
- Coverage markers that combine human and AI review state
- GitHub connectivity — pull PRs in, push conclusions back out
- Comprehension prompts that block reflex sign-off

---

<sub>Built by <a href="https://github.com/rominasuarez">@rominasuarez</a>. Feedback as issues, PRs, or DMs.</sub>
