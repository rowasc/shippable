// Journey 2 — Review a local worktree. The folder picker (macOS-only,
// AppleScript) is [manual] and stays in the manual track. The "paste path
// instead" affordance is testable; we already have a full version of that
// flow in `scripts/smoke-boot-gate.mjs` step 6.
//
// Steps below are stubs scoped to what we can mock without a real worktree
// on disk: scan-via-paste, range picker UI presence, live-reload banner,
// reachability banner on path-disappears. They're marked `test.fixme()`
// until we wire each mock; remove the fixme one at a time as we cover them.

import { test, expect, expectWorkspaceLoaded, topbarBtn } from "./_lib/fixtures";
import {
  mockWorktreeList,
  mockWorktreeChangeset,
  SAMPLE_DIFF,
} from "./_lib/mocks";

test.describe("Journey 2 — local worktree", () => {
  test("scan + load via paste path (parallels smoke-boot-gate step 6)", async ({
    visit,
    page,
  }) => {
    await mockWorktreeList(page, [
      {
        path: "/fake/repo/main",
        branch: "main",
        head: "abcdef1234567890abcdef1234567890abcdef12",
        isMain: true,
      },
      {
        path: "/fake/repo/feat-x",
        branch: "feat/x",
        head: "1234567890abcdef1234567890abcdef12345678",
        isMain: false,
      },
    ]);
    await mockWorktreeChangeset(page, {
      diff: SAMPLE_DIFF,
      subject: "Friendlier greeting",
      branch: "feat/x",
    });
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);

    // Open LoadModal and click "paste path instead" — the folder picker
    // path needs a real macOS host so we can't exercise it headlessly.
    await page.keyboard.press("Escape").catch(() => {});
    await topbarBtn(page, "+ load").click();
    await page.locator(".modal__btn", { hasText: "paste path instead" }).click();
    await page.locator(".modal__manual .modal__input").fill("/fake/repo");
    await page.locator(".modal__manual .modal__btn", { hasText: "scan" }).click();

    await expect(page.locator(".modal__wt-row")).toHaveCount(2);
    await page.locator(".modal__wt-row", { hasText: "feat/x" }).click();
    await expect(page.locator(".topbar__title")).toContainText("Friendlier greeting");
  });

  test.fixme("range picker narrows the diff to a chosen commit range", async () => {
    // Needs /api/worktrees/commits mocked + /api/worktrees/changeset with a
    // range body. Wire the commits endpoint with two fake commits, click
    // "⇄ range", pick one, assert the diff changes.
  });

  test.fixme("live-reload banner renders when polling reports new commits", async () => {
    // Needs /api/worktrees/poll mocked to flip from "no changes" to "new
    // commit" between calls; assert `.live-reload-bar` appears with reload
    // text; click reload; confirm the new changeset replaces the old.
  });

  test.fixme("unreachable worktree shows banner and stops polling", async () => {
    // After load, return 404 from /api/worktrees/poll; banner text matches
    // the script's expected copy ("Worktree at <path> is no longer
    // reachable. Live reload stopped.").
  });
});
