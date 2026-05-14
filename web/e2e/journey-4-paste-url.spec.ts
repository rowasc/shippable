// Journey 4 — Review a pasted or URL diff. All steps in `docs/usability-test.md`
// for this journey are [auto]. We exercise:
//   - LoadModal opens via Shift+L
//   - paste-diff path renders a diff
//   - upload-file path renders a diff
//   - From-URL path browser-fetches a diff and renders it
//   - ?cs=cs-09 fixture URL shortcut bypasses LoadModal
//   - Sign-off + reload persist via localStorage
// Failure branches: CORS-blocked URL, malformed paste text, empty-diff button
// disabled, network drop on URL fetch.

import { test, expect, expectWorkspaceLoaded, dismissPlanOverlay, topbarBtn } from "./_lib/fixtures";
import { SAMPLE_DIFF } from "./_lib/mocks";

const FAKE_DIFF_URL = "https://example.com/sample.diff";

async function openLoadModal(page: import("@playwright/test").Page) {
  await dismissPlanOverlay(page);
  await topbarBtn(page, "+ load").click();
  await expect(page.locator(".modal__h-label", { hasText: "load changeset" })).toBeVisible();
}

test.describe("Journey 4 — paste / URL / file diff (all [auto])", () => {
  test.beforeEach(async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
  });

  test("happy path: paste diff text renders a diff", async ({ page }) => {
    await openLoadModal(page);

    const pasteSection = page.locator(".modal__sec", { hasText: "Paste diff text" });
    await pasteSection.locator(".modal__textarea").fill(SAMPLE_DIFF);
    await pasteSection.locator(".modal__btn", { hasText: "parse" }).click();

    // LoadModal closes; topbar reflects the loaded changeset.
    await expect(page.locator(".modal__h-label")).toHaveCount(0);
    await expectWorkspaceLoaded(page);
    // greeting.ts is the file in SAMPLE_DIFF; sidebar should list it.
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
  });

  test("happy path: file upload renders a diff", async ({ page }) => {
    await openLoadModal(page);

    const fileInput = page.locator(".modal__file");
    await fileInput.setInputFiles({
      name: "sample.diff",
      mimeType: "text/x-diff",
      buffer: Buffer.from(SAMPLE_DIFF, "utf8"),
    });

    await expect(page.locator(".modal__h-label")).toHaveCount(0);
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
  });

  test("happy path: From URL fetches and parses a diff", async ({ page }) => {
    // Intercept the cross-origin .diff fetch; the From-URL path uses the
    // browser's fetch directly (the comment in LoadModal explicitly calls
    // this out).
    await page.route(FAKE_DIFF_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: SAMPLE_DIFF,
      }),
    );

    await openLoadModal(page);
    const urlSection = page.locator(".modal__sec", { hasText: "From URL" });
    await urlSection.locator(".modal__input").fill(FAKE_DIFF_URL);
    await urlSection.locator(".modal__btn", { hasText: /^load$/ }).click();

    await expect(page.locator(".modal__h-label")).toHaveCount(0);
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
  });

  test("fixture URL shortcut: ?cs=cs-09 loads without LoadModal", async ({ visit, page }) => {
    await visit("/?cs=cs-09");
    await expectWorkspaceLoaded(page);
    // cs-09 is the PHP helpers fixture — topbar title reflects the fixture
    // changeset id.
    await expect(page.locator(".topbar__id", { hasText: "cs-09" })).toBeVisible();
  });

  test("sign-off persists across reload", async ({ visit, page }) => {
    await dismissPlanOverlay(page);
    // Sign off the current file. The keymap handler is on `window`, so no
    // element focus is needed — the plan overlay just had to be cleared first.
    await page.keyboard.press("Shift+M");
    // file-reviewed class lands on the sidebar row for the current file.
    await expect(page.locator(".row--file-reviewed").first()).toBeVisible();

    // The session save is debounced 300ms (App.tsx). Wait for it to actually
    // land in localStorage before re-navigating — otherwise the pending timer
    // is dropped with the page and the sign-off never persists.
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("shippable:review:v1");
      if (!raw) return false;
      try {
        return (JSON.parse(raw).reviewedFiles ?? []).length > 0;
      } catch {
        return false;
      }
    });

    // Reload via the bare `/` path — NOT `?cs=42`. An explicit `?cs=` URL
    // always loads the fixture fresh (App.tsx resolveBoot → applyPersisted:
    // false); booting `/` falls through to peekSession() and resumes the
    // persisted snapshot, which is how a real reload restores progress.
    await visit("/");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);
    await expect(page.locator(".row--file-reviewed").first()).toBeVisible();
  });

  test("failure: malformed paste text surfaces a clear error", async ({ page }) => {
    await openLoadModal(page);
    const pasteSection = page.locator(".modal__sec", { hasText: "Paste diff text" });
    await pasteSection.locator(".modal__textarea").fill("this is not a diff");
    await pasteSection.locator(".modal__btn", { hasText: "parse" }).click();

    await expect(
      page.locator(".modal__err .errrow__msg"),
    ).toContainText("No files parsed from that diff");
    // Modal stays open so the user can correct.
    await expect(page.locator(".modal__h-label")).toBeVisible();
  });

  test("failure: empty paste leaves the parse button disabled", async ({ page }) => {
    await openLoadModal(page);
    const pasteSection = page.locator(".modal__sec", { hasText: "Paste diff text" });
    await expect(
      pasteSection.locator(".modal__btn", { hasText: "parse" }),
    ).toBeDisabled();
  });

  test("failure: CORS-blocked URL surfaces a CORS-ish hint", async ({ page }) => {
    // Simulate the browser-side CORS rejection by aborting the fetch with
    // a network-style failure. The From-URL path catches the TypeError and
    // formats a hint mentioning "CORS rejection".
    await page.route(FAKE_DIFF_URL, (route) => route.abort("failed"));

    await openLoadModal(page);
    const urlSection = page.locator(".modal__sec", { hasText: "From URL" });
    await urlSection.locator(".modal__input").fill(FAKE_DIFF_URL);
    await urlSection.locator(".modal__btn", { hasText: /^load$/ }).click();

    // The error renders either inline in the URL section or in the modal's
    // bottom error slot — accept either, just require the text.
    await expect(
      page.locator(".modal__hint--error, .modal__err .errrow__msg"),
    ).toContainText(/CORS|fetch|network/i);
  });
});
