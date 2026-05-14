// Journey 2 — Review a local worktree. These run against the REAL server:
// a throwaway git repo is built on disk (see _lib/worktree-repo.ts) and the
// server's /api/worktrees/* endpoints scan and diff it for real — no mocks.
// The live-reload tests mutate / delete a real repo mid-test and wait on the
// server's 3s poll cycle.
//
// The folder picker (macOS-only, AppleScript) stays [manual]; we drive the
// "paste path instead" affordance instead.

import { test, expect, expectWorkspaceLoaded } from "./_lib/fixtures";
import {
  createWorktreeRepo,
  addCommit,
  type FixtureRepo,
} from "./_lib/worktree-repo";

let repo: FixtureRepo;

test.beforeAll(() => {
  repo = createWorktreeRepo();
});

test.afterAll(() => {
  repo?.cleanup();
});

/** Open LoadModal, paste a fixture repo path, scan, and pick its worktree. */
async function loadFixtureWorktree(
  page: import("@playwright/test").Page,
  repoPath: string,
) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByRole("button", { name: /\+ load/ }).click();
  const modal = page.getByRole("dialog", { name: "load changeset" });
  await modal.getByRole("button", { name: "paste path instead" }).click();
  await modal
    .getByPlaceholder("/Users/you/code/my-repo")
    .fill(repoPath);
  await modal.getByRole("button", { name: "scan", exact: true }).click();
  // A fresh `git init` repo has exactly one working tree, on `feat/x`.
  const row = modal.getByRole("button", { name: /feat\/x/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expectWorkspaceLoaded(page);
}

test.describe("Journey 2 — local worktree", () => {
  test("scan + load surfaces the branch's cumulative diff", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);

    // The changeset is the branch's cumulative work: the committed
    // "Friendlier greeting" edit plus the tracked uncommitted edits and the
    // untracked file. Every changed file shows in the sidebar.
    await expect(page.getByText("greeting.ts").first()).toBeVisible();
    await expect(page.getByText("README.md").first()).toBeVisible();
    await expect(page.getByText("notes.txt").first()).toBeVisible();
  });

  test("keyboard navigation moves the cursor across lines and files", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

    // Cursor starts on the first file's first line. `j` advances it — the
    // highlighted line's text changes.
    const cursor = page.locator('[aria-current="true"]');
    await expect(cursor).toHaveCount(1);
    const beforeLine = await cursor.textContent();
    await page.keyboard.press("j");
    await expect.poll(() => cursor.textContent()).not.toBe(beforeLine);

    // `]` jumps to the next file — the diff header path changes.
    const path = page.locator(".diff__path");
    const beforeFile = await path.textContent();
    await page.keyboard.press("]");
    await expect.poll(() => path.textContent()).not.toBe(beforeFile);
  });

  test("Shift+M signs off the current file", async ({ visit, page }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

    await page.keyboard.press("Shift+M");
    await expect(
      page.getByLabel("reviewed", { exact: true }).first(),
    ).toBeVisible();
    // Toggling again clears it.
    await page.keyboard.press("Shift+M");
    await expect(page.getByLabel("reviewed", { exact: true })).toHaveCount(0);
  });

  test("live-reload banner appears when a new commit lands", async ({
    visit,
    page,
  }) => {
    // Own repo — this test mutates it, so keep it off the shared fixture.
    const own = createWorktreeRepo();
    try {
      await visit("/?cs=42");
      await expectWorkspaceLoaded(page);
      await loadFixtureWorktree(page, own.path);
      await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

      // Baseline: the live-reload bar is watching the worktree.
      const liveBar = page.getByRole("status", { name: "live reload" });
      await expect(liveBar).toBeVisible();

      // A new commit lands; the 3s poll picks it up and the banner offers a
      // reload.
      addCommit(own.path);
      await expect(liveBar).toContainText("reload", { timeout: 12_000 });
    } finally {
      own.cleanup();
    }
  });

  test("unreachable worktree shows the 'no longer reachable' banner", async ({
    visit,
    page,
  }) => {
    const own = createWorktreeRepo();
    try {
      await visit("/?cs=42");
      await expectWorkspaceLoaded(page);
      await loadFixtureWorktree(page, own.path);
      await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay
      const liveBar = page.getByRole("status", { name: "live reload" });
      await expect(liveBar).toBeVisible();

      // The worktree vanishes; the next poll 404s and the gone banner shows.
      own.cleanup();
      await expect(liveBar).toContainText("no longer reachable", {
        timeout: 15_000,
      });
    } finally {
      own.cleanup();
    }
  });
});
