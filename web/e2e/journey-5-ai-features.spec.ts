// Journey 5 — AI features inside a review. The plan + prompt-run paths run end
// to end: real boot panel → real /api/plan + /api/review → fake upstream
// (scripts/fake-upstream.mjs). Inspector notes and the code runner are
// hermetic (cs-42 ships AI notes; the WASM runner is client-side). The
// rate-limit branch page.route()s a 429 — a failure mode that's impractical to
// trigger for real.

import {
  test,
  expect,
  expectWorkspaceLoaded,
  ensureAnthropicConfigured,
  dismissPlanOverlay,
} from "./_lib/fixtures";
import { mockAuthList } from "./_lib/mocks";

test.describe("Journey 5 — AI features", () => {
  test("plan: Send to Claude runs /api/plan through to the fake upstream", async ({
    visit,
    page,
  }) => {
    // Real path: a key in the server's auth store, then let "Send to Claude"
    // hit the real /api/plan — which calls the fake upstream and feeds its
    // structured output back through the server's assemblePlan.
    await ensureAnthropicConfigured(page, visit);

    // The rule-based plan is open by default; Send to Claude swaps in the AI
    // plan, whose intent claim carries the fake upstream's marker text.
    await expect(
      page.getByRole("heading", { name: /Add user preferences panel/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send to Claude" }).click();
    await expect(page.getByText(/FAKE-PLAN:/)).toBeVisible();
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

  test("Inspector AI notes: a acks, r opens a reply composer", async ({
    visit,
    page,
  }) => {
    // cs-42 ships AI notes — no AI call needed. `n` jumps the cursor to the
    // first note-bearing line; the a/r keymaps only fire on `lineHasAiNote`.
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);

    await page.keyboard.press("n");
    const cursor = page.locator('[aria-current="true"]');
    // landed on a line that carries an AI note
    await expect(cursor).toHaveAttribute("data-ai-severity", /.+/);

    // `a` toggles the note's ack state on the line; pressing it again clears.
    await page.keyboard.press("a");
    await expect(cursor).toHaveAttribute("data-acked", "true");
    await page.keyboard.press("a");
    await expect(cursor).not.toHaveAttribute("data-acked", "true");

    // `r` opens the reply composer in the Inspector.
    await page.keyboard.press("r");
    await expect(page.getByPlaceholder("Write a reply…")).toBeVisible();
  });

  test("code runner: e opens the inline runner on a TS hunk", async ({
    visit,
    page,
  }) => {
    // cs-42's first file is a .ts file; `e` runs the current hunk.
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);

    await page.keyboard.press("e");
    const runner = page.locator(".coderunner--open");
    await expect(runner).toBeVisible();
    await expect(runner.locator(".coderunner__lang")).toBeVisible();
  });

  test("prompt picker: / opens it; running a prompt streams via /api/review", async ({
    visit,
    page,
  }) => {
    // Real path: a key configured, open the picker (real prompt library), run
    // the first built-in prompt — /api/review streams from the fake upstream.
    await ensureAnthropicConfigured(page, visit);
    await dismissPlanOverlay(page);

    await page.keyboard.press("/");
    await expect(page.getByPlaceholder("search prompts…")).toBeVisible();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByRole("button", { name: "run", exact: true }).click();

    // The run row appears and settles streaming… → done; expanding it shows
    // the fake upstream's streamed marker text.
    const run = page.locator(".promptrun").first();
    await expect(run.locator(".promptrun__status")).toHaveText("done", {
      timeout: 10_000,
    });
    await run.getByRole("button", { expanded: false }).click();
    await expect(run.locator(".promptrun__body")).toContainText("FAKE-REVIEW:");
  });

  test("rate-limit: a 429 from /api/review surfaces a clear error", async ({
    visit,
    page,
  }) => {
    // page.route() the 429 — the server's per-IP rate limit is impractical to
    // trip in a test, and this exercises the client's error rendering.
    await mockAuthList(page, [{ kind: "anthropic" }]);
    await page.route("**/api/review", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "rate limit exceeded" }),
      }),
    );
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);

    await page.keyboard.press("/");
    await expect(page.getByPlaceholder("search prompts…")).toBeVisible();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByRole("button", { name: "run", exact: true }).click();

    const run = page.locator(".promptrun").first();
    await expect(run.locator(".promptrun__status--error")).toBeVisible();
    // The error detail lives in the expanded body.
    await run.getByRole("button", { expanded: false }).click();
    await expect(run.locator(".promptrun__err")).toContainText("429");
  });
});
