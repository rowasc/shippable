// Journey 1 — First-run setup. The usability script's [auto] / [mixed]
// steps cover boot-gate behaviour, the Skip → AI-off-chip path, and
// rotating/clearing the key from Settings. The Keychain rehydrate and
// invalid-key-mid-session paths are [manual] and stay in the manual doc.
//
// We opt OUT of the default `visit()` skipAnthropic seed for the boot tests
// since the whole point is to land on the credentials panel.

import {
  test,
  expect,
  expectBootCredentialsPanel,
  expectWorkspaceLoaded,
  topbarBtn,
} from "./_lib/fixtures";
import {
  mockAuthList,
  mockAuthSetRejects,
  mockAuthWriteable,
  mockHealthDown,
  mockHealthy,
} from "./_lib/mocks";

test.describe("Journey 1 — first-run setup", () => {
  test("happy: boot CredentialsPanel renders modally when no key is set", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);
    await expect(
      page.locator(".creds__skip-btn", { hasText: /Skip/ }),
    ).toBeVisible();
    await expect(page.locator(".creds__input")).toBeVisible();
    // Workspace should NOT have rendered yet — the gate is modal.
    await expect(page.locator(".diff")).toHaveCount(0);
  });

  test("happy: save key writes to /api/auth/set and closes the panel", async ({
    visit,
    page,
  }) => {
    const calls: Array<{ kind: string; body: unknown }> = [];
    await mockAuthWriteable(page, (kind, body) => calls.push({ kind, body }));
    // After saving, the panel calls authList to refresh — return the new key.
    let setCalled = false;
    await page.route("**/api/auth/list", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          credentials: setCalled ? [{ kind: "anthropic" }] : [],
        }),
      }),
    );
    await page.route("**/api/auth/set", async (route) => {
      setCalled = true;
      calls.push({ kind: "set", body: JSON.parse(route.request().postData() ?? "null") });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await visit("/?cs=42", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);

    await page.locator(".creds__input").fill("sk-ant-fake-test-key");
    await page.locator(".creds__btn--primary", { hasText: "Save" }).click();

    // Gate falls through; workspace renders.
    await expectWorkspaceLoaded(page);

    expect(calls.some((c) => c.kind === "set")).toBe(true);
    const setCall = calls.find((c) => c.kind === "set") as
      | { body: { credential: { kind: string }; value: string } }
      | undefined;
    expect(setCall?.body?.credential?.kind).toBe("anthropic");
    expect(setCall?.body?.value).toBe("sk-ant-fake-test-key");
  });

  test("failure: server unreachable shows the boot gate with Retry", async ({
    page,
    visit,
  }) => {
    await mockHealthDown(page);
    await visit("/?cs=42", { skipAnthropic: false });

    await expect(
      page.locator(".boot-gate__h", { hasText: "Server unreachable" }),
    ).toBeVisible();
    await expect(
      page.locator(".boot-gate__btn", { hasText: "Retry" }),
    ).toBeVisible();

    // Retry once /api/health is healthy and confirm the gate falls through.
    await page.unroute("**/api/health");
    await mockHealthy(page);
    await page.locator(".boot-gate__btn", { hasText: "Retry" }).click();
    await expectBootCredentialsPanel(page);
  });

  test("failure: Skip → AI-off chip on Welcome", async ({ visit, page }) => {
    // Land on Welcome (no ?cs) so the AI-off chip surface is visible. The
    // boot panel still gates the first paint.
    await visit("/", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);

    await page.locator(".creds__skip-btn", { hasText: /Skip/ }).click();

    // Boot panel dismisses; Welcome surfaces the AI-off chip.
    await expect(page.locator(".welcome__ai-off")).toBeVisible();
    await expect(page.locator(".welcome__ai-off")).toContainText(/AI off/i);

    // Skip persisted in localStorage — reload should NOT re-prompt.
    await page.reload();
    await expect(page.locator(".welcome__ai-off")).toBeVisible();
    await expect(page.locator(".boot-gate__box .creds")).toHaveCount(0);
  });

  test("failure: invalid key — server rejects and surfaces the error", async ({
    visit,
    page,
  }) => {
    await mockAuthSetRejects(page, "invalid_key");
    await visit("/?cs=42", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);

    await page.locator(".creds__input").fill("garbage-key");
    await page.locator(".creds__btn--primary", { hasText: "Save" }).click();

    await expect(page.locator(".creds__error")).toBeVisible();
    // Panel stays open until the user enters a valid key (or skips).
    await expectBootCredentialsPanel(page);
  });
});

test.describe("Journey 1 — Settings credential management ([auto] step 5/6)", () => {
  test("rotate + clear on the Anthropic row", async ({ visit, page }) => {
    // Start in the workspace with a configured Anthropic key. Settings is
    // reachable from the topbar gear.
    await mockAuthList(page, [{ kind: "anthropic" }]);
    await mockAuthWriteable(page);
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);

    // Open Settings via the topbar action.
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay
    await topbarBtn(page, "settings").click();
    await expect(
      page.locator(".modal__h-label", { hasText: "settings" }),
    ).toBeVisible();

    // The anthropic row shows lowercase "rotate" and "clear" affordances.
    const anthropicRow = page.locator(".creds__row", { hasText: "anthropic" });
    await expect(anthropicRow.locator("button", { hasText: "rotate" })).toBeVisible();
    await expect(anthropicRow.locator("button", { hasText: "clear" })).toBeVisible();

    // Clearing flips the row back to "not set".
    let listAfterClear = false;
    await page.unroute("**/api/auth/list");
    await page.route("**/api/auth/list", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ credentials: listAfterClear ? [] : [{ kind: "anthropic" }] }),
      }),
    );
    await page.route("**/api/auth/clear", async (route) => {
      listAfterClear = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await anthropicRow.locator("button", { hasText: "clear" }).click();
    await expect(
      page.locator(".creds__row", { hasText: "anthropic" })
        .locator(".creds__row-state"),
    ).toContainText("not set");
  });
});
