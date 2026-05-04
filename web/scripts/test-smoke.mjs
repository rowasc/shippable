#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..");
const DEFAULT_PORT = Number.parseInt(process.env.SMOKE_PORT ?? "5198", 10);

const SMOKES = [
  { id: "coderunner", file: "smoke-coderunner.mjs", default: true },
  {
    id: "coderunner-modes",
    file: "smoke-coderunner-modes.mjs",
    default: false,
    blockedReason: "still targets the removed selection-pill runner flow",
  },
  { id: "coderunner-microscope", file: "smoke-coderunner-microscope.mjs", default: true },
  { id: "coderunner-timeout", file: "smoke-coderunner-timeout.mjs", default: true },
  { id: "coderunner-sandbox", file: "smoke-coderunner-sandbox.mjs", default: true },
  { id: "coderunner-ts-transpile", file: "smoke-coderunner-ts-transpile.mjs", default: true },
  { id: "themes", file: "smoke-themes.mjs", default: true },
  {
    id: "coderunner-php",
    file: "smoke-coderunner-php.mjs",
    default: false,
    blockedReason: "still targets the removed selection-pill runner flow",
  },
  {
    id: "coderunner-richphp",
    file: "smoke-coderunner-richphp.mjs",
    default: false,
    blockedReason: "still targets the removed selection-pill runner flow",
  },
  {
    id: "coderunner-php-worker",
    file: "smoke-coderunner-php-worker.mjs",
    default: false,
    blockedReason: "currently fails under Vite dev because the sandboxed PHP worker loads from origin 'null'",
  },
  {
    id: "coderunner-free",
    file: "smoke-coderunner-free.mjs",
    default: false,
    blockedReason: "targets the alternate :5174 fixture and is not part of the main app smoke path",
  },
  {
    id: "prompts",
    file: "smoke-prompts.mjs",
    default: false,
    blockedReason: "needs the separate prompt library server on :3001",
  },
  {
    id: "md-preview",
    file: "smoke-md-preview.mjs",
    default: true,
  },
  {
    id: "md-preview-theme",
    file: "smoke-md-preview-theme.mjs",
    default: false,
    blockedReason: "kept as an opt-in theme-focused smoke to keep the default suite narrower",
  },
];

function parseArgs(argv) {
  const out = {
    include: [],
    list: false,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") {
      out.list = true;
      continue;
    }
    if (arg === "--include") {
      out.include.push(...splitList(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("--include=")) {
      out.include.push(...splitList(arg.slice("--include=".length)));
      continue;
    }
    if (arg === "--port") {
      out.port = parsePort(argv[++i]);
      continue;
    }
    if (arg.startsWith("--port=")) {
      out.port = parsePort(arg.slice("--port=".length));
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  return out;
}

function splitList(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}

function printList() {
  console.log("Unified smoke registry:");
  for (const smoke of SMOKES) {
    const mode = smoke.default ? "default" : "manual";
    const suffix = smoke.blockedReason ? ` - ${smoke.blockedReason}` : "";
    console.log(`- ${smoke.id} (${smoke.file}, ${mode})${suffix}`);
  }
}

function resolveSelection(includeIds) {
  const selected = includeIds.length
    ? includeIds.map((id) => findSmoke(id))
    : SMOKES.filter((smoke) => smoke.default);

  const blocked = selected.filter((smoke) => smoke.blockedReason);
  if (blocked.length > 0) {
    const reasons = blocked
      .map((smoke) => `${smoke.id}: ${smoke.blockedReason}`)
      .join("\n");
    throw new Error(`unsupported smoke selection:\n${reasons}`);
  }

  return selected;
}

function findSmoke(id) {
  const smoke = SMOKES.find((entry) => entry.id === id);
  if (!smoke) {
    throw new Error(`unknown smoke id: ${id}`);
  }
  return smoke;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    printList();
    return;
  }

  const selected = resolveSelection(args.include);
  if (selected.length === 0) {
    throw new Error("no smoke scripts selected");
  }

  const baseUrl = `http://127.0.0.1:${args.port}`;
  console.log(`[smoke] ${selected.length} script(s): ${selected.map((smoke) => smoke.id).join(", ")}`);
  console.log(`[smoke] starting vite on ${baseUrl}`);

  await withDevServer({ webDir: WEB_DIR, port: args.port }, async () => {
    for (const smoke of selected) {
      console.log(`[smoke] running ${smoke.id}`);
      await runSmoke(smoke, baseUrl);
    }
  });

  console.log("[smoke] suite passed");
}

async function runSmoke(smoke, baseUrl) {
  await spawnChecked(process.execPath, [resolve(__dirname, smoke.file)], {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      BASE: baseUrl,
      URL: `${baseUrl}/`,
    },
  });
}

async function withDevServer({ webDir, port }, fn) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const proc = spawn(
    npmCmd,
    ["run", "dev", "--silent", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: webDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let tail = "";
  const capTail = (chunk) => {
    tail = (tail + chunk.toString()).slice(-4000);
  };
  proc.stdout.on("data", capTail);
  proc.stderr.on("data", capTail);

  let exited = false;
  proc.on("exit", () => {
    exited = true;
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/`);
    return await fn();
  } catch (error) {
    if (!exited) {
      error.serverTail = tail;
    }
    throw error;
  } finally {
    if (!exited) {
      proc.kill("SIGTERM");
      for (let i = 0; i < 20 && !exited; i++) {
        await sleep(100);
      }
      if (!exited) {
        proc.kill("SIGKILL");
      }
    }
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error(`dev server never came up at ${url}`);
}

async function spawnChecked(command, args, options) {
  await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(command, args, options);
    proc.on("error", rejectPromise);
    proc.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      if (signal) {
        rejectPromise(new Error(`${args.at(-1)} exited from signal ${signal}`));
        return;
      }
      rejectPromise(new Error(`${args.at(-1)} exited ${code}`));
    });
  });
}

try {
  await main();
} catch (error) {
  console.error("[smoke] failed:", error.message);
  if (error.serverTail) {
    console.error("[smoke] vite tail:\n" + error.serverTail);
  }
  process.exit(1);
}
