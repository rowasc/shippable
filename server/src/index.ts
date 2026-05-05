import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePlan } from "./plan.ts";
import * as library from "./library.ts";
import * as prompts from "./prompts.ts";
import { streamReview } from "./review.ts";
import * as worktrees from "./worktrees.ts";
import * as agentContext from "./agent-context.ts";
import * as hookStatus from "./hook-status.ts";
import * as agentQueue from "./agent-queue.ts";
import { assertGitDir } from "./worktree-validation.ts";
import type { ChangeSet } from "../../web/src/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const ALLOWED_ORIGINS = loadAllowedOrigins();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[server] ANTHROPIC_API_KEY is not set in the environment. See README — recommended path on macOS is `export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)` before `npm run dev`.",
  );
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const check = classifyRequestOrigin(req.headers.origin);
    const fetchSite = classifyFetchSite(req.headers["sec-fetch-site"]);
    const origin = check.kind === "value" ? check.origin : null;
    if (req.method === "OPTIONS") {
      if (!isRequestAllowed(check, fetchSite)) {
        res.writeHead(403).end();
        return;
      }
      writeCorsHeaders(res, origin);
      res.writeHead(204).end();
      return;
    }
    if (!isRequestAllowed(check, fetchSite)) {
      console.warn(
        `[server] denied: origin=${JSON.stringify(req.headers.origin)} parsed=${JSON.stringify(check)} fetch-site=${fetchSite}`,
      );
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request not allowed" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/plan") {
      return handlePlan(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/review") {
      return handleReview(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/library/refresh") {
      return handleLibraryRefresh(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/library/prompts") {
      return handleListPrompts(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/list") {
      return handleWorktreesList(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/changeset") {
      return handleWorktreesChangeset(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/sessions") {
      return handleWorktreesSessions(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/agent-context") {
      return handleWorktreesAgentContext(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/worktrees/hook-status") {
      return handleWorktreesHookStatus(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/install-hook") {
      return handleWorktreesInstallHook(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/enqueue") {
      return handleAgentEnqueue(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/pull") {
      return handleAgentPull(req, res, origin);
    }
    if (req.method === "GET" && req.url?.startsWith("/api/agent/delivered")) {
      return handleAgentDelivered(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/health") {
      writeCorsHeaders(res, origin);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    writeCorsHeaders(res, origin);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal server error" }));
    }
  }
});

async function handlePlan(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { changeset?: ChangeSet };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const cs = parsed.changeset;
  if (!cs || typeof cs !== "object" || !("files" in cs)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { changeset: ChangeSet }" }));
    return;
  }

  const started = Date.now();
  console.log(`[server] /api/plan cs=${cs.id} files=${cs.files.length}`);
  try {
    const plan = await generatePlan(cs);
    const ms = Date.now() - started;
    console.log(
      `[server]   → ok in ${ms}ms: ${plan.intent.length} claims, ${plan.entryPoints.length} entry points`,
    );
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ plan }));
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[server]   → err in ${ms}ms:`, err);
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

// Per-IP fixed-window limiter on the streaming endpoint. A stolen session
// shouldn't be able to drain the API budget; this is the cheapest brake.
const REVIEW_RATE_LIMIT = Number(process.env.SHIPPABLE_REVIEW_RATE_LIMIT ?? 30);
const REVIEW_RATE_WINDOW_MS = 60_000;
const reviewRequestLog = new Map<string, number[]>();

function checkReviewRateLimit(ip: string): { allowed: true } | { allowed: false; resetSec: number } {
  const now = Date.now();
  const live = (reviewRequestLog.get(ip) ?? []).filter(
    (t) => now - t < REVIEW_RATE_WINDOW_MS,
  );
  if (live.length >= REVIEW_RATE_LIMIT) {
    reviewRequestLog.set(ip, live);
    const resetSec = Math.ceil((REVIEW_RATE_WINDOW_MS - (now - live[0])) / 1000);
    return { allowed: false, resetSec };
  }
  live.push(now);
  reviewRequestLog.set(ip, live);
  return { allowed: true };
}

async function handleReview(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const ip = req.socket.remoteAddress ?? "unknown";
  const gate = checkReviewRateLimit(ip);
  if (!gate.allowed) {
    writeCorsHeaders(res, origin);
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": gate.resetSec.toString(),
    });
    res.end(
      JSON.stringify({
        error: `rate limit exceeded — try again in ${gate.resetSec}s (${REVIEW_RATE_LIMIT} requests / 60s)`,
      }),
    );
    return;
  }
  const body = await readBody(req);
  writeCorsHeaders(res, origin);
  await streamReview(body, req, res);
}

async function handleListPrompts(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  try {
    const list = await prompts.list();
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ prompts: list }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] /api/library/prompts err:", err);
    writeCorsHeaders(res, origin);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleLibraryRefresh(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const adminToken = process.env.SHIPPABLE_ADMIN_TOKEN?.trim();
  const devMode = process.env.SHIPPABLE_DEV_MODE === "1";
  if (!devMode) {
    if (!adminToken) {
      writeCorsHeaders(res, origin);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "library refresh requires SHIPPABLE_ADMIN_TOKEN" }));
      return;
    }
    const provided = req.headers["x-admin-token"];
    if (provided !== adminToken) {
      writeCorsHeaders(res, origin);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid admin token" }));
      return;
    }
  }

  const started = Date.now();
  try {
    const source = await library.sync();
    const ms = Date.now() - started;
    const ref = source.kind === "git" ? await library.currentRef() : null;
    console.log(
      `[server] /api/library/refresh kind=${source.kind} root=${source.root} ms=${ms}`,
    );
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        kind: source.kind,
        root: source.root,
        ref,
      }),
    );
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server] /api/library/refresh err in ${ms}ms:`, err);
    writeCorsHeaders(res, origin);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesList(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { dir?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const dir = typeof parsed.dir === "string" ? parsed.dir : "";
  if (!dir) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { dir: string }" }));
    return;
  }
  try {
    const result = await worktrees.listWorktrees(dir);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/list err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesChangeset(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { path?: unknown; ref?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath = typeof parsed.path === "string" ? parsed.path : "";
  const ref =
    typeof parsed.ref === "string" && parsed.ref.length > 0 ? parsed.ref : null;
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { path: string, ref?: string }" }));
    return;
  }
  try {
    // Default: cumulative branch view (committed-since-base + uncommitted +
    // untracked). Only fall back to the single-commit view when the caller
    // asks for a specific ref — that's a future "load specific commit" UX,
    // not what LoadModal does today.
    const result = ref
      ? await worktrees.changesetFor(wtPath, ref)
      : await worktrees.branchChangeset(wtPath);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/changeset err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesSessions(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { path?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath = typeof parsed.path === "string" ? parsed.path : "";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { path: string }" }));
    return;
  }
  try {
    const sessions = await agentContext.listSessionsForWorktree(wtPath);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/sessions err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesAgentContext(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: {
    path?: unknown;
    sessionFilePath?: unknown;
    commitSha?: unknown;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath = typeof parsed.path === "string" ? parsed.path : "";
  const sessionFilePath =
    typeof parsed.sessionFilePath === "string" ? parsed.sessionFilePath : "";
  const commitSha =
    typeof parsed.commitSha === "string" && parsed.commitSha.length > 0
      ? parsed.commitSha
      : null;
  if (!wtPath || !sessionFilePath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { path: string, sessionFilePath: string, commitSha?: string }",
      }),
    );
    return;
  }
  try {
    const slice = await agentContext.agentContextForCommit({
      worktreePath: wtPath,
      sessionFilePath,
      commitSha,
    });
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ slice }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/agent-context err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesHookStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  try {
    const status = await hookStatus.checkHookStatus();
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesInstallHook(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  try {
    const result = await hookStatus.installHook();
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/install-hook err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

// ---------------------------------------------------------------------------
// Agent comment queue (slice (a) of docs/plans/push-review-comments.md)
// ---------------------------------------------------------------------------

async function handleAgentEnqueue(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: {
    worktreePath?: unknown;
    commitSha?: unknown;
    comments?: unknown;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath =
    typeof parsed.worktreePath === "string" ? parsed.worktreePath : "";
  const commitSha =
    typeof parsed.commitSha === "string" ? parsed.commitSha : "";
  const rawComments = parsed.comments;
  if (!wtPath || !commitSha || !Array.isArray(rawComments)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { worktreePath: string, commitSha: string, comments: Array }",
      }),
    );
    return;
  }
  const validKinds = new Set<agentQueue.CommentKind>([
    "line",
    "block",
    "reply-to-ai-note",
    "reply-to-teammate",
    "reply-to-hunk-summary",
    "freeform",
  ]);
  const inputs: Array<Omit<agentQueue.Comment, "id" | "enqueuedAt">> = [];
  for (let i = 0; i < rawComments.length; i++) {
    const item = rawComments[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `comments[${i}] must be an object` }));
      return;
    }
    const kind = item.kind;
    if (
      typeof kind !== "string" ||
      !validKinds.has(kind as agentQueue.CommentKind)
    ) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `comments[${i}].kind invalid` }));
      return;
    }
    const bodyText = item.body;
    if (typeof bodyText !== "string" || bodyText.length === 0) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `comments[${i}].body must be a non-empty string`,
        }),
      );
      return;
    }
    const file =
      typeof item.file === "string" && item.file.length > 0
        ? item.file
        : undefined;
    const lines =
      typeof item.lines === "string" && item.lines.length > 0
        ? item.lines
        : undefined;
    inputs.push({
      kind: kind as agentQueue.CommentKind,
      body: bodyText,
      commitSha,
      ...(file !== undefined ? { file } : {}),
      ...(lines !== undefined ? { lines } : {}),
    });
  }
  try {
    await assertGitDir(wtPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
    return;
  }
  const enriched = agentQueue.enqueue(wtPath, inputs);
  console.log(
    `[server] /api/agent/enqueue worktree=${wtPath} commit=${commitSha} count=${enriched.length}`,
  );
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      enqueued: enriched.length,
      ids: enriched.map((c) => c.id),
    }),
  );
}

