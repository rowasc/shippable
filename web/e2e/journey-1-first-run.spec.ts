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
    await expect(page.getByRole("button", { name: /Skip/ })).toBeVisible();
    await expect(page.getByPlaceholder("sk-ant-...")).toBeVisible();
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

    await page.getByPlaceholder("sk-ant-...").fill("sk-ant-fake-test-key");
    await page.getByRole("button", { name: "Save" }).click();

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
      page.getByRole("heading", { name: "Server unreachable" }),
    ).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();

    // Retry once /api/health is healthy and confirm the gate falls through.
    await page.unroute("**/api/health");
    await mockHealthy(page);
    await retry.click();
    await expectBootCredentialsPanel(page);
  });

  test("failure: Skip → AI-off chip on Welcome", async ({ visit, page }) => {
    // Land on Welcome (no ?cs) so the AI-off chip surface is visible. The
    // boot panel still gates the first paint.
    await visit("/", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);

    await page.getByRole("button", { name: /Skip/ }).click();

    // Boot panel dismisses; Welcome surfaces the AI-off chip.
    const aiOff = page.getByRole("button", { name: /AI off/i });
    await expect(aiOff).toBeVisible();

    // Skip persisted in localStorage — reload should NOT re-prompt.
    await page.reload();
    await expect(aiOff).toBeVisible();
    await expect(page.getByPlaceholder("sk-ant-...")).toHaveCount(0);
  });

  test("failure: invalid key — server rejects and surfaces the error", async ({
    visit,
    page,
  }) => {
    await mockAuthSetRejects(page, "invalid_key");
    await visit("/?cs=42", { skipAnthropic: false });
    await expectBootCredentialsPanel(page);

    await page.getByPlaceholder("sk-ant-...").fill("garbage-key");
    await page.getByRole("button", { name: "Save" }).click();

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
    await page.getByRole("button", { name: "settings" }).click();
    const settings = page.getByRole("dialog", { name: "settings" });
    await expect(settings).toBeVisible();

    // The anthropic row exposes rotate + clear (via aria-label).
    await expect(
      settings.getByRole("button", { name: "rotate anthropic" }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "clear anthropic" }),
    ).toBeVisible();

    // Clearing flips the row back to unset: the clear button goes away and
    // the rotate affordance becomes "set anthropic".
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

    await settings.getByRole("button", { name: "clear anthropic" }).click();
    await expect(
      settings.getByRole("button", { name: "set anthropic" }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "clear anthropic" }),
    ).toHaveCount(0);
  });
});
