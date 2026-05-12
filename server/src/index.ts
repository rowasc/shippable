import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { getDefinitionCapabilities, resolveDefinition } from "./definitions.ts";
import { resolveCodeGraph, type CodeGraphRequest } from "./codeGraph.ts";
import { generatePlan } from "./plan.ts";
import * as library from "./library.ts";
import * as prompts from "./prompts.ts";
import { streamReview } from "./review.ts";
import * as worktrees from "./worktrees.ts";
import * as agentContext from "./agent-context.ts";
import * as mcpStatus from "./mcp-status.ts";
import * as agentQueue from "./agent-queue.ts";
import type { Comment, CommentKind } from "./agent-queue.ts";
import { removePortFile, writePortFile } from "./port-file.ts";
import { getCredential, hasCredential } from "./auth/store.ts";
import {
  handleAuthSet,
  handleAuthClear,
  handleAuthList,
} from "./auth/endpoints.ts";
import {
  RequestBodyTooLargeError,
  readBody,
  writeCorsHeaders,
} from "./http.ts";
import { parsePrUrl } from "./github/url.ts";
import { loadPr } from "./github/pr-load.ts";
import { GithubApiError } from "./github/api-client.ts";
import { lookupPrForBranch } from "./github/branch-lookup.ts";
import { assertGitDir } from "./worktree-validation.ts";
import type { ChangeSet } from "../../web/src/types.ts";
import type { DefinitionRequest } from "../../web/src/definitionTypes.ts";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const ALLOWED_ORIGINS = loadAllowedOrigins();

