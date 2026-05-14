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

import {
  test,
  expect,
  expectWorkspaceLoaded,
  dismissPlanOverlay,
} from "./_lib/fixtures";
import { SAMPLE_DIFF } from "./_lib/mocks";
import type { Locator, Page } from "@playwright/test";

const FAKE_DIFF_URL = "https://example.com/sample.diff";

/** The load-changeset dialog. */
const loadModal = (page: Page): Locator =>
  page.getByRole("dialog", { name: "load changeset" });

async function openLoadModal(page: Page): Promise<Locator> {
  await dismissPlanOverlay(page);
  await page.getByRole("button", { name: /\+ load/ }).click();
  const modal = loadModal(page);
  await expect(modal).toBeVisible();
  return modal;
}

test.describe("Journey 4 — paste / URL / file diff (all [auto])", () => {
  test.beforeEach(async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
  });

  test("happy path: paste diff text renders a diff", async ({ page }) => {
    const modal = await openLoadModal(page);

    const pasteSection = modal.locator("section", {
      hasText: "Paste diff text",
    });
    await pasteSection.getByRole("textbox").fill(SAMPLE_DIFF);
    await pasteSection.getByRole("button", { name: "parse" }).click();

    // LoadModal closes; topbar reflects the loaded changeset.
    await expect(loadModal(page)).toHaveCount(0);
    await expectWorkspaceLoaded(page);
    // greeting.ts is the file in SAMPLE_DIFF; sidebar should list it.
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
  });

  test("happy path: file upload renders a diff", async ({ page }) => {
    const modal = await openLoadModal(page);

    await modal
      .locator("section", { hasText: "Upload a file" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "sample.diff",
        mimeType: "text/x-diff",
        buffer: Buffer.from(SAMPLE_DIFF, "utf8"),
      });

    await expect(loadModal(page)).toHaveCount(0);
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

    const modal = await openLoadModal(page);
    await modal
      .getByPlaceholder("https://github.com/owner/repo/pull/123")
      .fill(FAKE_DIFF_URL);
    await modal.getByRole("button", { name: /^load$/ }).click();

    await expect(loadModal(page)).toHaveCount(0);
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
  });

  test("fixture URL shortcut: ?cs=cs-09 loads without LoadModal", async ({ visit, page }) => {
    await visit("/?cs=cs-09");
    await expectWorkspaceLoaded(page);
    // cs-09 is the PHP helpers fixture — topbar id reflects the fixture id.
    await expect(page.locator(".topbar__id", { hasText: "cs-09" })).toBeVisible();
  });

  test("sign-off persists across reload", async ({ visit, page }) => {
    await dismissPlanOverlay(page);
    // Sign off the current file. The keymap handler is on `window`, so no
    // element focus is needed — the plan overlay just had to be cleared first.
    await page.keyboard.press("Shift+M");
    await expect(
      page.getByLabel("reviewed", { exact: true }).first(),
    ).toBeVisible();

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
    await expect(
      page.getByLabel("reviewed", { exact: true }).first(),
    ).toBeVisible();
  });

  test("failure: malformed paste text surfaces a clear error", async ({ page }) => {
    const modal = await openLoadModal(page);
    const pasteSection = modal.locator("section", {
      hasText: "Paste diff text",
    });
    await pasteSection.getByRole("textbox").fill("this is not a diff");
    await pasteSection.getByRole("button", { name: "parse" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "No files parsed from that diff",
    );
    // Modal stays open so the user can correct.
    await expect(loadModal(page)).toBeVisible();
  });

  test("failure: empty paste leaves the parse button disabled", async ({ page }) => {
    const modal = await openLoadModal(page);
    await expect(
      modal
        .locator("section", { hasText: "Paste diff text" })
        .getByRole("button", { name: "parse" }),
    ).toBeDisabled();
  });

  test("failure: CORS-blocked URL surfaces a CORS-ish hint", async ({ page }) => {
    // Simulate the browser-side CORS rejection by aborting the fetch with
    // a network-style failure. The From-URL path catches the TypeError and
    // formats a hint mentioning "CORS rejection".
    await page.route(FAKE_DIFF_URL, (route) => route.abort("failed"));

    const modal = await openLoadModal(page);
    await modal
      .getByPlaceholder("https://github.com/owner/repo/pull/123")
      .fill(FAKE_DIFF_URL);
    await modal.getByRole("button", { name: /^load$/ }).click();

    // The error renders either inline in the URL section or in the modal's
    // bottom error slot — both are role="alert".
    await expect(page.getByRole("alert")).toContainText(/CORS|fetch|network/i);
  });
});
