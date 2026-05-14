import { defineConfig, devices } from "@playwright/test";

// e2e suite — converts `docs/usability-test.md` `[auto]`/`[mixed]` steps into
// runnable specs. Two webServer entries: vite on :5198 (so we don't collide
// with the developer's :5173) and the real `server/` on :3001, which vite
// proxies /api/* to. The server runs keyless — health, auth, worktrees,
// prompts, and the rule-based plan all work without an Anthropic key, so those
// paths are exercised for real. Tests page.route() only the genuinely external
// boundaries (GitHub, Anthropic) and hard-to-trigger failure modes.
//
// Uses system Chrome (`channel: "chrome"`) to match the existing smokes and
// to avoid downloading playwright's bundled chromium. If `chrome` isn't
// installed, set PLAYWRIGHT_CHANNEL=chromium and `npx playwright install
// chromium` once.

const PORT = Number.parseInt(process.env.E2E_PORT ?? "5198", 10);
const SERVER_PORT = Number.parseInt(process.env.E2E_SERVER_PORT ?? "3001", 10);
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
      // The real server/ — keyless, so health/auth/worktrees/prompts/
      // rule-based-plan are exercised for real.
      command: "npm start",
      cwd: "../server",
      port: SERVER_PORT,
      env: {
        PORT: String(SERVER_PORT),
        // Vite forwards the browser's Origin header through the proxy, and
        // the server origin-checks every POST. Put the e2e vite host on the
        // allowlist or worktree/auth writes come back 403 "request not
        // allowed".
        SHIPPABLE_ALLOWED_ORIGINS: `http://127.0.0.1:${PORT}`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
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
