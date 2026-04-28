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

// `caption` paints a subtitle strip at the bottom of the viewport before the
// screenshot is taken. Pass `null` to clear an existing caption; omit it to
// inherit the previous shot's caption.
export const shot = (label, hold, opts = {}) => ({
  type: "shot",
  label,
  hold,
  caption: "caption" in opts ? opts.caption : undefined,
});

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

// Inject a fixed-position subtitle strip at the bottom of the viewport. The
// strip lives in the page itself so it shows up in screenshots without any
// post-processing. It overlaps the bottom ~56px of the app, which is fine for
// our flows (overlays render higher up).
async function injectCaptionBar(page) {
  await page.evaluate(() => {
    if (document.getElementById("__demo_caption__")) return;
    const bar = document.createElement("div");
    bar.id = "__demo_caption__";
    bar.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      "padding:14px 24px",
      "background:rgba(12,14,20,0.92)",
      "color:#f5f7fa",
      "font:600 18px/1.35 -apple-system,system-ui,'Segoe UI',sans-serif",
      "letter-spacing:0.01em",
      "text-align:center",
      "border-top:1px solid rgba(255,255,255,0.08)",
      "z-index:2147483647",
      "pointer-events:none",
      "opacity:0",
      "transition:opacity 120ms ease",
    ].join(";");
    document.body.appendChild(bar);
  });
}

async function setCaption(page, text) {
  await page.evaluate((t) => {
    const bar = document.getElementById("__demo_caption__");
    if (!bar) return;
    bar.textContent = t || "";
    bar.style.opacity = t ? "1" : "0";
  }, text);
}

async function executeSteps(page, steps, framesDir) {
  const frames = [];
  const usedLabels = new Set();
  let currentCaption = "";
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
        if (step.caption !== undefined) {
          currentCaption = step.caption ?? "";
          await setCaption(page, currentCaption);
        }
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

async function writeFrameList(frames, framesDir) {
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
  return listPath;
}

async function buildGif(listPath, outPath, gifWidth, framesDir) {
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

// MP4 output for embedding where bandwidth or color quality matters. Uses
// libx264 with yuv420p for universal browser support and `+faststart` so the
// moov atom lands at the front (lets browsers begin playback before download
// finishes). Width matches the GIF; height is rounded to even via `-2` because
// yuv420p requires even dimensions.
async function buildMp4(listPath, outPath, width) {
  await mkdir(dirname(outPath), { recursive: true });
  await runCmd("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-vf", `scale=${width}:-2:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "22",
    "-movflags", "+faststart",
    "-r", "30",
    outPath,
  ]);
}

function swapExt(p, ext) {
  return p.replace(/\.[^./]+$/, ext);
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
    // Storyboards can declare `routes: [{url, handler}]` to mock specific
    // network calls (e.g. /api/plan) so the demo is reproducible without
    // running the backend.
    if (sb.routes) {
      for (const r of sb.routes) {
        await page.route(r.url, r.handler);
      }
    }
    await page.goto(sb.url, { waitUntil: "networkidle" });
    await injectCaptionBar(page);
    const frames = await executeSteps(page, sb.steps, framesDir);
    if (frames.length === 0) {
      throw new Error(`storyboard '${sb.name}' produced no shots`);
    }
    const outPath = join(repoRoot, sb.output);
    const mp4Path = swapExt(outPath, ".mp4");
    const listPath = await writeFrameList(frames, framesDir);
    await buildGif(listPath, outPath, sb.gifWidth, framesDir);
    await buildMp4(listPath, mp4Path, sb.gifWidth);
    return { frames: frames.length, output: outPath, mp4: mp4Path };
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
