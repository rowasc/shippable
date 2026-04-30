// Smoke check for the new markdown preview mode.
// Loads the cs-72 fixture, switches to Preview, asserts the rendered output.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:5174";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 2000 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  // Pre-existing baseline noise from the app shell, not something this smoke
  // test should fail on.
  if (text.includes("Content Security Policy directive 'frame-ancestors'")) return;
  errors.push(`[console.error] ${text}`);
});

await page.goto(`${BASE}/?cs=72`, { waitUntil: "networkidle" });

// Dismiss the AI plan overlay so it doesn't intercept clicks.
await page.keyboard.press("Escape").catch(() => {});

// Make sure cs-72 docs/preview-demo.md is the open file.
const headerText = await page.textContent(".diff__path");
if (!headerText?.includes("docs/preview-demo.md")) {
  throw new Error(`Expected docs/preview-demo.md in header, got: ${headerText}`);
}

// The preview button should exist (it only renders for markdown files).
const previewBtn = page.locator(".diff__mode-btn", { hasText: "Preview" });
if ((await previewBtn.count()) === 0) {
  throw new Error("Preview button missing — markdown file should expose it");
}

await previewBtn.click();
await page.waitForSelector(".md-preview .markdown-body", { timeout: 5000 });

// h1 should be the document title.
const h1 = await page.locator(".md-preview .markdown-body h1").first().textContent();
if (!h1?.includes("Markdown Preview")) {
  throw new Error(`Expected h1 'Markdown Preview', got '${h1}'`);
}

// GFM table should render with at least 5 rows.
const rowCount = await page.locator(".md-preview .markdown-body table tr").count();
if (rowCount < 5) throw new Error(`Expected >=5 table rows, got ${rowCount}`);

// Task list with at least one checked + one unchecked.
const checkedCount = await page
  .locator('.md-preview .markdown-body input[type="checkbox"][checked], .md-preview .markdown-body input[type="checkbox"]:checked')
  .count();
const checkboxCount = await page
  .locator('.md-preview .markdown-body input[type="checkbox"]')
  .count();
if (checkboxCount < 3) throw new Error(`Expected >=3 task-list items, got ${checkboxCount}`);
if (checkedCount < 2) throw new Error(`Expected >=2 checked items, got ${checkedCount}`);

// Alerts (NOTE + WARNING).
const alerts = await page.locator(".md-preview .markdown-body .markdown-alert").count();
if (alerts < 2) throw new Error(`Expected >=2 alerts, got ${alerts}`);

// Image with resolved data URL.
const imgSrc = await page.locator(".md-preview .markdown-body img").first().getAttribute("src");
if (!imgSrc?.startsWith("data:image/svg+xml")) {
  throw new Error(`Expected image src to start with data:image/svg+xml, got: ${imgSrc?.slice(0, 60)}`);
}

// Code block: shiki should have rendered <pre class="shiki">.
const shikiPres = await page.locator(".md-preview .markdown-body pre.shiki").count();
if (shikiPres < 1) throw new Error(`Expected >=1 shiki <pre>, got ${shikiPres}`);

await page.screenshot({ path: "/tmp/md-preview.png", fullPage: true });

// Scroll the inner preview container to the bottom to capture alerts + image.
await page.evaluate(() => {
  const el = document.querySelector(".md-preview");
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/md-preview-bottom.png", fullPage: true });

// Switch back to Diff and confirm hunks render.
await page.locator(".diff__mode-btn", { hasText: "Diff" }).click();
await page.waitForSelector(".hunk", { timeout: 5000 });

if (errors.length > 0) {
  console.error("Page reported errors:");
  for (const e of errors) console.error("  ", e);
  throw new Error("Page errors during smoke test");
}

console.log("md-preview smoke ✓ — h1, table, task list, alerts, image, shiki, mode toggle all working");
await browser.close();