async function handleAgentPull(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { worktreePath?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath =
    typeof parsed.worktreePath === "string" ? parsed.worktreePath : "";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { worktreePath: string }" }));
    return;
  }
  try {
    await assertGitDir(wtPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
    return;
  }
  // Cheap path: the hook fires per-tool, so this must not touch disk or git.
  // Map lookup + clear + format only.
  const pulled = agentQueue.pullAndAck(wtPath);
  if (pulled.length === 0) {
    // Per the cross-cutting note in the plan (§ 6, hook-frequency sanity
    // check), empty pulls are silent — a 50-tool turn would otherwise spam
    // the log with 50 lines.
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ payload: "", ids: [] }));
    return;
  }
  // The envelope's `commit` attr: pick the first comment's commitSha. In
  // practice every batch is enqueued at one commit (the changeset's HEAD),
  // so this matches the intent. If somehow a worktree had multiple enqueue
  // calls at different commits that haven't been pulled yet, we collapse to
  // the oldest — informational only; the agent has the file at HEAD anyway.
  const commitSha = pulled[0].commitSha;
  const payload = agentQueue.formatPayload(commitSha, pulled);
  console.log(
    `[server] /api/agent/pull worktree=${wtPath} delivered=${pulled.length}`,
  );
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ payload, ids: pulled.map((c) => c.id) }));
}

