#!/usr/bin/env node
// Regenerates docs/demo.gif by driving the real app with Playwright.
// Usage: `npm run demo` (from web/). Needs ffmpeg and a Chrome install.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(WEB_DIR, "..");
const OUT_GIF = join(REPO_ROOT, "docs", "demo.gif");
const FRAMES_DIR = join(tmpdir(), "shippable-demo-frames");
const PORT = 5199;
const APP_URL = `http://localhost:${PORT}/?cs=cs-42`;

const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 2;
const GIF_WIDTH = 960;

// Action plan: each step captures one or more frames. The `hold` value is the
// seconds the last frame lingers in the final GIF.
const FRAME_PLAN = [
  ["00_plan_open",              0.6],
  ["01_plan_open_hold",         1.8],
  ["02_diff_first_file",        0.5],
  ["03_diff_first_file_hold",   1.2],
  ["04_reviewed_progress",      1.1],
  ["05_next_hunk",              0.9],
  ["06_second_file",            0.5],
  ["07_second_file_hold",       1.0],
  ["08_ai_note_visible",        1.4],
  ["09_ai_note_acked",          1.1],
  ["10_third_file",             0.8],
  ["11_reviewing_panel",        0.9],
  ["12_guide_appearing",        0.4],
  ["13_guide_appearing_hold",   2.2],
  ["14_jumped_to_definition",   0.5],
  ["15_jumped_to_def_hold",     1.8],
  ["16_help_overlay",           0.4],
  ["17_help_overlay_hold",      2.0],
  ["18_plan_reopened",          0.5],
  ["19_plan_reopened_hold",     1.8],
];

async function capture(page) {
  let n = 0;
  const shot = async (label) => {
    const expected = FRAME_PLAN[n]?.[0];
    if (expected !== label) {
      throw new Error(`frame plan drift at ${n}: expected ${expected}, got ${label}`);
    }
    const file = join(FRAMES_DIR, `${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    n++;
  };
  const key = async (k, hold = 180) => {
    await page.keyboard.press(k);
    await page.waitForTimeout(hold);
  };

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".plan", { state: "visible" });
  await page.waitForTimeout(400);
  await shot("00_plan_open");
  await page.waitForTimeout(900);
  await shot("01_plan_open_hold");

  await key("Escape", 400);
  await shot("02_diff_first_file");
  await page.waitForTimeout(700);
  await shot("03_diff_first_file_hold");

  for (let i = 0; i < 6; i++) await key("j", 110);
  await shot("04_reviewed_progress");

  await key("J", 250);
  await shot("05_next_hunk");

  await key("Tab", 300);
  await shot("06_second_file");
  await page.waitForTimeout(600);
  await shot("07_second_file_hold");

  for (let i = 0; i < 4; i++) await key("j", 110);
  await shot("08_ai_note_visible");

  await key("a", 250);
  await shot("09_ai_note_acked");

  await key("Tab", 300);
  await shot("10_third_file");

  // PreferencesPanel hunk has 36 lines. Crossing 18 fires the guide.
  for (let i = 0; i < 12; i++) await key("j", 70);
  await shot("11_reviewing_panel");
  for (let i = 0; i < 12; i++) await key("j", 70);
  await page.waitForTimeout(600);
  await shot("12_guide_appearing");
  await page.waitForTimeout(1200);
  await shot("13_guide_appearing_hold");

  await key("Enter", 600);
  await shot("14_jumped_to_definition");
  await page.waitForTimeout(900);
  await shot("15_jumped_to_def_hold");

  await key("?", 350);
  await shot("16_help_overlay");
  await page.waitForTimeout(1100);
  await shot("17_help_overlay_hold");

  await key("Escape", 250);
  await key("p", 350);
  await shot("18_plan_reopened");
  await page.waitForTimeout(900);
  await shot("19_plan_reopened_hold");

  return n;
}

async function buildGif() {
  const listPath = join(FRAMES_DIR, "frames.txt");
  const lines = [];
  for (const [name, duration] of FRAME_PLAN) {
    lines.push(`file '${join(FRAMES_DIR, name)}.png'`);
    lines.push(`duration ${duration}`);
  }
  // ffmpeg concat demuxer ignores the last duration, so repeat the final frame
  // to make it stick for its intended time.
  lines.push(`file '${join(FRAMES_DIR, FRAME_PLAN.at(-1)[0])}.png'`);
  await writeFile(listPath, lines.join("\n") + "\n");

  const palette = join(FRAMES_DIR, "palette.png");
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-vf", `scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff`,
    palette,
  ]);

  await mkdir(dirname(OUT_GIF), { recursive: true });
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-i", palette,
    "-filter_complex",
    `[0:v]scale=${GIF_WIDTH}:-1:flags=lanczos[s];[s][1:v]paletteuse=dither=bayer:bayer_scale=4`,
    "-loop", "0",
    OUT_GIF,
  ]);
}

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", rej);
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

function checkCommand(cmd, args = ["-version"]) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`dev server never came up at ${url}`);
}

function startDevServer() {
  const proc = spawn(
    "npm",
    ["run", "dev", "--silent", "--", "--port", String(PORT), "--strictPort"],
    { cwd: WEB_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  let tail = "";
  const capture = (chunk) => {
    tail = (tail + chunk.toString()).slice(-4000);
  };
  proc.stdout.on("data", capture);
  proc.stderr.on("data", capture);
  return { proc, getTail: () => tail };
}

async function main() {
  if (!(await checkCommand("ffmpeg"))) {
    console.error("ffmpeg not found on PATH. Install it (e.g. `brew install ffmpeg`) and retry.");
    process.exit(1);
  }

  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  console.log(`[demo] starting vite on :${PORT}`);
  const { proc: server, getTail } = startDevServer();
  let serverExited = false;
  server.on("exit", () => { serverExited = true; });

  const shutdown = async () => {
    if (serverExited) return;
    server.kill("SIGTERM");
    for (let i = 0; i < 20 && !serverExited; i++) await sleep(100);
    if (!serverExited) server.kill("SIGKILL");
  };

  try {
    await waitForServer(`http://localhost:${PORT}/`);
    console.log("[demo] launching chrome");
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE,
      });
      const page = await ctx.newPage();
      console.log("[demo] capturing frames");
      const n = await capture(page);
      console.log(`[demo] ${n} frames captured`);
    } finally {
      await browser.close();
    }
    console.log(`[demo] encoding ${OUT_GIF}`);
    await buildGif();
    console.log("[demo] done");
  } catch (err) {
    console.error("[demo] failed:", err.message);
    if (!serverExited) console.error("vite tail:\n" + getTail());
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();
