// Journey 6 — Cross-cutting surfaces. Covers the [auto] steps for: keyboard
// help overlay, theme cycling (verify the class flip — visual is [manual]),
// Settings access from the topbar, Add-GitHub-host trust flow, Cmd+K palette,
// recents list on Welcome, ?cs= URL shortcut (also covered in J4).
//
// [manual] steps (FindBar, webview zoom, packaged-DMG behaviour) stay in the
// manual track since they depend on Tauri / native menus.

import { test, expect, expectWorkspaceLoaded, dismissPlanOverlay, topbarBtn } from "./_lib/fixtures";

test.describe("Journey 6 — cross-cutting", () => {
  test.beforeEach(async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);
  });

  test("keyboard help: ? opens the help overlay; Escape closes", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.locator(".help__title", { hasText: /keybindings/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".help__box")).toHaveCount(0);
  });

  test("theme cycling: switching themes updates <html data-theme>", async ({ page }) => {
    // Scope to the visible topbar — TopbarActions keeps a hidden measurement
    // clone of its leading slot, so a bare `.theme-picker__select` matches two.
    const themeSelect = page.locator(".topbar-actions > .theme-picker .theme-picker__select");
    // Default is dark — confirm baseline.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    for (const themeId of ["light", "dollhouse", "dollhouseNoir", "dark"]) {
      await themeSelect.selectOption(themeId);
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
    }

    // Persistence: reload and confirm the last selection survives.
    await themeSelect.selectOption("light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("Cmd+K opens the command palette", async ({ page }) => {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+KeyK`);
    await expect(
      page.locator(".modal__h-label", { hasText: "command palette" }),
    ).toBeVisible();
    await expect(page.locator(".picker__search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".cmdpal__box")).toHaveCount(0);
  });

  test("Settings → Add GitHub host shows the trust step before the token field", async ({ page }) => {
    await topbarBtn(page, "settings").click();
    await expect(page.locator(".modal__h-label", { hasText: "settings" })).toBeVisible();

    await page.locator(".creds__btn", { hasText: /Add GitHub host/ }).click();
    // Type a non-github.com host — should land on the trust stage.
    const hostInput = page.locator(".creds__add input").first();
    await hostInput.fill("github.example.com");
    // Advance from the host stage to the trust interstitial.
    await page
      .locator(".creds__add .creds__btn--primary", { hasText: "continue" })
      .click();

    await expect(
      page.locator("button", { hasText: /I trust github\.example\.com/ }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("comment nav: n / Shift+N jump the cursor between comment lines", async ({
    page,
  }) => {
    // cs-42 ships with review comments and AI notes. `n` jumps the cursor to
    // the next comment-bearing line; Shift+N returns to the previous one.
    const cursor = page.locator(".line--cursor");
    await page.keyboard.press("n");
    const firstStop = await cursor.textContent();
    await page.keyboard.press("n");
    await expect.poll(() => cursor.textContent()).not.toBe(firstStop);
    await page.keyboard.press("Shift+N");
    await expect.poll(() => cursor.textContent()).toBe(firstStop);
  });
});

test.describe("Journey 6 — standalone entry points", () => {
  test("gallery.html renders the screen catalog", async ({ page, visit }) => {
    await visit("/gallery.html");
    await expect(page.locator(".gallery")).toBeVisible();
    await expect(page.locator(".gallery__nav .gallery__item").first()).toBeVisible();
  });

  test("feature-docs.html renders the per-feature viewer", async ({
    page,
    visit,
  }) => {
    await visit("/feature-docs.html");
    // The default view renders `.feature-docs__workspace`; other views render
    // `.feature-docs` — match either.
    await expect(page.locator('[class^="feature-docs"]').first()).toBeVisible();
  });
});

test.describe("Journey 6 — Welcome recents", () => {
  test("recents survive a reload and can be dismissed", async ({ page, visit }) => {
    // Seed the recents store before navigation — the Welcome screen reads
    // from localStorage at mount.
    await page.addInitScript(() => {
      const payload = {
        v: 1,
        entries: [
          {
            id: "stub-recent-1",
            title: "Friendlier greeting",
            addedAt: Date.now(),
            source: { kind: "paste" },
            changeset: {
              id: "stub-recent-1",
              title: "Friendlier greeting",
              files: [],
            },
            interactions: {},
          },
        ],
      };
      try {
        window.localStorage.setItem(
          "shippable:recents:v1",
          JSON.stringify(payload),
        );
      } catch {}
    });

    await visit("/");
    await expect(
      page.locator(".welcome__recent-title", { hasText: "Friendlier greeting" }),
    ).toBeVisible();

    // Dismissing the entry removes it; the empty state takes over.
    await page.locator(".welcome__recent-x").first().click();
    await expect(
      page.locator(".welcome__recent-title", { hasText: "Friendlier greeting" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(
      page.locator(".welcome__recent-title", { hasText: "Friendlier greeting" }),
    ).toHaveCount(0);
  });
});
