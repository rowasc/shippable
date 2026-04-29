// Smoke test for the prompt picker + editor.
//
// Covers the UI flow only — the streaming review path is left uncovered
// because exercising it would require either a real Anthropic call or a
// mocked server, neither of which fits a quick smoke.
//
// Assumes both servers are up:
//   - web (Vite) on http://localhost:5173
//   - server (Node) on http://localhost:3001 with bundled library
//
// Boot via:
//   cd server && npm run dev   # in one shell
//   cd web && npm run dev      # in another shell
//   URL=http://localhost:5173/ node web/scripts/smoke-prompts.mjs

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => console.log("[page]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  await page.goto(URL);
  await page.waitForSelector(".diff");
  // Dismiss the plan overlay if present.
  await page.keyboard.press("Escape").catch(() => {});

  // ── 1. Open the picker via "/" ──────────────────────────────────────
  await page.keyboard.press("/");
  await page.waitForSelector(".modal__h", { timeout: 3000 });
  const headerLabel = await page.textContent(".modal__h-label");
  if (headerLabel?.trim() !== "run a prompt") {
    throw new Error(`unexpected picker header: ${JSON.stringify(headerLabel)}`);
  }
  console.log("picker opened");

  // ── 2. Library loads at least one prompt ────────────────────────────
  await page.waitForSelector(".picker__list li.picker__item", { timeout: 5000 });
  const items = await page.$$(".picker__item");
  if (items.length === 0) {
    throw new Error("expected at least one prompt in the picker list");
  }
  console.log(`picker shows ${items.length} prompts`);

  // The bundled library ships these starter prompts; smoke against one of
  // them so a regression that wipes the library shows up.
  const names = await page.$$eval(".picker__item-name", (els) =>
    els.map((e) => e.textContent?.trim() ?? ""),
  );
  const expected = "Security review this hunk";
  if (!names.includes(expected)) {
    throw new Error(
      `expected to find "${expected}" in picker; got: ${names.join(", ")}`,
    );
  }
  console.log(`found bundled prompt "${expected}"`);

  // ── 3. Run form opens when a prompt is picked ───────────────────────
  await page.click(`.picker__item:has(.picker__item-name:text-is("${expected}"))`);
  await page.waitForSelector(".picker__arg-textarea", { timeout: 3000 });
  // The auto-fill should have populated the `hunk` arg with diff text;
  // the textarea must be non-empty for the run button to be enabled.
  const hunkValue = await page.$eval(
    ".picker__arg-textarea",
    (el) => el.value,
  );
  if (!hunkValue.trim()) {
    throw new Error("expected hunk arg to be auto-filled from current selection");
  }
  console.log(`run form auto-filled (${hunkValue.length} chars)`);

  // Back to the list.
  await page.click(".picker__actions .modal__btn:has-text('back')");
  await page.waitForSelector(".picker__search", { timeout: 2000 });

  // ── 4. Editor opens via "+ new" ─────────────────────────────────────
  await page.click(".picker__search-row .modal__btn:has-text('new')");
  await page.waitForSelector(".editor__body", { timeout: 3000 });
  const banner = await page.textContent(".editor__banner");
  if (!banner?.includes("new prompt")) {
    throw new Error(`unexpected editor banner for new prompt: ${banner}`);
  }
  console.log("editor opened in new-prompt mode");

  // Cancel back to the list.
  await page.click(".picker__actions .modal__btn:has-text('cancel')");
  await page.waitForSelector(".picker__search", { timeout: 2000 });

  // ── 5. Editor opens via "fork" on a library prompt ──────────────────
  await page.click(
    `.picker__item:has(.picker__item-name:text-is("${expected}")) .picker__item-edit`,
  );
  await page.waitForSelector(".editor__body", { timeout: 3000 });
  const forkBanner = await page.textContent(".editor__banner");
  if (!forkBanner?.includes("forking library prompt")) {
    throw new Error(`expected fork banner; got: ${forkBanner}`);
  }
  // The body should have been pre-filled from the library prompt.
  const forkBody = await page.$eval(".editor__body", (el) => el.value);
  if (!forkBody.trim()) {
    throw new Error("expected fork to pre-fill the editor body");
  }
  console.log(`editor opened in fork mode (${forkBody.length} chars pre-filled)`);

  // ── 6. Escape closes the picker ─────────────────────────────────────
  await page.click(".picker__actions .modal__btn:has-text('cancel')");
  await page.waitForSelector(".picker__search", { timeout: 2000 });
  await page.keyboard.press("Escape");
  // Picker overlay should be gone.
  const stillOpen = await page.$(".modal__h-label");
  if (stillOpen) {
    throw new Error("expected picker to close on Escape");
  }
  console.log("Escape closes picker");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
