import { storyboard, wait, waitFor, press, shot, click } from "../demo-lib.mjs";

// Walks the AI-generated plan flow on cs-42:
//   - opens with the plan overlay and the "Claude is reading the diff…" status
//   - waits ~2.5s, then the canned plan response lands and the overlay re-renders
//   - reviewer clicks an entry point — overlay closes, cursor lands on the
//     defining hunk in storage.ts
//
// /api/plan is mocked with a hand-crafted PlanResponse so the demo regenerates
// without an API key and is deterministic across runs. The intent claims and
// entry points are realistic-shaped data, not a real Claude response.

const cannedPlan = {
  plan: {
    headline: "Add user preferences with browser-storage persistence",
    intent: [
      {
        text: "Defines a persistence layer (loadPrefs / savePrefs) that reads and writes user preferences to browser storage.",
        evidence: [
          { kind: "hunk", hunkId: "cs-42/src/utils/storage.ts#h2" },
          { kind: "symbol", name: "loadPrefs", definedIn: "src/utils/storage.ts" },
          { kind: "symbol", name: "savePrefs", definedIn: "src/utils/storage.ts" },
        ],
      },
      {
        text: "Introduces a Preferences shape on the User type to model the new fields.",
        evidence: [
          { kind: "file", path: "src/types/user.ts" },
          { kind: "symbol", name: "Preferences", definedIn: "src/types/user.ts" },
        ],
      },
      {
        text: "Adds a PreferencesPanel UI that hydrates from storage on mount and persists on change.",
        evidence: [
          { kind: "file", path: "src/components/PreferencesPanel.tsx" },
        ],
      },
      {
        text: "Includes a test that exercises the panel against the persistence layer end-to-end.",
        evidence: [
          { kind: "file", path: "src/components/__tests__/PreferencesPanel.test.tsx" },
        ],
      },
    ],
    map: {
      files: [
        { fileId: "cs-42/src/types/user.ts", path: "src/types/user.ts", status: "modified", added: 5, removed: 0, isTest: false },
        { fileId: "cs-42/src/utils/storage.ts", path: "src/utils/storage.ts", status: "added", added: 24, removed: 0, isTest: false },
        { fileId: "cs-42/src/components/PreferencesPanel.tsx", path: "src/components/PreferencesPanel.tsx", status: "added", added: 38, removed: 0, isTest: false },
        { fileId: "cs-42/src/components/__tests__/PreferencesPanel.test.tsx", path: "src/components/__tests__/PreferencesPanel.test.tsx", status: "added", added: 22, removed: 0, isTest: true },
      ],
      symbols: [
        { name: "Preferences", definedIn: "src/types/user.ts", referencedIn: ["src/utils/storage.ts", "src/components/PreferencesPanel.tsx"] },
        { name: "loadPrefs", definedIn: "src/utils/storage.ts", referencedIn: ["src/components/PreferencesPanel.tsx"] },
        { name: "savePrefs", definedIn: "src/utils/storage.ts", referencedIn: ["src/components/PreferencesPanel.tsx"] },
      ],
    },
    entryPoints: [
      {
        fileId: "cs-42/src/utils/storage.ts",
        hunkId: "cs-42/src/utils/storage.ts#h2",
        reason: {
          text: "Defines loadPrefs and savePrefs, which the rest of the diff is built around. Read this first.",
          evidence: [
            { kind: "symbol", name: "loadPrefs", definedIn: "src/utils/storage.ts" },
            { kind: "symbol", name: "savePrefs", definedIn: "src/utils/storage.ts" },
            { kind: "hunk", hunkId: "cs-42/src/utils/storage.ts#h2" },
          ],
        },
      },
      {
        fileId: "cs-42/src/components/__tests__/PreferencesPanel.test.tsx",
        reason: {
          text: "Test file — encodes the intended behavior of the panel against the persistence layer.",
          evidence: [
            { kind: "file", path: "src/components/__tests__/PreferencesPanel.test.tsx" },
          ],
        },
      },
    ],
  },
};

// Hold the response for ~2.5s so the "Claude is reading the diff…" status
// is visible before the swap. Tunable; longer feels slow, shorter feels
// like the AI plan was always there.
const RESPONSE_DELAY_MS = 2500;

export default storyboard({
  name: "ai-plan",
  url: "http://localhost:5199/?cs=cs-42",
  output: "docs/ai-plan.gif",
  routes: [
    {
      url: "**/api/plan",
      handler: async (route) => {
        await new Promise((r) => setTimeout(r, RESPONSE_DELAY_MS));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(cannedPlan),
        });
      },
    },
  ],
  steps: [
    // 1. Plan overlay opens with the rule-based plan and a "Send to Claude"
    //    button. Nothing has been sent over the network yet.
    waitFor(".plan"),
    wait(300),
    shot("plan_idle", 0.6),
    wait(1100),
    shot("plan_idle_hold", 2.0),

    // 2. Reviewer clicks "Send to Claude" — the request goes out, the
    //    button is replaced by the "Claude is reading the diff…" status.
    click(".plan__h-btn", { hold: 300 }),
    shot("plan_loading", 0.5),
    wait(900),
    shot("plan_loading_hold", 1.4),

    // 3. Wait for the AI plan to swap in — the loading status disappears
    //    and the intent claims re-render with new text.
    wait(1500),
    shot("plan_ai_arrived", 0.5),
    wait(900),
    shot("plan_ai_hold", 2.0),

    // 3. Pause on the entry-points section so the reader can see the
    //    "where to start" picks.
    wait(800),
    shot("plan_entries", 1.6),

    // 4. Click the first entry point — overlay closes, cursor lands on the
    //    defining hunk of storage.ts.
    press("Enter", { hold: 500 }),
    shot("jumped_to_entry", 0.6),
    wait(900),
    shot("jumped_to_entry_hold", 1.8),

    // 5. Reopen plan with `p` to show the AI plan is sticky for this session.
    press("p", { hold: 350 }),
    shot("plan_reopened", 0.5),
    wait(900),
    shot("plan_reopened_hold", 1.6),
  ],
});
