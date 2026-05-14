// Journey 2 — Review a local worktree. These run against the REAL server:
// a throwaway git repo is built on disk (see _lib/worktree-repo.ts) and the
// server's /api/worktrees/* endpoints scan and diff it for real — no mocks.
// The live-reload tests mutate / delete a real repo mid-test and wait on the
// server's 3s poll cycle.
//
// The folder picker (macOS-only, AppleScript) stays [manual]; we drive the
// "paste path instead" affordance instead.

import {
  test,
  expect,
  expectWorkspaceLoaded,
  dismissPlanOverlay,
} from "./_lib/fixtures";
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
  // The modal closes only once the worktree changeset has actually loaded
  // (setShowLoad(false) fires after the fetch resolves). Wait for that —
  // NOT for `.diff`, which is already up from the initial `?cs=42` load.
  await expect(modal).toHaveCount(0);
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

  test("commit-range picker lists the worktree's commits", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await page.keyboard.press("Escape").catch(() => {}); // dismiss plan overlay

    // The ⇄ range topbar button opens the commit-range picker.
    await page.getByRole("button", { name: /range/ }).click();
    // The fixture repo has two commits; each row offers a "just this" shortcut.
    const justThis = page.getByRole("button", { name: "just this" });
    await expect(justThis).toHaveCount(2);
    // Narrowing to a single commit keeps a diff loaded.
    await justThis.first().click();
    await expectWorkspaceLoaded(page);
  });

  test("context expansion: expand bars and full-file view", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await dismissPlanOverlay(page); // fully clear the overlay — we click in the diff

    // The diff shows one file at a time; move to greeting.ts, the long file
    // whose committed + uncommitted edits are far apart → a collapsed gap
    // with an expand bar.
    await page.keyboard.press("]");
    await expect(page.getByRole("main")).toContainText("greeting.ts");

    // For a non-markdown worktree file the bar lazy-fetches; clicking it
    // loads the surrounding context.
    const expandBar = page
      .getByRole("button", { name: /load context|expand \d+ line/ })
      .first();
    await expect(expandBar).toBeVisible();
    await expandBar.click();

    // The full-file toggle shows the whole file, then collapses back to hunks.
    const fullFile = page.getByRole("button", { name: "↗ expand entire file" });
    await expect(fullFile).toBeVisible();
    await fullFile.click();
    await expect(
      page.getByRole("button", { name: "↙ collapse to hunks" }),
    ).toBeVisible();
  });

  test("comment authoring: c opens a composer and the comment renders", async ({
    visit,
    page,
  }) => {
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await dismissPlanOverlay(page);

    // `c` on the current line opens the comment composer in the Inspector.
    await page.keyboard.press("c");
    const inspector = page.getByRole("complementary", { name: "inspector" });
    const composer = inspector.getByRole("textbox");
    await expect(composer).toBeVisible();
    await composer.fill("e2e: needs a guard here");
    await composer.press("ControlOrMeta+Enter");

    // The saved comment renders back in the Inspector.
    await expect(inspector).toContainText("e2e: needs a guard here");
  });

  test("worktree review progress persists across reload", async ({
    visit,
    page,
  }) => {
    // Asserts read-mark persistence specifically: worktree file sign-offs do
    // NOT survive a reload — see "Known product bugs" #6 in
    // docs/usability-test.md.
    await visit("/?cs=42");
    await expectWorkspaceLoaded(page);
    await loadFixtureWorktree(page, repo.path);
    await dismissPlanOverlay(page);

    // Read a few lines, then wait for the debounced session save to land.
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("shippable:review:v1");
      if (!raw) return false;
      try {
        return Object.keys(JSON.parse(raw).readLines ?? {}).length > 0;
      } catch {
        return false;
      }
    });

    // Reopen at `/` — the worktree session resumes from peekSession with the
    // read progress intact (the sidebar's per-file read meter is non-zero).
    await visit("/");
    await expectWorkspaceLoaded(page);
    await dismissPlanOverlay(page);
    await expect(
      page.getByRole("button", { name: /[1-9]\d*% read/ }).first(),
    ).toBeVisible();
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
