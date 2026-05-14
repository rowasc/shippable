// Journey 3 — Review a GitHub PR. The happy path runs end to end against the
// fake upstream (_lib/scripts/fake-upstream.mjs): the From-URL field detects a
// PR URL, the real server's /api/github/pr/load 401s without a token, the
// GitHubTokenModal collects a PAT, and the retry loads the PR for real. The
// remaining branches (refresh, rejected token, GHE trust, bad URL) stay fixme.

import { test, expect, expectWorkspaceLoaded, topbarBtn } from "./_lib/fixtures";

const PR_URL = "https://github.com/acme/widgets/pull/7";

test.describe("Journey 3 — GitHub PR", () => {
  test("happy path: paste PR URL → token modal → load + render", async ({
    visit,
    page,
  }) => {
    await page.unroute("**/api/auth/list"); // use the real auth store
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

    await topbarBtn(page, "+ load").click();
    const urlSection = page.locator(".modal__sec", { hasText: "From URL" });
    await urlSection.locator(".modal__input").fill(PR_URL);
    await urlSection.locator(".modal__btn", { hasText: /^load$/ }).click();

    // No token stored for the host → the GitHub token modal opens and names it.
    const tokenModal = page.locator(".modal__box", {
      has: page.locator(".modal__h-label", {
        hasText: "GitHub token required",
      }),
    });
    await expect(tokenModal).toBeVisible();
    await expect(tokenModal).toContainText("github.com");

    await tokenModal
      .getByLabel("Personal Access Token")
      .fill("ghp_e2e_fake_token");
    await tokenModal.locator(".modal__btn--primary").click();

    // Retry succeeds: the server calls the fake upstream, assembles the PR
    // changeset, and the topbar shows the fake PR's title.
    await expect(page.locator(".topbar__title")).toContainText(
      "Add preferences density toggle",
    );
  });

  test.fixme("refresh keeps local review state", async () => {
    // Click `↻ refresh`. Assert label changes to "refreshing…", then back.
    // Sign off a file before refresh; assert the sign-off survives the
    // refresh round-trip.
  });

  test.fixme("rejected token mode opens GitHubTokenModal with re-enter copy", async () => {
    // Have the fake upstream 401 the PR fetch; assert the modal opens with
    // "GitHub rejected the saved token" copy.
  });

  test.fixme("GHE host trust step appears inside GitHubTokenModal", async () => {
    // Use a non-github.com PR URL with a host not in localStorage trusted
    // hosts. Assert the "Token destination: https://...api/v3" line and the
    // `I trust {host}` button. Click it. Assert the PAT field appears in
    // the same modal.
  });

  test.fixme("bad PR URL surfaces an inline LoadModal error, no token prompt", async () => {
    // Paste a malformed PR URL; assert inline error inside LoadModal and no
    // GitHubTokenModal opens.
  });
});
