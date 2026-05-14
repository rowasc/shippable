// Journey 6 — Cross-cutting surfaces. Covers the [auto] steps for: keyboard
// help overlay, theme cycling (verify the class flip — visual is [manual]),
// Settings access from the topbar, Add-GitHub-host trust flow, Cmd+K palette,
// recents list on Welcome, ?cs= URL shortcut (also covered in J4).
//
// [manual] steps (FindBar, webview zoom, packaged-DMG behaviour) stay in the
// manual track since they depend on Tauri / native menus.

import { test, expect, expectWorkspaceLoaded, dismissPlanOverlay } from "./_lib/fixtures";
import { mockAuthList, mockAuthWriteable } from "./_lib/mocks";

test.describe("Journey 6 — cross-cutting", () => {
  test.beforeEach(async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);
  });

  test("keyboard help: ? opens the help overlay; Escape closes", async ({ page }) => {
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "keybindings" });
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("theme cycling: switching themes updates <html data-theme>", async ({ page }) => {
    // getByRole ignores the aria-hidden TopbarActions measurement clone, so no
    // scoping needed — it matches only the live theme picker.
    const themeSelect = page.getByRole("combobox", {
      name: "Select UI and code theme",
    });
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
    const palette = page.getByRole("dialog", { name: "command palette" });
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("search app actions…")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });

  test("Settings → Add GitHub host shows the trust step before the token field", async ({ page }) => {
    await page.getByRole("button", { name: "settings" }).click();
    const settings = page.getByRole("dialog", { name: "settings" });
    await expect(settings).toBeVisible();

    await settings.getByRole("button", { name: /Add GitHub host/ }).click();
    // Type a non-github.com host — should land on the trust stage.
    await settings
      .getByPlaceholder("host (e.g. ghe.example.com)")
      .fill("github.example.com");
    // Advance from the host stage to the trust interstitial.
    await settings.getByRole("button", { name: "continue" }).click();

    await expect(
      settings.getByRole("button", { name: /I trust github\.example\.com/ }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("comment nav: n / Shift+N jump the cursor between comment lines", async ({
    page,
  }) => {
    // cs-42 ships with review comments and AI notes. `n` jumps the cursor to
    // the next comment-bearing line; Shift+N returns to the previous one.
    const cursor = page.locator('[aria-current="true"]');
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

test.describe("Journey 6 — Settings credential rows", () => {
  test("clearing a GitHub PAT row unsets it", async ({ visit, page }) => {
    // Start with a GitHub host already configured so Settings shows its row.
    await mockAuthList(page, [{ kind: "github", host: "github.com" }]);
    await mockAuthWriteable(page);
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

    await page.getByRole("button", { name: "settings" }).click();
    const settings = page.getByRole("dialog", { name: "settings" });
    const clear = settings.getByRole("button", { name: "clear github.com" });
    await expect(clear).toBeVisible();

    // After clearing, the row flips to unset — the clear affordance goes away.
    let cleared = false;
    await page.unroute("**/api/auth/list");
    await page.route("**/api/auth/list", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          credentials: cleared ? [] : [{ kind: "github", host: "github.com" }],
        }),
      }),
    );
    await page.route("**/api/auth/clear", async (route) => {
      cleared = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await clear.click();
    await expect(
      settings.getByRole("button", { name: "clear github.com" }),
    ).toHaveCount(0);
  });
});

test.describe("Journey 6 — Welcome recents", () => {
  test("recents survive a reload and can be dismissed", async ({ page, visit }) => {
    // Exercise the real write path: loading a changeset pushes it into the
    // recents store (App.tsx pushRecent), so no hand-seeded localStorage.
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);

    // Back on Welcome, the just-loaded changeset shows in recents. The open
    // button's name starts with the title; the forget button's starts with
    // "forget" — anchor so we match only the open button.
    await visit("/");
    const recent = page.getByRole("button", {
      name: /^Add user preferences panel/,
    });
    await expect(recent).toBeVisible();

    // Dismissing the entry removes it; the removal persists across reload.
    await page
      .getByRole("button", { name: "forget Add user preferences panel" })
      .click();
    await expect(recent).toHaveCount(0);

    await page.reload();
    await expect(recent).toHaveCount(0);
  });
});