// Server factory. The `.listen()` happens only in `main()` below — when the
// module is imported by tests we want to bind on an ephemeral port instead
// of the default 3001.
export function createApp(): Server {
  return createServer(async (req, res) => {
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
      return await handlePlan(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/review") {
      return await handleReview(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/definition/capabilities") {
      return await handleDefinitionCapabilities(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/definition") {
      return await handleDefinition(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/code-graph") {
      return await handleCodeGraph(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/library/refresh") {
      return await handleLibraryRefresh(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/library/prompts") {
      return await handleListPrompts(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/list") {
      return await handleWorktreesList(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/pick-directory") {
      return await handleWorktreesPickDirectory(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/changeset") {
      return await handleWorktreesChangeset(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/commits") {
      return await handleWorktreesCommits(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/state") {
      return handleWorktreesState(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/file-at") {
      return handleWorktreesFileAt(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/graph") {
      return await handleWorktreesGraph(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/sessions") {
      return await handleWorktreesSessions(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/worktrees/agent-context") {
      return await handleWorktreesAgentContext(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/worktrees/mcp-status") {
      return await handleWorktreesMcpStatus(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/auth/set") {
      return await handleAuthSet(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/auth/clear") {
      return await handleAuthClear(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/auth/list") {
      return await handleAuthList(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/github/pr/load") {
      return await handleGithubPrLoad(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/github/pr/branch-lookup") {
      return await handleGithubPrBranchLookup(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/enqueue") {
      return await handleAgentEnqueue(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/pull") {
      return await handleAgentPull(req, res, origin);
    }
    if (
      req.method === "GET" &&
      req.url &&
      req.url.startsWith("/api/agent/delivered")
    ) {
      return await handleAgentDelivered(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/unenqueue") {
      return await handleAgentUnenqueue(req, res, origin);
    }
    if (req.method === "POST" && req.url === "/api/agent/comments") {
      return await handleAgentPostComment(req, res, origin);
    }
    if (
      req.method === "GET" &&
      req.url &&
      req.url.startsWith("/api/agent/comments")
    ) {
      return await handleAgentListComments(req, res, origin);
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
    if (err instanceof RequestBodyTooLargeError) {
      // Map oversized-body rejections from `readBody` to a real
      // 413 instead of a generic 500 — clients can recover, ops can
      // grep for it, and the security signal isn't lost in the noise.
      if (!res.headersSent) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal server error" }));
    }
  }
  });
}

async function handlePlan(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  if (!hasCredential({ kind: "anthropic" })) {
    writeCorsHeaders(res, origin);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "anthropic_key_missing" }));
    return;
  }
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

// Per-IP fixed-window limiter on the streaming endpoint. Defaults to 30 requests per minute as a check against accidental/local spam; tune with:
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
  if (!hasCredential({ kind: "anthropic" })) {
    writeCorsHeaders(res, origin);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "anthropic_key_missing" }));
    return;
  }
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

async function handleDefinitionCapabilities(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(getDefinitionCapabilities()));
}

async function handleDefinition(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: DefinitionRequest;
  try {
    parsed = JSON.parse(body) as DefinitionRequest;
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }

  const result = await resolveDefinition(parsed);
  writeCorsHeaders(res, origin);
  res.writeHead(result.status === "error" ? 502 : 200, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(result));
}

async function handleCodeGraph(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: CodeGraphRequest;
  try {
    parsed = JSON.parse(body) as CodeGraphRequest;
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  try {
    const result = await resolveCodeGraph(parsed);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/code-graph err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
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
  let parsed: {
    path?: unknown;
    ref?: unknown;
    dirty?: unknown;
    fromRef?: unknown;
    toRef?: unknown;
    includeDirty?: unknown;
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
  const ref =
    typeof parsed.ref === "string" && parsed.ref.length > 0 ? parsed.ref : null;
  const dirty = parsed.dirty === true;
  const fromRef =
    typeof parsed.fromRef === "string" && parsed.fromRef.length > 0
      ? parsed.fromRef
      : null;
  const toRef =
    typeof parsed.toRef === "string" && parsed.toRef.length > 0
      ? parsed.toRef
      : null;
  const includeDirty = parsed.includeDirty === true;
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { path: string, ref?: string, dirty?: boolean, fromRef?: string, toRef?: string, includeDirty?: boolean }",
      }),
    );
    return;
  }
  try {
    // Routing precedence: range > dirty > single-ref > cumulative branch view.
    // Strict superset of the original contract — legacy callers (no fromRef/toRef)
    // still hit the dirty/ref/branch paths unchanged.
    const result =
      fromRef && toRef
        ? await worktrees.rangeChangeset(wtPath, fromRef, toRef, includeDirty)
        : dirty
          ? await worktrees.dirtyChangesetFor(wtPath)
          : ref
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

async function handleWorktreesCommits(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { path?: unknown; limit?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath = typeof parsed.path === "string" ? parsed.path : "";
  const limit = typeof parsed.limit === "number" ? parsed.limit : undefined;
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "expected { path: string, limit?: number }" }),
    );
    return;
  }
  try {
    const commits = await worktrees.listCommits(wtPath, limit);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ commits }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/commits err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesState(
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
    const state = await worktrees.stateFor(wtPath);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 404 on missing/non-git paths so the client can stop polling cleanly
    // without a banner-spamming log of generic 400s.
    const status = /does not exist|not a directory|no \.git entry/.test(message)
      ? 404
      : 400;
    writeCorsHeaders(res, origin);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesFileAt(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { path?: unknown; sha?: unknown; file?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const wtPath = typeof parsed.path === "string" ? parsed.path : "";
  const sha = typeof parsed.sha === "string" ? parsed.sha : "";
  const file = typeof parsed.file === "string" ? parsed.file : "";
  if (!wtPath || !sha || !file) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "expected { path: string, sha: string, file: string }",
      }),
    );
    return;
  }
  try {
    const content = await worktrees.fileAt(wtPath, sha, file);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ content }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/file-at err: ${message}`);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleWorktreesGraph(
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
  const ref = typeof parsed.ref === "string" && parsed.ref.length > 0 ? parsed.ref : "HEAD";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { path: string, ref?: string }" }));
    return;
  }
  try {
    const graph = await worktrees.repoGraphFor(wtPath, ref);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ graph }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/graph err: ${message}`);
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

async function handleWorktreesPickDirectory(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { startPath?: unknown } = {};
  if (body.trim().length > 0) {
    try {
      parsed = JSON.parse(body);
    } catch {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
  }
  const startPath =
    typeof parsed.startPath === "string" && parsed.startPath.length > 0
      ? parsed.startPath
      : undefined;
  try {
    const result = await worktrees.pickDirectory(startPath);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] /api/worktrees/pick-directory err: ${message}`);
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

async function handleWorktreesMcpStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  // Errors here can only come from the helper itself (it already swallows
  // missing/malformed config files); surface them as 500 so the panel falls
  // back to the install affordance rather than wedging in a "loading" state.
  try {
    const status = await mcpStatus.checkMcpStatus();
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

const COMMENT_KINDS: readonly CommentKind[] = [
  "line",
  "block",
  "reply-to-ai-note",
  "reply-to-teammate",
  "reply-to-hunk-summary",
  "reply-to-agent-comment",
];

/**
 * Line-anchor shape accepted on the wire: a single line ("42") or an
 * inclusive range ("40-58"). Anything else is rejected at the boundary
 * so the reviewer panel and the agent envelope never have to defend
 * against multiline / wildcard / shell-injected `lines` strings.
 */
const LINES_PATTERN = /^\d+(-\d+)?$/;

/** Conservative upper bound on `agentLabel` to keep the in-memory store
 *  bounded against a noisy or hostile caller. Far longer than any real
 *  per-harness identity (`claude-code`, `codex`, etc.). */
const MAX_AGENT_LABEL_LENGTH = 64;

async function handleGithubPrLoad(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { prUrl?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }

  if (typeof parsed.prUrl !== "string" || !parsed.prUrl) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { prUrl: string }" }));
    return;
  }

  let coords: ReturnType<typeof parsePrUrl>;
  try {
    coords = parsePrUrl(parsed.prUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_pr_url", detail }));
    return;
  }

  const token = getCredential({ kind: "github", host: coords.host });
  if (!token) {
    writeCorsHeaders(res, origin);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "github_token_required", host: coords.host }),
    );
    return;
  }

  try {
    const result = await loadPr(coords, token);
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    if (err instanceof GithubApiError) {
      const e = err.error;
      if (e.kind === "github_token_required") {
        writeCorsHeaders(res, origin);
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.kind, host: e.host }));
        return;
      }
      if (e.kind === "github_auth_failed") {
        writeCorsHeaders(res, origin);
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.kind, host: e.host, hint: e.hint }));
        return;
      }
      if (e.kind === "github_pr_not_found") {
        writeCorsHeaders(res, origin);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.kind }));
        return;
      }
      if (e.kind === "github_upstream") {
        writeCorsHeaders(res, origin);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: e.kind,
            status: e.status,
            message: e.message,
          }),
        );
        return;
      }
    }
    throw err;
  }
}

async function handleGithubPrBranchLookup(
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

  if (typeof parsed.worktreePath !== "string" || !parsed.worktreePath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { worktreePath: string }" }));
    return;
  }

  try {
    const result = await lookupPrForBranch(
      parsed.worktreePath,
      (host) => getCredential({ kind: "github", host }),
    );
    if (result.kind === "token_required") {
      writeCorsHeaders(res, origin);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "github_token_required",
          host: result.host,
        }),
      );
      return;
    }
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ matched: result.matched }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

const OUTCOMES: readonly agentQueue.Outcome[] = ["addressed", "declined", "noted"];

function isOutcome(value: unknown): value is agentQueue.Outcome {
  return (
    typeof value === "string" &&
    OUTCOMES.includes(value as agentQueue.Outcome)
  );
}

function isCommentKind(value: unknown): value is CommentKind {
  return (
    typeof value === "string" && COMMENT_KINDS.includes(value as CommentKind)
  );
}

async function handleAgentEnqueue(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: {
    worktreePath?: unknown;
    commitSha?: unknown;
    comment?: unknown;
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
  const commentInput = parsed.comment as
    | {
        kind?: unknown;
        file?: unknown;
        lines?: unknown;
        body?: unknown;
        supersedes?: unknown;
        parentAgentCommentId?: unknown;
      }
    | undefined;
  if (!wtPath || !commitSha || !commentInput || typeof commentInput !== "object") {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { worktreePath: string, commitSha: string, comment: { kind, body, ... } }",
      }),
    );
    return;
  }
  if (!isCommentKind(commentInput.kind)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid comment.kind" }));
    return;
  }
  if (typeof commentInput.body !== "string" || commentInput.body.length === 0) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "comment.body must be a non-empty string" }));
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
  if (
    typeof commentInput.file !== "string" ||
    commentInput.file.length === 0
  ) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "comment.file must be a non-empty string" }));
    return;
  }
  // The `reply-to-agent-comment` kind links a reviewer reply to its parent
  // top-level agent comment. Required field; validated against the
  // worktree's agent-comment store so the agent doesn't see orphans.
  let parentAgentCommentId: string | undefined;
  if (commentInput.kind === "reply-to-agent-comment") {
    if (
      typeof commentInput.parentAgentCommentId !== "string" ||
      commentInput.parentAgentCommentId.length === 0
    ) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "comment.parentAgentCommentId is required when kind is 'reply-to-agent-comment'",
        }),
      );
      return;
    }
    if (
      !agentQueue.isAgentCommentId(wtPath, commentInput.parentAgentCommentId)
    ) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `comment.parentAgentCommentId ${JSON.stringify(commentInput.parentAgentCommentId)} is not an agent comment in this worktree`,
        }),
      );
      return;
    }
    parentAgentCommentId = commentInput.parentAgentCommentId;
  }
  if (
    typeof commentInput.lines === "string" &&
    commentInput.lines.length > 0 &&
    !LINES_PATTERN.test(commentInput.lines)
  ) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "comment.lines must be a single line number (\"42\") or a range (\"40-58\")",
      }),
    );
    return;
  }
  const comment: Omit<Comment, "id" | "enqueuedAt"> = {
    kind: commentInput.kind,
    file: commentInput.file,
    body: commentInput.body,
    commitSha,
    supersedes:
      typeof commentInput.supersedes === "string"
        ? commentInput.supersedes
        : null,
  };
  if (typeof commentInput.lines === "string" && commentInput.lines.length > 0) {
    comment.lines = commentInput.lines;
  }
  if (parentAgentCommentId !== undefined) {
    comment.parentAgentCommentId = parentAgentCommentId;
  }
  const [id] = agentQueue.enqueue(wtPath, [comment]);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id }));
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
  const resolved = agentQueue.pullAndAck(wtPath);
  // Use the earliest-sent comment's sha; in the common case all comments in
  // one pull share a sha anyway.
  const earliest = resolved.reduce<Comment | undefined>(
    (acc, c) => (!acc || c.enqueuedAt < acc.enqueuedAt ? c : acc),
    undefined,
  );
  const commitSha = earliest?.commitSha ?? "";
  // Provide an agent-comment lookup so reply-to-agent-comment entries can
  // inline the parent's body as <parent>...</parent> for the agent.
  const agentComments = agentQueue.listAgentComments(wtPath);
  const lookupAgentComment = (id: string) =>
    agentComments.find((c) => c.id === id) ?? null;
  const payload = agentQueue.formatPayload(
    resolved,
    commitSha,
    lookupAgentComment,
  );
  const ids = resolved.map((c) => c.id);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ payload, ids }));
}

async function handleAgentDelivered(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  // Read the URL-encoded `path` query param off req.url. Use a dummy base
  // since req.url is path+query only.
  const url = new URL(req.url ?? "", "http://localhost");
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

async function handleAgentPostComment(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: {
    worktreePath?: unknown;
    body?: unknown;
    parent?: unknown;
    anchor?: unknown;
    agentLabel?: unknown;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  // Validate in the same order as `handleAgentEnqueue`: shape-level
  // (worktreePath + discriminator) first, then field-level (body), then
  // worktree filesystem check.
  const wtPath =
    typeof parsed.worktreePath === "string" ? parsed.worktreePath : "";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { worktreePath: string, body: string, (parent: { commentId, outcome } | anchor: { file, lines }) }",
      }),
    );
    return;
  }
  const hasParent = parsed.parent !== undefined && parsed.parent !== null;
  const hasAnchor = parsed.anchor !== undefined && parsed.anchor !== null;
  if (hasParent === hasAnchor) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: hasParent
          ? "exactly one of `parent` and `anchor` may be set"
          : "exactly one of `parent` and `anchor` must be set",
      }),
    );
    return;
  }
  const commentBody = typeof parsed.body === "string" ? parsed.body : "";
  if (commentBody.length === 0) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "body must be a non-empty string" }));
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
  if (
    typeof parsed.agentLabel === "string" &&
    parsed.agentLabel.length > MAX_AGENT_LABEL_LENGTH
  ) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `agentLabel must be at most ${MAX_AGENT_LABEL_LENGTH} characters`,
      }),
    );
    return;
  }
  const agentLabel =
    typeof parsed.agentLabel === "string" && parsed.agentLabel.length > 0
      ? parsed.agentLabel
      : undefined;

  if (hasParent) {
    const parent = parsed.parent as { commentId?: unknown; outcome?: unknown };
    const commentId =
      typeof parent.commentId === "string" ? parent.commentId : "";
    if (!commentId) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "parent.commentId must be a non-empty string" }),
      );
      return;
    }
    if (!isOutcome(parent.outcome)) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid parent.outcome" }));
      return;
    }
    // Reject replies whose commentId never appeared in this worktree's
    // delivered list — an agent posting against a fabricated id is either
    // confused or talking past us; either way it would silently create an
    // orphan that the UI merge step drops.
    if (!agentQueue.isDeliveredCommentId(wtPath, commentId)) {
      writeCorsHeaders(res, origin);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `parent.commentId ${JSON.stringify(commentId)} is not a delivered comment for this worktree`,
        }),
      );
      return;
    }
    const id = agentQueue.postAgentComment(wtPath, {
      parent: { commentId, outcome: parent.outcome },
      body: commentBody,
      agentLabel,
    });
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id }));
    return;
  }

  // hasAnchor === true
  const anchor = parsed.anchor as { file?: unknown; lines?: unknown };
  const file = typeof anchor.file === "string" ? anchor.file : "";
  const lines = typeof anchor.lines === "string" ? anchor.lines : "";
  if (!file) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "anchor.file must be a non-empty string" }));
    return;
  }
  if (!lines) {
    // File-level top-level comments are disallowed in v0 — see
    // docs/sdd/agent-comments/spec.md § Out of Scope.
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "anchor.lines must be a non-empty string (file-level agent comments are not supported)",
      }),
    );
    return;
  }
  if (!LINES_PATTERN.test(lines)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "anchor.lines must be a single line number (\"42\") or a range (\"40-58\")",
      }),
    );
    return;
  }
  const id = agentQueue.postAgentComment(wtPath, {
    anchor: { file, lines },
    body: commentBody,
    agentLabel,
  });
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id }));
}

async function handleAgentListComments(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const url = new URL(req.url ?? "", "http://localhost");
  const wtPath = url.searchParams.get("worktreePath") ?? "";
  if (!wtPath) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected ?worktreePath=<worktreePath>" }));
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
  const comments = agentQueue.listAgentComments(wtPath);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ comments }));
}

async function handleAgentUnenqueue(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { worktreePath?: unknown; id?: unknown };
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
  const id = typeof parsed.id === "string" ? parsed.id : "";
  if (!wtPath || !id) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "expected { worktreePath: string, id: string }" }),
    );
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
  const unenqueued = agentQueue.unenqueue(wtPath, id);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ unenqueued }));
}

// Cap the bytes any single request body can grow to. Local server, but we
// share the box with anything else on 127.0.0.1, and an agent / browser tab
// spamming multi-MB POSTs would trivially OOM us otherwise. 1 MiB is a
// loose upper bound on legitimate review-comment / reply prose.
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

function main() {
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "[server] ANTHROPIC_API_KEY is set in the environment but is no longer used; configure via the Settings panel.",
    );
  }
  const server = createApp();
  server.listen(PORT, HOST, () => {
    const allowed = ALLOWED_ORIGINS.size > 0 ? [...ALLOWED_ORIGINS].join(", ") : "(none)";
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] allowed browser origins: ${allowed}`);
    // Advertise our port to sibling processes (today: the MCP server, which
    // has no IPC channel back to the Tauri host and otherwise can't find the
    // ephemeral port the sidecar binds to).
    void writePortFile(PORT);
  });

  // Best-effort cleanup. Stale files are tolerated by the MCP side (it
  // health-checks before trusting the port), but removing on graceful exit
  // keeps the file from accumulating bogus state on dev boxes that bounce
  // the sidecar frequently.
  const cleanup = () => {
    void removePortFile();
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

// Only run main when executed directly (not when imported by tests).
const isEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");
if (isEntry) {
  main();
}
