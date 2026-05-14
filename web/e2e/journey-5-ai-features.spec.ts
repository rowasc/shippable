// Journey 5 — AI features inside a review. The plan path runs end to end:
// real boot panel → real /api/plan → fake upstream (_lib/scripts/fake-
// upstream.mjs). The rest (Inspector AI notes, code runner, prompt library)
// is sketched here as fixmes. Each test names the mock surface area it needs.

import {
  test,
  expect,
  expectWorkspaceLoaded,
  expectBootCredentialsPanel,
  dismissPlanOverlay,
} from "./_lib/fixtures";
import { mockReviewStream } from "./_lib/mocks";

test.describe("Journey 5 — AI features", () => {
  test("plan: Send to Claude runs /api/plan through to the fake upstream", async ({
    visit,
    page,
  }) => {
    // Real path: store a key in the server via the boot panel, then let
    // "Send to Claude" hit the real /api/plan — which calls the fake upstream
    // and feeds its structured output back through the server's assemblePlan.
    await page.unroute("**/api/auth/list"); // use the real auth store
    await visit("/?cs=42", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);
    await page.locator(".creds__input").fill("sk-ant-e2e-fake");
    await page.locator(".creds__btn--primary", { hasText: "Save" }).click();
    await expectWorkspaceLoaded(page);

    // The rule-based plan is open by default; Send to Claude swaps in the AI
    // plan, whose intent claim carries the fake upstream's marker text.
    await expect(page.locator(".plan__headline")).toBeVisible();
    await page
      .locator(".plan__h-btn", { hasText: "Send to Claude" })
      .click();
    await expect(page.locator(".planview-overlay")).toContainText("FAKE-PLAN:");
  });

  test("free runner: Shift+R opens an empty one-off runner", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);

    await page.keyboard.press("Shift+R");
    const runner = page.locator(".coderunner--free");
    await expect(runner).toBeVisible();
    await expect(runner.locator(".coderunner__shape")).toHaveText("free runner");
    // Language picker offers the WASM-backed runtimes.
    await expect(runner.locator(".coderunner__lang")).toBeVisible();
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
