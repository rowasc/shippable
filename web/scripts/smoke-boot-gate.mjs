// Smoke test for the server-required boot gate, the plan-overlay flow, and
// the worktree-loader tab in LoadModal.
//
// Mocks the backend at the browser layer with `page.route()` so we don't
// need a real server or an Anthropic key. Covers:
//   1. /api/health failing → boot gate shows "Server unreachable" + Retry.
//   2. /api/health succeeding → main app loads.
//   3. Plan overlay shows the rule-based plan by default; Send-to-Claude
//      button is offered for the AI swap.
//   4. /api/plan succeeding → headline swaps from rule-based to the AI plan.
//   5. /api/plan failing → "AI plan failed — showing rule-based fallback"
//      overlay; rule-based headline still rendered.
//   6. Worktree tab is visible unconditionally; scan + load flow ingests a
//      mocked changeset end-to-end.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:5173";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (text.includes("Content Security Policy directive 'frame-ancestors'")) return;
  // Mocked failures intentionally surface as failed network requests; ignore.
  if (text.includes("Failed to load resource")) return;
  errors.push(`[console.error] ${text}`);
});

const json = (status, body) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

try {
  // ── 1. server unreachable ───────────────────────────────────────────────
  await page.route("**/api/health", (route) =>
    route.fulfill({ status: 503, body: "down" }),
  );
  await page.goto(`${BASE}/?cs=42`);
  await page.waitForSelector(".boot-gate__h", { timeout: 5000 });
  const gateHeading = await page.textContent(".boot-gate__h");
  if (!gateHeading?.includes("Server unreachable")) {
    throw new Error(`step 1: expected "Server unreachable" heading, got: ${gateHeading}`);
  }
  if (
    (await page.locator(".boot-gate__btn", { hasText: "Retry" }).count()) === 0
  ) {
    throw new Error("step 1: Retry button missing on boot gate");
  }
  console.log("step 1 ✓ — boot gate appears when /api/health fails");

  // ── 2. retry to healthy ─────────────────────────────────────────────────
  await page.unroute("**/api/health");
  await page.route("**/api/health", (route) =>
    route.fulfill(json(200, { ok: true })),
  );
  await page.click(".boot-gate__btn");
  await page.waitForSelector(".diff", { timeout: 10000 });
  console.log("step 2 ✓ — Retry with healthy /api/health unblocks main app");

  // ── 3. plan overlay default = rule-based plan ──────────────────────────
  await page.waitForSelector(".plan__headline", { timeout: 5000 });
  const initialHeadline = (await page.textContent(".plan__headline"))?.trim();
  if (!initialHeadline) {
    throw new Error("step 3: rule-based headline missing or empty");
  }
  const sendBtn = page.locator(".plan__h-btn", { hasText: "Send to Claude" });
  if ((await sendBtn.count()) === 0) {
    throw new Error("step 3: Send to Claude button missing on idle plan");
  }
  // The rule-based plan should already have populated the map.
  if ((await page.locator(".plan__file").count()) === 0) {
    throw new Error("step 3: rule-based plan map renders no files");
  }
  console.log(`step 3 ✓ — rule-based plan renders by default ("${initialHeadline}")`);

  // ── 4. send to claude with mocked success ───────────────────────────────
  const MOCKED_HEADLINE = "Mocked plan: bumps version, tightens validation";
  await page.route("**/api/plan", (route) =>
    route.fulfill(
      json(200, {
        plan: {
          headline: MOCKED_HEADLINE,
          intent: [
            {
              text: "Bumps version in package.json.",
              evidence: [{ kind: "description" }],
            },
          ],
          map: { files: [], symbols: [] },
          entryPoints: [],
        },
      }),
    ),
  );
  await sendBtn.click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".plan__headline")?.textContent === expected,
    MOCKED_HEADLINE,
    { timeout: 5000 },
  );
  console.log("step 4 ✓ — Send to Claude renders the mocked AI plan");

  // ── 5. failed generation falls back to the rule-based plan ─────────────
  await page.unroute("**/api/plan");
  await page.route("**/api/plan", (route) =>
    route.fulfill({ status: 502, body: "boom" }),
  );
  // Switch changesets so usePlan resets to "idle"; the rule-based plan for
  // cs-72 renders, and clicking Send to Claude triggers the failure path.
  await page.goto(`${BASE}/?cs=72`);
  await page.waitForSelector(".plan__headline", { timeout: 5000 });
  const cs72RuleHeadline = (await page.textContent(".plan__headline"))?.trim();
  await page.locator(".plan__h-btn", { hasText: "Send to Claude" }).click();
  await page.waitForSelector(".plan__h-status--err", { timeout: 5000 });
  const errText = await page.textContent(".plan__h-status--err");
  if (!errText?.includes("AI plan failed — showing rule-based fallback")) {
    throw new Error(
      `step 5: expected "AI plan failed — showing rule-based fallback" message, got: ${errText}`,
    );
  }
  // Rule-based plan should still be on screen.
  const headlineAfterFail = (await page.textContent(".plan__headline"))?.trim();
  if (headlineAfterFail !== cs72RuleHeadline) {
    throw new Error(
      `step 5: rule-based headline should persist on AI failure, got: ${headlineAfterFail}`,
    );
  }
  console.log("step 5 ✓ — failed /api/plan falls back to rule-based plan with status banner");

  // ── 6. worktree tab: always visible + scan/load flow ───────────────────
  // The worktree pane used to hide itself when /api/health failed. Under
  // server-required, the gate covers that and the pane renders unconditionally.
  await page.route("**/api/worktrees/list", (route) =>
    route.fulfill(
      json(200, {
        worktrees: [
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
        ],
      }),
    ),
  );
  const MOCKED_WT_DIFF = [
    "diff --git a/foo.ts b/foo.ts",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -1,1 +1,1 @@",
    "-const greeting = 'hi';",
    "+const greeting = 'hello';",
    "",
  ].join("\n");
  await page.route("**/api/worktrees/changeset", (route) =>
    route.fulfill(
      json(200, {
        diff: MOCKED_WT_DIFF,
        sha: "1234567890abcdef1234567890abcdef12345678",
        subject: "Friendlier greeting",
        author: "tester",
        date: "2026-05-04T00:00:00Z",
        branch: "feat/x",
      }),
    ),
  );

  // Dismiss the plan overlay so it doesn't intercept clicks.
  await page.keyboard.press("Escape").catch(() => {});
  // Open LoadModal via the topbar "+ load" button.
  await page.locator(".topbar__btn", { hasText: "+ load" }).click();
  await page.waitForSelector(".modal__h-label", { timeout: 3000 });
  // Worktree section header should be present without any server probe.
  const wtHeader = page.locator(".modal__sec-h", {
    hasText: "From a local repo or worktrees folder",
  });
  if ((await wtHeader.count()) === 0) {
    throw new Error("step 6: worktree section header missing in LoadModal");
  }
  // Primary action is a native folder picker, which Playwright can't drive
  // headlessly. Fall back to the "paste path instead" toggle, which exposes
  // the same path input + scan button the smoke originally used.
  await page
    .locator(".modal__btn", { hasText: "paste path instead" })
    .click();
  await page.fill(".modal__manual .modal__input", "/fake/repo");
  await page.locator(".modal__manual .modal__btn", { hasText: "scan" }).click();
  await page.waitForSelector(".modal__wt-list li", { timeout: 5000 });
  const wtRows = await page.locator(".modal__wt-list li").count();
  if (wtRows !== 2) {
    throw new Error(`step 6: expected 2 worktree rows, got ${wtRows}`);
  }
  // Pick the feat/x worktree and confirm the loaded changeset replaces the
  // current one (LoadModal closes; the topbar shows the new title).
  await page
    .locator(".modal__wt-row", { hasText: "feat/x" })
    .click();
  await page.waitForSelector(".topbar__title", { timeout: 5000 });
  await page.waitForFunction(
    () =>
      document.querySelector(".topbar__title")?.textContent ===
      "Friendlier greeting",
    null,
    { timeout: 5000 },
  );
  console.log("step 6 ✓ — worktree tab visible; scan + load ingests changeset");

  if (errors.length > 0) {
    console.error("Page reported errors:");
    for (const e of errors) console.error("  ", e);
    throw new Error("Page errors during smoke test");
  }
  console.log("boot-gate smoke ✓ — gate, retry, plan empty/success/error, worktree load all working");
} finally {
  await browser.close();
}
