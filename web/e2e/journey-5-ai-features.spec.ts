// Journey 5 — AI features inside a review. The plan-overlay AI swap is
// already covered by `scripts/smoke-boot-gate.mjs` (steps 3–5); the rest of
// the journey (plan diagram, Inspector AI notes, code runner, prompt
// library) is sketched here as fixmes. Each test names the mock surface
// area it'll need.

import { test, expect, expectWorkspaceLoaded } from "./_lib/fixtures";
import { mockAuthList, mockPlanOk, mockReviewStream } from "./_lib/mocks";

test.describe("Journey 5 — AI features", () => {
  test("plan overlay: Send to Claude swaps the rule-based plan for the mocked AI plan", async ({
    visit,
    page,
  }) => {
    await mockAuthList(page, [{ kind: "anthropic" }]);
    await mockPlanOk(page, { headline: "Mocked AI plan headline" });
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);

    // Plan overlay is open by default. Capture the rule-based headline,
    // then click "Send to Claude" and assert the headline flips.
    await expect(page.locator(".plan__headline")).toBeVisible();
    await page
      .locator(".plan__h-btn", { hasText: "Send to Claude" })
      .click();
    await expect(page.locator(".plan__headline")).toContainText(
      "Mocked AI plan headline",
    );
  });

  test.fixme("Inspector AI notes: a/r toggle ack and add reply", async () => {
    // Needs /api/review or a server-side AI-notes endpoint mocked with at
    // least one note keyed to a hunk in cs-42. Walk to the line, press `a`,
    // assert ack state flips. Press `r`, type, submit, assert reply renders.
    void mockReviewStream;
  });

  test.fixme("prompt picker: / opens; running a prompt streams via /api/review", async () => {
    // Needs /api/prompts mocked to return ≥1 prompt. Press `/`, pick the
    // first, assert a run row appears and transitions streaming → done.
  });

  test.fixme("code runner: e runs the current JS/TS hunk inline", async () => {
    // Load cs-09-php or a TS fixture; press `e`; assert .runner appears
    // pre-filled. (Sandbox crash failure-branch is covered by the existing
    // coderunner-sandbox smoke.)
  });

  test.fixme("rate-limit response renders a clear message", async () => {
    // Mock /api/review to return 429 with the rate-limit discriminator;
    // assert the run row surfaces the rate-limit copy without crashing.
  });
});
