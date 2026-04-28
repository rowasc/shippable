import { storyboard, wait, waitFor, press, shot, click } from "../demo-lib.mjs";
import { mockPlanRoute } from "./_fixtures.mjs";

// Walks the AI-generated plan flow on cs-42:
//   - opens with the plan overlay and the "Claude is reading the diff…" status
//   - waits ~2.5s, then the canned plan response lands and the overlay re-renders
//   - reviewer clicks an entry point — overlay closes, cursor lands on the
//     defining hunk in storage.ts
//
// /api/plan is mocked from _fixtures.mjs so the demo regenerates without an
// API key and is deterministic across runs.

export default storyboard({
  name: "ai-plan",
  url: "http://localhost:5199/?cs=cs-42",
  output: "docs/ai-plan.gif",
  routes: [mockPlanRoute(2500)],
  steps: [
    // 1. Plan overlay opens with the rule-based plan and a "Send to Claude"
    //    button. Nothing has been sent over the network yet.
    waitFor(".plan"),
    wait(300),
    shot("plan_idle", 0.6, { caption: "Open the diff — a rule-based plan from the file structure" }),
    wait(1100),
    shot("plan_idle_hold", 2.0),

    // 2. Reviewer clicks "Send to Claude" — the request goes out, the
    //    button is replaced by the "Claude is reading the diff…" status.
    click(".plan__h-btn", { hold: 300 }),
    shot("plan_loading", 0.5, { caption: "Sending the diff to Claude for review" }),
    wait(900),
    shot("plan_loading_hold", 1.4),

    // 3. Wait for the AI plan to swap in — the loading status disappears
    //    and the intent claims re-render with new text.
    wait(1500),
    shot("plan_ai_arrived", 0.5, { caption: "Claude's plan: intent claims grounded in the code" }),
    wait(900),
    shot("plan_ai_hold", 2.0),

    // 3. Pause on the entry-points section so the reader can see the
    //    "where to start" picks.
    wait(800),
    shot("plan_entries", 1.6, { caption: "Recommended entry points — where to start reading" }),

    // 4. Click the first entry point — overlay closes, cursor lands on the
    //    defining hunk of storage.ts.
    press("Enter", { hold: 500 }),
    shot("jumped_to_entry", 0.6, { caption: "Jump straight to the defining hunk" }),
    wait(900),
    shot("jumped_to_entry_hold", 1.8),

    // 5. Reopen plan with `p` to show the AI plan is sticky for this session.
    press("p", { hold: 350 }),
    shot("plan_reopened", 0.5, { caption: "Press p to revisit the plan anytime" }),
    wait(900),
    shot("plan_reopened_hold", 1.6),
  ],
});
