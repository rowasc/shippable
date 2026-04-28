#!/usr/bin/env node
// Regenerates demo GIFs by running every storyboard in ./storyboards/.
//
// Usage:
//   npm run demo                 # run every storyboard
//   npm run demo -- --only <n>   # run a specific storyboard by name
//
// Each storyboard declares its own output path (relative to the repo root).
// The runner spins up one Vite dev server and one Chrome for the whole batch.

import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  requireFfmpeg,
  runStoryboard,
  withChrome,
  withDevServer,
} from "./demo-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(WEB_DIR, "..");
const STORYBOARDS_DIR = resolve(__dirname, "storyboards");
const PORT = 5199;

function parseArgs(argv) {
  const out = { only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") out.only = argv[++i];
  }
  return out;
}

async function loadStoryboards() {
  const entries = await readdir(STORYBOARDS_DIR);
  // Files prefixed with `_` are shared modules (fixtures, helpers), not
  // storyboards. Skip them.
  const files = entries
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    .sort();
  const loaded = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(resolve(STORYBOARDS_DIR, f)).href);
    if (!mod.default) {
      throw new Error(`${f} must have a default export`);
    }
    loaded.push(mod.default);
  }
  return loaded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await requireFfmpeg();

  let storyboards = await loadStoryboards();
  if (args.only) {
    storyboards = storyboards.filter((sb) => sb.name === args.only);
    if (storyboards.length === 0) {
      throw new Error(`no storyboard named '${args.only}'`);
    }
  }
  if (storyboards.length === 0) {
    console.error("[demo] no storyboards found in", STORYBOARDS_DIR);
    process.exit(1);
  }

  console.log(`[demo] ${storyboards.length} storyboard(s): ${storyboards.map((s) => s.name).join(", ")}`);
  console.log(`[demo] starting vite on :${PORT}`);

  await withDevServer(WEB_DIR, PORT, async () => {
    await withChrome(async (browser) => {
      for (const sb of storyboards) {
        console.log(`[demo] running '${sb.name}' -> ${sb.output}`);
        const { frames, output, mp4 } = await runStoryboard(sb, { browser, repoRoot: REPO_ROOT });
        console.log(`[demo]   ${frames} frames -> ${output}`);
        if (mp4) console.log(`[demo]   ${frames} frames -> ${mp4}`);
      }
    });
  });

  console.log("[demo] done");
}

try {
  await main();
} catch (err) {
  console.error("[demo] failed:", err.message);
  if (err.serverTail) console.error("vite tail:\n" + err.serverTail);
  process.exit(1);
}
