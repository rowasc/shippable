import {
  storyboard,
  wait,
  waitFor,
  press,
  shot,
  click,
  type,
  select,
  goto,
  setSelection,
} from "../demo-lib.mjs";
import { mockPlanRoute } from "./_fixtures.mjs";

// Full feature walkthrough on cs-42 — the README "what does this thing
// actually do" GIF. Touches every key surface in one pass:
//
//   plan (rule-based) → send to Claude → AI plan → entry-point jump →
//   line nav → user comment → AI note + ack → cross-file guide →
//   help overlay → reopen plan
//
// /api/plan is mocked so this regenerates without an API key.

export default storyboard({
  name: "all",
  url: "http://localhost:5199/?cs=cs-42",
  output: "docs/all.gif",
  routes: [mockPlanRoute(2200)],
  steps: [
    // 1. Plan opens with the rule-based plan (no AI call yet).
    waitFor(".plan"),
    wait(300),
    shot("plan_idle", 0.9, {
      caption: "Open a diff — Shippable starts with a structural plan",
    }),
    wait(900),
    shot("plan_idle_hold", 2.4),

    // 2. Click "Send to Claude" — the request goes out, button swaps for
    //    the "Claude is reading the diff…" status.
    click(".plan__h-btn", { hold: 300 }),
    shot("plan_loading", 0.8, {
      caption: "Send the diff to Claude for review",
    }),
    wait(1000),
    shot("plan_loading_hold", 1.8),

    // 3. AI plan lands — intent claims and entry points re-render.
    wait(1400),
    shot("plan_ai", 0.8, {
      caption: "Claude's plan: intent claims grounded in the code",
    }),
    wait(800),
    shot("plan_ai_hold", 2.4),

    // 4. Click the first entry point — overlay closes, cursor lands on
    //    storage.ts hunk 2 (the loadPrefs definition). Click directly
    //    rather than press Enter, since the plan-overlay focus path is
    //    not deterministic after the AI plan re-renders.
    click("button.plan__entry-btn", { hold: 500 }),
    shot("at_entry", 0.9, {
      caption: "Jump straight to the defining hunk",
    }),
    wait(700),
    shot("at_entry_hold", 1.8),

    // 5. Walk a few lines into loadPrefs — each one marks reviewed.
    press("j", { times: 3, interval: 110, hold: 200 }),
    shot("walk_lines", 1.8, {
      caption: "Walk lines with j/k — coverage ticks up as you read",
    }),

    // 6. Press `c` to drop a comment, type a note, send it.
    press("c", { hold: 250 }),
    wait(250),
    shot("comment_open", 0.8, {
      caption: "Press c to leave a comment on the current line",
    }),
    type(
      ".composer__input",
      "tiny nit: should this default to {} instead of null?",
      { hold: 300 },
    ),
    shot("comment_typed", 1.2),
    click(".composer__send", { hold: 400 }),
    shot("comment_sent", 0.9, {
      caption: "Your comment lands alongside the AI notes for this line",
    }),
    wait(800),
    shot("comment_sent_hold", 2.1),

    // 7. Walk into the AI-noted lines further down loadPrefs.
    press("j", { times: 3, interval: 110, hold: 200 }),
    shot("ai_note_visible", 2.1, {
      caption: "AI notes flag risky-looking lines as you go",
    }),

    // 8. Ack the AI note.
    press("a", { hold: 250 }),
    shot("ai_note_acked", 1.8, {
      caption: "Press a to acknowledge once you've checked it",
    }),

    // 9. Tab over to PreferencesPanel.tsx, which references loadPrefs /
    //    savePrefs from storage.ts. Reading past 50% fires the guide.
    press("Tab", { hold: 300 }),
    shot("next_file", 0.8, {
      caption: "Tab between files",
    }),
    press("j", { times: 14, interval: 70, hold: 100 }),
    wait(900),
    shot("guide_appears", 2.4, {
      caption: "Cross-file guides surface when symbols connect",
    }),

    // 10. Accept the guide — cursor jumps back to the loadPrefs definition.
    press("Enter", { hold: 500 }),
    shot("at_definition", 0.9, {
      caption: "Accept to jump straight to the definition",
    }),
    wait(800),
    shot("at_definition_hold", 1.8),

    // 11. Theme picker — cycle through every theme, one capture each. Each
    //     swap repaints UI chrome and Shiki code tokens together.
    select(".theme-picker__select", "light", { hold: 350 }),
    shot("theme_light", 1.4, {
      caption: "Light theme — UI and code colors repaint together",
    }),
    select(".theme-picker__select", "dollhouse", { hold: 350 }),
    shot("theme_dollhouse", 1.4, {
      caption: "Dollhouse — a softer light palette",
    }),
    select(".theme-picker__select", "dollhouseNoir", { hold: 350 }),
    shot("theme_dollhouse_noir", 1.4, {
      caption: "Dollhouse Noir — same hues, dimmed for night",
    }),
    select(".theme-picker__select", "dark", { hold: 350 }),
    shot("theme_back_dark", 1.4, {
      caption: "Back to dark — the choice is persisted across sessions",
    }),

    // 12. Help overlay — full keymap.
    press("?", { hold: 350 }),
    shot("help", 0.8, {
      caption: "Press ? for the full keymap",
    }),
    wait(900),
    shot("help_hold", 2.4),

    // 13. Reopen plan with `p` to show the AI plan is sticky.
    press("Escape", { hold: 250 }),
    press("p", { hold: 350 }),
    shot("plan_back", 0.8, {
      caption: "The plan stays a keystroke away — press p anytime",
    }),
    wait(900),
    shot("plan_back_hold", 2.4),

    // 14. Custom PHP runner — switch to the cs-09 fixture (a real .php file)
    //     so the runner pill detects PHP, then seed a self-contained snippet,
    //     bind an input, and run it through the in-browser php-wasm runtime.
    press("Escape", { hold: 250 }),
    goto("http://localhost:5199/?cs=cs-09", { hold: 600 }),
    waitFor(".diff"),
    press("Escape", { hold: 350 }),
    waitFor(".diff .line .line__text"),
    shot("php_diff", 1.2, {
      caption: "Open a PHP changeset — the inline runner detects the language",
    }),
    setSelection(
      ".diff .line .line__text",
      "function format_money($cents) { return '$' . number_format($cents / 100, 2); }",
    ),
    wait(250),
    waitFor(".coderunner__pill"),
    shot("php_pill", 1.4, {
      caption: "Select code — a `▷ run php` pill floats next to the line",
    }),
    click(".coderunner__pill", { hold: 300 }),
    waitFor(".coderunner__panel"),
    shot("php_panel", 1.2, {
      caption: "Open the runner — bind any free variables you need",
    }),
    type(".coderunner__input-box", "1234", { hold: 350 }),
    click(".coderunner__run"),
    waitFor(".coderunner__out", { timeout: 10000 }),
    wait(400),
    shot("php_output", 2.4, {
      caption: "Real PHP runs in the browser via php-wasm — no server",
    }),
  ],
});