async function handleAgentDelivered(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  // Path is parsed manually since the rest of the file uses raw `req.url`
  // comparisons. Build a URL with a placeholder host so URLSearchParams works.
  const url = new URL(req.url ?? "/", "http://localhost");
  const wtPath = url.searchParams.get("path") ?? "";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected ?path=<worktreePath>" }));
    return;
  }
  try {
    await assertGitDir(wtPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
    return;
  }
  const delivered = agentQueue.listDelivered(wtPath);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ delivered }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    // WHATWG URL spec returns the literal string "null" for `.origin` of any
    // non-special scheme (tauri://, app://, file://, etc.), which would
    // collapse every tauri:// URL into the same allowlist entry. Reconstruct
    // a stable scheme+host form so each non-special origin stays distinct.
    if (url.origin === "null") {
      return `${url.protocol}//${url.host}`;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function loadAllowedOrigins(): Set<string> {
  const configured = process.env.SHIPPABLE_ALLOWED_ORIGINS;
  const source =
    configured === undefined
      ? DEFAULT_ALLOWED_ORIGINS
      : configured.split(",");
  return new Set(
    source
      .map((origin) => parseOrigin(origin.trim()))
      .filter((origin): origin is string => !!origin),
  );
}

type OriginCheck =
  | { kind: "absent" }
  | { kind: "opaque" }
  | { kind: "value"; origin: string };

function classifyRequestOrigin(value: string | undefined): OriginCheck {
  // "absent": no Origin header — non-browser caller (curl, Vite dev proxy).
  // "opaque": header present but unparseable, including the literal string
  //   "null" that browsers send from sandboxed iframes, data: URLs, and some
  //   cross-origin redirects. Must be denied — collapsing this to "absent"
  //   is a CSRF hole (see git history for the exploit).
  // "value": parseable origin; check against the allowlist.
  if (value === undefined) return { kind: "absent" };
  const parsed = parseOrigin(value);
  return parsed === null
    ? { kind: "opaque" }
    : { kind: "value", origin: parsed };
}

type FetchSite = "same-origin" | "same-site" | "cross-site" | "none";

function classifyFetchSite(
  value: string | string[] | undefined,
): FetchSite | null {
  if (
    value === "same-origin" ||
    value === "same-site" ||
    value === "cross-site" ||
    value === "none"
  ) {
    return value;
  }
  return null;
}

function isRequestAllowed(
  check: OriginCheck,
  fetchSite: FetchSite | null,
): boolean {
  // Browser requests that present an Origin header must always match the
  // explicit allowlist. `Sec-Fetch-Site` is only an extra deny signal; it is
  // never enough on its own to broaden the allowlist.
  if (check.kind === "value") {
    return ALLOWED_ORIGINS.has(check.origin);
  }
  // Opaque origins (`Origin: null`, sandboxed iframes, data: URLs, some
  // redirects) are always denied.
  if (check.kind === "opaque") {
    return false;
  }
  // No Origin header: allow non-browser callers (curl, the Vite dev proxy).
  // If a browser somehow reports this as cross-site, deny it anyway.
  if (fetchSite === "cross-site") {
    return false;
  }
  // Otherwise this is either a non-browser caller or a legacy browser that
  // didn't send enough fetch metadata to classify further.
  switch (check.kind) {
    case "absent":
      return true;
  }
}

function writeCorsHeaders(res: ServerResponse, origin: string | null) {
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

server.listen(PORT, HOST, () => {
  const allowed = ALLOWED_ORIGINS.size > 0 ? [...ALLOWED_ORIGINS].join(", ") : "(none)";
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] allowed browser origins: ${allowed}`);
});
