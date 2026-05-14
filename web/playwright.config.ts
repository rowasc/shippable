import { defineConfig, devices } from "@playwright/test";

// e2e suite — converts `docs/usability-test.md` `[auto]`/`[mixed]` steps into
// runnable specs. Two webServer entries boot the same stack the smokes do:
// vite on :5198 (so we don't collide with the developer's :5173) and a stub
// /api/* server on :3001 that vite proxies to. Tests further override the
// stub per-route via `page.route()` — same approach as `scripts/smoke-*`.
//
// Uses system Chrome (`channel: "chrome"`) to match the existing smokes and
// to avoid downloading playwright's bundled chromium. If `chrome` isn't
// installed, set PLAYWRIGHT_CHANNEL=chromium and `npx playwright install
// chromium` once.

const PORT = Number.parseInt(process.env.E2E_PORT ?? "5198", 10);
const STUB_PORT = Number.parseInt(process.env.E2E_STUB_PORT ?? "3001", 10);
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/_lib/**"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: CHANNEL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node scripts/e2e-stub-server.mjs --port ${STUB_PORT}`,
      port: STUB_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev --silent -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
