import { storyboard, wait, waitFor, press, shot } from "../demo-lib.mjs";

// The default README walkthrough. Drives the `cs-42` fixture through every
// non-trivial piece of UX: the opening plan, hunk/file navigation, AI notes,
// the guide-suggestion that fires after you read >50% of a hunk that calls
// symbols defined elsewhere, the help overlay, and reopening the plan.
//
// Shot `hold` is in seconds — that's how long the frame stays up in the
// final GIF. Transition frames are short (0.4–0.6s); "read this" frames are
// longer (1.5–2.2s).

export default storyboard({
  name: "cs-42-walkthrough",
  url: "http://localhost:5199/?cs=cs-42",
  output: "docs/demo.gif",
  steps: [
    // 1. Opening plan — "where do I start?" view.
    waitFor(".plan"),
    wait(400),
    shot("plan_open", 0.6),
    wait(900),
    shot("plan_open_hold", 1.8),

    // 2. Dismiss plan, land on first file.
    press("Escape", { hold: 400 }),
    shot("diff_first_file", 0.5),
    wait(700),
    shot("diff_first_file_hold", 1.2),

    // 3. Walk a few lines — each one marks reviewed, coverage ticks up.
    press("j", { times: 6, interval: 110, hold: 200 }),
    shot("reviewed_progress", 1.1),

    // 4. Jump to next hunk.
    press("J", { hold: 250 }),
    shot("next_hunk", 0.9),

    // 5. Tab into storage.ts — shows an AI warning note in the inspector.
    press("Tab", { hold: 300 }),
    shot("second_file", 0.5),
    wait(600),
    shot("second_file_hold", 1.0),

    press("j", { times: 4, interval: 110, hold: 200 }),
    shot("ai_note_visible", 1.4),

    // 6. Ack the AI note.
    press("a", { hold: 250 }),
    shot("ai_note_acked", 1.1),

    // 7. Tab into PreferencesPanel.tsx — this hunk references loadPrefs /
    //    savePrefs defined back in storage.ts. Crossing 50% coverage fires
    //    the guide suggestion.
    press("Tab", { hold: 300 }),
    shot("third_file", 0.8),
    press("j", { times: 12, interval: 70, hold: 100 }),
    shot("reviewing_panel", 0.9),
    press("j", { times: 12, interval: 70, hold: 600 }),
    shot("guide_appearing", 0.4),
    wait(1200),
    shot("guide_appearing_hold", 2.2),

    // 8. Accept guide — jumps back to loadPrefs definition in storage.ts.
    press("Enter", { hold: 600 }),
    shot("jumped_to_definition", 0.5),
    wait(900),
    shot("jumped_to_def_hold", 1.8),

    // 9. Help overlay with full keymap.
    press("?", { hold: 350 }),
    shot("help_overlay", 0.4),
    wait(1100),
    shot("help_overlay_hold", 2.0),

    // 10. Close help, reopen plan.
    press("Escape", { hold: 250 }),
    press("p", { hold: 350 }),
    shot("plan_reopened", 0.5),
    wait(900),
    shot("plan_reopened_hold", 1.8),
  ],
});
