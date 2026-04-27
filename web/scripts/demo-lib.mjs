// Storyboard executor used by scripts/generate-demo.mjs.
//
// A storyboard is a plain object describing a browser session: a URL, a
// viewport, and a sequence of steps (navigate, press, wait, shot). The
// executor drives Playwright through the steps, writes a PNG per `shot`
// step, then asks ffmpeg to stitch those PNGs into a GIF where each frame
// lingers for `shot.hold` seconds. Because both the capture order and the
// frame timing are encoded in the same step list, there's only one place
// to edit when you tweak a flow.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// ── step helpers ───────────────────────────────────────────────────────────
//
// Storyboards import these and return the step objects verbatim. Keeping the
// objects plain (no classes) means a storyboard file is trivially
// serialisable and could be produced by anything — including an AI prompt
// that reads the keymap and proposes a flow.

export const wait = (ms) => ({ type: "wait", ms });

export const waitFor = (selector, options = {}) => ({
  type: "waitFor",
  selector,
  options,
});

export const press = (key, opts = {}) => ({
  type: "press",
  key,
  times: opts.times ?? 1,
  interval: opts.interval ?? 150,
  hold: opts.hold ?? 0,
});

export const shot = (label, hold) => ({ type: "shot", label, hold });

// Click an element matched by CSS selector.
export const click = (selector, opts = {}) => ({
  type: "click",
  selector,
  hold: opts.hold ?? 0,
});

// Type into an input/textarea matched by CSS selector. The implementation
// uses Playwright's `fill` (replace) by default — pass `{ append: true }`
// to keep existing text and append.
export const type = (selector, text, opts = {}) => ({
  type: "type",
  selector,
  text,
  append: !!opts.append,
  hold: opts.hold ?? 0,
});

// Replace a DOM element's text content and select it (used to seed a known
// snippet of code into a diff line for the CodeRunner storyboard).
export const setSelection = (selector, text) => ({
  type: "setSelection",
  selector,
  text,
});

// ── storyboard factory ─────────────────────────────────────────────────────

export function storyboard(def) {
  const required = ["name", "url", "output", "steps"];
  for (const k of required) {
    if (!(k in def)) throw new Error(`storyboard missing '${k}'`);
  }
  // `name` is used in a tmp path we later rm -rf, so keep it to a safe charset.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(def.name)) {
    throw new Error(`invalid storyboard name '${def.name}' (use [a-z0-9._-])`);
  }
  return {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    gifWidth: 960,
    ...def,
  };
}

// ── executor ───────────────────────────────────────────────────────────────

async function executeSteps(page, steps, framesDir) {
  const frames = [];
  const usedLabels = new Set();
  for (const step of steps) {
    switch (step.type) {
      case "wait":
        await page.waitForTimeout(step.ms);
        break;
      case "waitFor":
        await page.waitForSelector(step.selector, {
          state: "visible",
          timeout: 5000,
          ...step.options,
        });
        break;
      case "press": {
        for (let i = 0; i < step.times; i++) {
          await page.keyboard.press(step.key);
          if (i < step.times - 1 && step.interval) {
            await page.waitForTimeout(step.interval);
          }
        }
        if (step.hold) await page.waitForTimeout(step.hold);
        else if (step.interval) await page.waitForTimeout(step.interval);
        break;
      }
      case "click": {
        await page.click(step.selector);
        if (step.hold) await page.waitForTimeout(step.hold);
        break;
      }
      case "type": {
        if (step.append) {
          await page.focus(step.selector);
          await page.keyboard.type(step.text);
        } else {
          await page.fill(step.selector, step.text);
        }
        if (step.hold) await page.waitForTimeout(step.hold);
        break;
      }
      case "setSelection": {
        await page.evaluate(
          ({ selector, text }) => {
            const node = document.querySelector(selector);
            if (!node) throw new Error(`setSelection: no node for '${selector}'`);
            node.textContent = text;
            const sel = window.getSelection();
            if (!sel) return;
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(node);
            sel.addRange(range);
          },
          { selector: step.selector, text: step.text },
        );
        break;
      }
      case "shot": {
        if (usedLabels.has(step.label)) {
          throw new Error(`duplicate shot label: ${step.label}`);
        }
        usedLabels.add(step.label);
        const idx = String(frames.length).padStart(3, "0");
        const file = join(framesDir, `${idx}_${step.label}.png`);
        await page.screenshot({ path: file, fullPage: false });
        frames.push({ file, hold: step.hold });
        break;
      }
      default:
        throw new Error(`unknown step type: ${step.type}`);
    }
  }
  return frames;
}

// ffmpeg's concat demuxer reads single-quoted paths; inside those, `'` must
// be written as `'\''` (close, escaped quote, reopen).
const concatQuote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

async function buildGif(frames, outPath, gifWidth, framesDir) {
  const listPath = join(framesDir, "frames.txt");
  const lines = [];
  for (const f of frames) {
    lines.push(`file ${concatQuote(f.file)}`);
    lines.push(`duration ${f.hold}`);
  }
  // The concat demuxer drops the final duration; repeat the last frame so
  // it holds for the intended time.
  lines.push(`file ${concatQuote(frames.at(-1).file)}`);
  await writeFile(listPath, lines.join("\n") + "\n");

  const palette = join(framesDir, "palette.png");
  await runCmd("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-vf",
    `scale=${gifWidth}:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff`,
    palette,
  ]);

  await mkdir(dirname(outPath), { recursive: true });
  await runCmd("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-i", palette,
    "-filter_complex",
    `[0:v]scale=${gifWidth}:-1:flags=lanczos[s];[s][1:v]paletteuse=dither=bayer:bayer_scale=4`,
    "-loop", "0",
    outPath,
  ]);
}

export async function runStoryboard(sb, { browser, repoRoot }) {
  const framesDir = join(tmpdir(), `shippable-demo-${sb.name}`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: sb.viewport,
    deviceScaleFactor: sb.deviceScaleFactor,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(sb.url, { waitUntil: "networkidle" });
    const frames = await executeSteps(page, sb.steps, framesDir);
    if (frames.length === 0) {
      throw new Error(`storyboard '${sb.name}' produced no shots`);
    }
    const outPath = join(repoRoot, sb.output);
    await buildGif(frames, outPath, sb.gifWidth, framesDir);
    return { frames: frames.length, output: outPath };
  } finally {
    await ctx.close();
  }
}

// ── server / browser / ffmpeg lifecycle ────────────────────────────────────

export async function withDevServer(webDir, port, fn) {
  const proc = spawn(
    "npm",
    ["run", "dev", "--silent", "--", "--port", String(port), "--strictPort"],
    { cwd: webDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let tail = "";
  const cap = (c) => { tail = (tail + c.toString()).slice(-4000); };
  proc.stdout.on("data", cap);
  proc.stderr.on("data", cap);

  let exited = false;
  proc.on("exit", () => { exited = true; });

  try {
    await waitForServer(`http://localhost:${port}/`);
    return await fn();
  } catch (err) {
    if (!exited) err.serverTail = tail;
    throw err;
  } finally {
    if (!exited) {
      proc.kill("SIGTERM");
      for (let i = 0; i < 20 && !exited; i++) await sleep(100);
      if (!exited) proc.kill("SIGKILL");
    }
  }
}

export async function withChrome(fn) {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function requireFfmpeg() {
  const ok = await new Promise((res) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
  if (!ok) {
    throw new Error("ffmpeg not found on PATH (try `brew install ffmpeg`)");
  }
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

function runCmd(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", rej);
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`)),
    );
  });
}
