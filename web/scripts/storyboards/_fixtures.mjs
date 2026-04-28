// Shared fixtures for storyboards. Anything imported by more than one
// storyboard lives here.

// Hand-crafted PlanResponse for cs-42. Used to mock /api/plan so the
// AI-plan flow renders deterministically without an API key. The intent
// claims and entry points are realistic-shaped data, not a real Claude
// response.
export const cs42CannedPlan = {
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

// Mock /api/plan with the canned response. `delayMs` controls how long the
// "Claude is reading the diff…" loading state stays visible before the swap.
export function mockPlanRoute(delayMs = 2500) {
  return {
    url: "**/api/plan",
    handler: async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cs42CannedPlan),
      });
    },
  };
}
