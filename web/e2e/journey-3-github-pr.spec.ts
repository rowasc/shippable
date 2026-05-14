// Journey 3 — Review a GitHub PR. Every step is [auto] or [mixed] but each
// requires substantial /api/github mocking (PR metadata, files, review
// comments, conversation, refresh). The skeleton below names the targets so
// we can fill them in incrementally.

import { test, expectWorkspaceLoaded } from "./_lib/fixtures";

const PR_URL = "https://github.com/owner/repo/pull/123";

test.describe("Journey 3 — GitHub PR", () => {
  test.fixme("happy path: paste PR URL → token modal → load + render", async ({
    visit,
    page,
  }) => {
    // Mock /api/github/pr/load to return a fixture PR with at least one file
    // and one line-anchored review comment. Mock /api/auth/set to accept
    // the PAT. Wire isGithubPrUrl in the From-URL flow. Then:
    //   - paste PR_URL into LoadModal's URL field
    //   - assert GitHubTokenModal opens and names the host
    //   - paste fake PAT, click Save
    //   - assert workspace renders with PR title in topbar and state badge
    void PR_URL;
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
  });

  test.fixme("refresh keeps local review state", async () => {
    // Click `↻ refresh`. Assert label changes to "refreshing…", then back.
    // Sign off a file before refresh; assert the sign-off survives the
    // refresh round-trip.
  });

  test.fixme("rejected token mode opens GitHubTokenModal with re-enter copy", async () => {
    // Mock /api/github/pr/load to return 401 with the rejected-token
    // discriminator; assert the modal opens with "GitHub rejected the
    // saved token" copy.
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
