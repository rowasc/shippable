// Journey 6 — Cross-cutting surfaces. Covers the [auto] steps for: keyboard
// help overlay, theme cycling (verify the class flip — visual is [manual]),
// Settings access from the topbar, Add-GitHub-host trust flow, Cmd+K palette,
// recents list on Welcome, ?cs= URL shortcut (also covered in J4).
//
// [manual] steps (FindBar, webview zoom, packaged-DMG behaviour) stay in the
// manual track since they depend on Tauri / native menus.

import { test, expect, expectWorkspaceLoaded, dismissPlanOverlay } from "./_lib/fixtures";

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
    // The open button's name starts with the title; the forget button's
    // starts with "forget" — anchor so we match only the open button.
    const recent = page.getByRole("button", { name: /^Friendlier greeting/ });
    await expect(recent).toBeVisible();

    // Dismissing the entry removes it; the empty state takes over.
    await page
      .getByRole("button", { name: "forget Friendlier greeting" })
      .click();
    await expect(recent).toHaveCount(0);

    await page.reload();
    await expect(recent).toHaveCount(0);
  });
});
