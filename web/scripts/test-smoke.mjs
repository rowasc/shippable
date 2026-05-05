#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..");
const DEFAULT_PORT = Number.parseInt(process.env.SMOKE_PORT ?? "5198", 10);
// Real server lives on :3001 (`vite.config.ts` proxies /api → there). The
// suite stubs that port so the boot gate (`ServerHealthGate`) passes without
// requiring the Node server or an Anthropic key. Smokes that want to
// exercise real server behaviour must run outside this harness — see the
// `prompts` entry in SMOKES.
const FAKE_API_PORT = 3001;

const SMOKES = [
  { id: "boot-gate", file: "smoke-boot-gate.mjs", default: true },
  { id: "coderunner", file: "smoke-coderunner.mjs", default: true },
  { id: "coderunner-microscope", file: "smoke-coderunner-microscope.mjs", default: true },
  { id: "coderunner-timeout", file: "smoke-coderunner-timeout.mjs", default: true },
  { id: "coderunner-sandbox", file: "smoke-coderunner-sandbox.mjs", default: true },
  { id: "coderunner-ts-transpile", file: "smoke-coderunner-ts-transpile.mjs", default: true },
  { id: "themes", file: "smoke-themes.mjs", default: true },
  { id: "coderunner-php-worker", file: "smoke-coderunner-php-worker.mjs", default: true },
  { id: "coderunner-free", file: "smoke-coderunner-free.mjs", default: true },
  {
    id: "md-preview",
    file: "smoke-md-preview.mjs",
    default: true,
  },
  { id: "md-preview-theme", file: "smoke-md-preview-theme.mjs", default: true },
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
  // Best-effort fake api on :3001. If the port is already taken — typically
  // because the developer has the real Node server running — leave that one
  // alone and assume it answers /api/health. The boot-gate smoke uses
  // page.route() for its 503 case, so it doesn't depend on the stub either.
  const fakeApi = await startFakeApi(FAKE_API_PORT);
  if (fakeApi) console.log(`[smoke] fake api up on :${FAKE_API_PORT}`);
  else console.log(`[smoke] :${FAKE_API_PORT} already in use; using whatever's listening`);
  try {
    console.log(`[smoke] starting vite on ${baseUrl}`);
    await withDevServer({ webDir: WEB_DIR, port: args.port }, async () => {
      for (const smoke of selected) {
        console.log(`[smoke] running ${smoke.id}`);
        await runSmoke(smoke, baseUrl);
      }
    });
  } finally {
    if (fakeApi) await new Promise((resolveClose) => fakeApi.close(() => resolveClose()));
  }

  console.log("[smoke] suite passed");
}

/**
 * Tiny stub backend so `ServerHealthGate` passes during smokes. Returns 200
 * for `/api/health`; everything else returns 503 so a smoke that
 * accidentally hits a real endpoint surfaces a clear error rather than
 * hanging on a proxy timeout. Smokes that need to script richer server
 * behaviour (e.g. canned `/api/plan` responses) should use playwright's
 * `page.route()` to intercept on the browser side.
 */
function startFakeApi(port) {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(`{"error":"smoke stub: ${req.method} ${req.url} not mocked"}`);
    });
    server.once("error", (err) => {
      // EADDRINUSE: real server is on :3001 already. EPERM/EACCES: sandbox
      // forbids the bind. Either way, skip the stub and let whatever's
      // listening (or page.route() in each smoke) handle /api/health.
      if (err.code === "EADDRINUSE" || err.code === "EPERM" || err.code === "EACCES") {
        resolveServer(null);
        return;
      }
      rejectServer(err);
    });
    server.listen(port, "127.0.0.1", () => {
      server.removeAllListeners("error");
      resolveServer(server);
    });
  });
}

async function runSmoke(smoke, baseUrl) {
  await spawnChecked(process.execPath, [resolve(__dirname, smoke.file)], {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      BASE: baseUrl,
      // Deep-link into a stub so smokes that goto URL plain skip the
      // welcome screen and land on the workspace. Smokes that need a
      // different changeset (md-preview, themes, boot-gate) hit BASE
      // directly with their own ?cs=NN.
      URL: `${baseUrl}/?cs=42`,
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
