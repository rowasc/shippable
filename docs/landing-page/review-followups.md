# Landing page — review followups

Findings from the per-task spec + code-quality reviews during implementation (commits `0973897..e820d17`). Organised by severity, with the status of each at completion of the original 17-task plan.

The plan is at `docs/superpowers/plans/2026-05-13-landing-page.md`. The spec is at `docs/superpowers/specs/2026-05-13-landing-page-design.md`.

## Accessibility

| # | Finding | First flagged | Status | Recommended fix |
|---|---|---|---|---|
| A1 | Hero wordmark is a bare `<div>`. A screen reader hits the page `<h1>` with no identified page owner / brand wrapper. | Task 3 | Pending | Wrap the wordmark in `<header>` outside the hero grid, or at minimum add `role="banner"`. The cleaner fix is the real `<header>` element. |
| A2 | All `<section>` elements lack an accessible name (no `aria-label` / `aria-labelledby`). Recurring across tasks 3, 4, 5, 6, 8, 9, 10. | Task 3 | Pending | Add `aria-labelledby` on each `<section>` pointing at its eyebrow or H2 id. Cheap, mechanical pass. |
| A3 | `<img>` elements in the hero + gallery have no `width`/`height` attributes — only the `aspect-ratio` CSS rule added in Task 17. CLS prevention is partial: works once CSS loads, but explicit attrs are best. | Task 6 | Partially addressed (CSS `aspect-ratio: 16/10`) | Add `width="2400" height="1500"` attrs to each `<img>` so the browser can reserve space before stylesheet parsing. |

## HTML semantics

| # | Finding | First flagged | Status | Recommended fix |
|---|---|---|---|---|
| H1 | The "Where it sits" comparison uses `<div class="landscape-row">` rows. Semantically this is a description list and would be more correct as `<dl>` / `<dt>` / `<dd>`. The implementation matched the existing mockup's pattern. | Task 8 | Deferred (matched mockup convention) | If we revisit accessibility, convert to `<dl>` and adjust the `.landscape-list` grid CSS to wrap pairs accordingly. |
| H2 | `<link rel="canonical">` is missing from `<head>`. `og:url` was added in Task 11; `rel=canonical` mirrors that gap. | Task 1 | Pending | Add `<link rel="canonical" href="https://rowasc.github.io/shippable/">` next to `og:url`. |
| H3 | No `og:image` social card. Defer per spec until after deploy so the image can be generated from the live page. | Spec (out of scope) | Deferred to post-deploy | Generate a 1200×630 card (could literally be a cropped/composed version of the hero screenshot) and add the meta tag. |

## CSS / styling

| # | Finding | First flagged | Status | Recommended fix |
|---|---|---|---|---|
| C1 | `--accent-strong: #c41e8e` is invented in our `:root`. The value matches `--border-active` from `web/src/tokens.ts` (Dollhouse Noir block) but the name has no source-of-truth parity. | Task 2 | Pending | Either rename our token to `--border-active` to match the app, or add `--accent-strong` to the app's tokens for forward parity. Lean: rename in the landing page. |
| C2 | `p { max-width: 62ch }` is global. Affects every paragraph including `.eyebrow`, captions, and any short-text `<p>` in future tasks. Subsequent rules can override via `max-width: none` or `unset`, but the constraint is implicit. | Task 2 | Accepted; no current breakage | Document the convention in a comment, or scope the rule to `.prose p` / sections that need it. Not urgent — no current element is harmed. |
| C3 | `a { border-bottom: 1px solid transparent }` foundation rule applies to every anchor including CTAs and nav-like links. Hover-state cancellations on CTAs are redundant no-ops (foundation already transparent). | Tasks 2, 3 | Cosmetic | Either remove the hover `border-bottom-color: transparent` lines on `.cta.primary:hover` and `.cta.secondary:hover` (dead code) or scope the foundation rule narrower (e.g. only inside content sections). |
| C4 | Inside `<style>`, the indentation drifted: `:root` declarations sit at 2-space, most rule bodies at 4-space, the Hero/Gallery/Comparison rule headers at 0-space. Cosmetic but accumulating. | Tasks 2, 3, 4 | Cosmetic | Normalize the entire stylesheet to one indent depth in a single pass. 5-minute job. |
| C5 | `.feature p { font-size: 14.5px }` uses a fractional pixel. Browsers round; harmless. | Task 5 | Cosmetic | Round to `14px` or `15px`. |
| C6 | `.landscape-name` has no explicit `margin: 0`. Browser default for `<div>` is 0, but if a future reset adds block-margin to divs the rows would shift. | Task 8 | Theoretical risk | Add `margin: 0` for defensive predictability — half-line change. |

## Copy / content

| # | Finding | First flagged | Status | Recommended fix |
|---|---|---|---|---|
| K1 | "The shift" second paragraph: *"Reviewer bots help with some of that. They surface real issues, shorten loops, do their work. They don't change the fact…"* — the second "They" reads ambiguously on re-read (it's still about bots, but the rhetorical shift to "human still has to read" makes it briefly unclear). | Task 4 | Cosmetic | Reword the pivot, e.g. *"They don't, however, change the fact…"* or split into a new sentence with an explicit subject. |

## Process bugs caught during implementation

These are not landing-page issues — they're notes on the agentic plan execution itself, for future plans.

| # | Finding | Where it bit us | Resolution |
|---|---|---|---|
| P1 | Task 10 implementer placed new content **before** the marker comments instead of **replacing** them. Two orphan markers (`/* === Task 10 ... === */` and `<!-- SECTION: coming-next (Task 10) -->`) survived the commit until the spec reviewer flagged it. | Task 10 commit `3cec574` | Fixed via fixup commit; squashed into `989ac06`. The Task 11 implementer later discovered Task 4 and Task 6 had the same bug — Task 4's marker survived intentionally per the original instructions (no CSS for that section), but Task 6 had a real stale marker that prior reviews missed. Now all clean. |
| P2 | Per-task reviewers occasionally read the spec's markdown-presented code block as byte-exact source-of-truth and flagged HTML indentation (column position) as "spec failure" even though the substantive HTML was correct. | Task 4 spec review | Overrode the reviewer's verdict after verifying the file's established indentation pattern. Future plans should explicitly call out that *the HTML content* — not exact whitespace — is the spec. |

## Things that aren't bugs but worth being aware of

- Screenshots were captured with `document.body.style.zoom = '2'` for legibility at the page's display size. The capture viewport is 2400×1500; effective UI rendering inside is at 2x scale. This is non-obvious if anyone re-captures later.
- The agent-context screenshot (03) has a **DOM-injected terminal overlay** that mimics the demo's `AgentCli` component (see `web/src/components/Demo.tsx` line 1888 onward, and `web/src/components/Demo.css` line 176 onward). The overlay is `position: fixed` HTML injected via `browser_evaluate` for the capture only — **no code was committed to the repo**. Re-creating that overlay for a future re-capture requires re-running the injection. If we re-capture often, lift the overlay into a real `?overlay=agent-cli` mode in the app.
- The hero DMG link (`https://github.com/rowasc/shippable/releases/latest/download/Shippable.dmg`) returns 404 until v0.1.0 is cut. Expected; once a release exists, the URL resolves automatically — no link change needed.
