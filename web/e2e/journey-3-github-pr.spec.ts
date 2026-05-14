// Journey 3 — Review a GitHub PR. Runs end to end against the fake upstream
// (scripts/fake-upstream.mjs): the From-URL field detects a PR URL, the real
// server's /api/github/pr/load 401s without a token, the GitHubTokenModal
// collects a PAT, and the retry loads the PR for real. Owner-keyed triggers in
// the fake (`rejected-token`) drive the failure branches.

import {
  test,
  expect,
  expectWorkspaceLoaded,
  dismissPlanOverlay,
} from "./_lib/fixtures";

const PR_URL = "https://github.com/acme/widgets/pull/7";

/** Open LoadModal and submit `url` through the From-URL field. */
async function submitUrl(page: import("@playwright/test").Page, url: string) {
  await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay
  await page.getByRole("button", { name: /\+ load/ }).click();
  const modal = page.getByRole("dialog", { name: "load changeset" });
  await modal
    .getByPlaceholder("https://github.com/owner/repo/pull/123")
    .fill(url);
  await modal.getByRole("button", { name: /^load$/ }).click();
}

/** The GitHub token modal. */
function tokenModal(page: import("@playwright/test").Page) {
  return page.getByRole("dialog", { name: "GitHub token required" });
}

/** Load the fake PR end to end: submit the URL, satisfy the token modal, and
 *  wait for the PR changeset to render. */
async function loadFakePr(page: import("@playwright/test").Page) {
  await submitUrl(page, PR_URL);
  const modal = tokenModal(page);
  await modal.getByLabel("Personal Access Token").fill("ghp_e2e_fake_token");
  await modal.getByRole("button", { name: /Save token/ }).click();
  await expect(page.locator(".topbar__title")).toContainText(
    "Add preferences density toggle",
  );
}

test.describe("Journey 3 — GitHub PR", () => {
  test.beforeEach(async ({ page }) => {
    await page.unroute("**/api/auth/list"); // use the real auth store
  });
  // The shared server auth store is wiped after every test by the
  // `autoClearServerAuth` fixture in _lib/fixtures.ts.

  test("happy path: paste PR URL → token modal → load + render", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await submitUrl(page, PR_URL);

    // No token stored for the host → the token modal opens and names it.
    const modal = tokenModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("github.com");

    await modal.getByLabel("Personal Access Token").fill("ghp_e2e_fake_token");
    await modal.getByRole("button", { name: /Save token/ }).click();

    // Retry succeeds: the server calls the fake upstream, assembles the PR
    // changeset, and the topbar shows the fake PR's title.
    await expect(page.locator(".topbar__title")).toContainText(
      "Add preferences density toggle",
    );
  });

  test("bad PR URL surfaces an inline error, no token prompt", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    // /pull/0 is a well-formed GitHub PR URL shape but parsePrUrl rejects it
    // (PR number must be a positive integer).
    await submitUrl(page, "https://github.com/owner/repo/pull/0");

    await expect(page.getByRole("alert")).toBeVisible();
    // The load modal stays open and no token modal appears.
    await expect(
      page.getByRole("dialog", { name: "load changeset" }),
    ).toBeVisible();
    await expect(tokenModal(page)).toHaveCount(0);
  });

  test("GHE host: the trust step appears before the PAT field", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    // A non-github.com host that isn't in the localStorage trusted list.
    await submitUrl(page, "https://ghe.example.com/acme/widgets/pull/3");

    // The token modal opens on the host-trust stage first.
    const trustBtn = page.locator("button", {
      hasText: "I trust ghe.example.com",
    });
    await expect(trustBtn).toBeVisible();
    await expect(tokenModal(page)).toContainText("ghe.example.com/api/v3");

    // After trusting the host, the PAT field appears in the same modal.
    await trustBtn.click();
    await expect(tokenModal(page).getByLabel("Personal Access Token")).toBeVisible();
  });

  test("rejected token surfaces an error in the modal", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    // The `rejected-token` owner makes the fake upstream 401 the PR fetch.
    await submitUrl(page, "https://github.com/rejected-token/repo/pull/1");

    const modal = tokenModal(page);
    await expect(modal).toBeVisible();
    await modal.getByLabel("Personal Access Token").fill("ghp_will_be_rejected");
    await modal.getByRole("button", { name: /Save token/ }).click();

    // The retry 401s. On the submit path the client surfaces a hardcoded
    // "Check the PAT scopes" message rather than the `reason: "rejected"`
    // re-open copy — see "Known product bugs" #1 in docs/usability-test.md.
    await expect(modal.getByRole("alert")).toContainText(
      "Token rejected by github.com",
    );
  });

  test("refresh keeps local review state", async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await submitUrl(page, PR_URL);
    const modal = tokenModal(page);
    await modal.getByLabel("Personal Access Token").fill("ghp_e2e_fake_token");
    await modal.getByRole("button", { name: /Save token/ }).click();
    await expect(page.locator(".topbar__title")).toContainText(
      "Add preferences density toggle",
    );

    // Sign off the current file, then refresh the PR from GitHub.
    await dismissPlanOverlay(page);
    await page.keyboard.press("Shift+M");
    await expect(
      page.getByLabel("reviewed", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: /refresh/ }).click();
    // The diff re-fetches but the sign-off (local review state) survives.
    await expect(page.locator(".topbar__title")).toContainText(
      "Add preferences density toggle",
    );
    await expect(
      page.getByLabel("reviewed", { exact: true }).first(),
    ).toBeVisible();
  });

  test("PR conversation disclosure shows issue-level comments", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFakePr(page);

    // The Inspector's "PR conversation (N)" disclosure holds issue-level
    // comments; expanding it reveals the fake upstream's conversation comment.
    const conversation = page.getByText(/PR conversation \(\d+\)/);
    await expect(conversation).toBeVisible();
    await conversation.click(); // expand the <details>
    await expect(
      page.getByText(/add a test for the cozy mode/),
    ).toBeVisible();
  });

  test("multi-line review comment shows an L-range label", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFakePr(page);

    // The fake PR carries a multi-line review comment (lines 2–3); it renders
    // anchored under its hunk with an L{a}–L{b} line-range label.
    await expect(
      page.getByText("Should this be a union type?"),
    ).toBeVisible();
    await expect(page.getByText(/L2.L3/)).toBeVisible();
  });
});
