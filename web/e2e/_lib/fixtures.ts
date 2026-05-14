// Playwright test fixtures. The `app` fixture is the default entry point:
// it stubs the boot probes and exposes a `visit(path?)` helper that waits
// for the gate to fall through (or to surface a deliberate failure mode).

import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { mockAuthList, mockHealthy, mockPromptsEmpty } from "./mocks";

export interface AppFixture {
  page: Page;
  /** Navigate to `path` (default `/?cs=42`) with boot probes already healthy. */
  visit: (path?: string) => Promise<void>;
}

export interface VisitOpts {
  /** Default true — sets the localStorage skip flag so the boot CredentialsPanel
   *  is bypassed. Set to false for tests that need to exercise the boot panel. */
  skipAnthropic?: boolean;
}

export const test = base.extend<AppFixture & { visit: (path?: string, opts?: VisitOpts) => Promise<void> }>({
  visit: async ({ page }, use) => {
    // Default boot mocks. Tests that exercise the unhealthy path call
    // `mockHealthDown(page)` BEFORE `visit()` — page.route order matters and
    // later registrations win on the same pattern via `unroute` semantics.
    await mockHealthy(page);
    await mockAuthList(page, []);
    await mockPromptsEmpty(page);

    await use(async (path = "/?cs=42", opts: VisitOpts = {}) => {
      const skipAnthropic = opts.skipAnthropic !== false;
      if (skipAnthropic) {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("shippable:anthropic:skip", "true");
          } catch {}
        });
      }
      await page.goto(path);
    });
  },
});

export { expect };

/** Wait for the boot CredentialsPanel to render — used by Journey 1. */
export async function expectBootCredentialsPanel(page: Page): Promise<void> {
  await expect(page.locator(".boot-gate__box .creds")).toBeVisible();
  await expect(
    page.locator(".creds__title", { hasText: "anthropic" }),
  ).toBeVisible();
}

/** Wait for the workspace to be loaded (diff visible). */
export async function expectWorkspaceLoaded(page: Page): Promise<void> {
  await expect(page.locator(".diff")).toBeVisible({ timeout: 10_000 });
}

/** Dismiss the plan overlay if it's covering the workspace. The overlay
 *  mounts a tick after `.diff` (the plan is computed after the first render),
 *  so wait for it briefly rather than racing a bare count() check — otherwise
 *  it slips in *after* the check and stays open for the rest of the test. */
export async function dismissPlanOverlay(page: Page): Promise<void> {
  const overlay = page.locator(".planview-overlay");
  const appeared = await overlay
    .waitFor({ state: "visible", timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "hidden" });
}

/** A visible topbar action button by label. `TopbarActions` keeps a hidden,
 *  aria-hidden measurement clone of every item in the DOM for its width
 *  calculation; scoping to direct children of `.topbar-actions` matches only
 *  the real button, not the clone. (Items collapsed into the overflow kebab
 *  won't match — open the kebab for those.) */
export function topbarBtn(page: Page, label: string | RegExp): Locator {
  return page.locator(".topbar-actions > .topbar__btn", { hasText: label });
}
