import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { getDefinitionCapabilities, resolveDefinition } from "./definitions.ts";
import { generatePlan } from "./plan.ts";
import * as library from "./library.ts";
import * as prompts from "./prompts.ts";
import { streamReview } from "./review.ts";
import * as worktrees from "./worktrees.ts";
import * as agentContext from "./agent-context.ts";
import * as mcpStatus from "./mcp-status.ts";
import * as agentQueue from "./agent-queue.ts";
import type { Comment, CommentKind } from "./agent-queue.ts";
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
    if (req.method === "POST" && req.url === "/api/agent/replies") {
      return await handleAgentPostReply(req, res, origin);
    }
    if (
      req.method === "GET" &&
      req.url &&
      req.url.startsWith("/api/agent/replies")
    ) {
      return await handleAgentListReplies(req, res, origin);
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
  if (!process.env.ANTHROPIC_API_KEY) {
    writeCorsHeaders(res, origin);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set on the server" }));
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
  if (!process.env.ANTHROPIC_API_KEY) {
    writeCorsHeaders(res, origin);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set on the server" }));
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
];

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
  const payload = agentQueue.formatPayload(resolved, commitSha);
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

async function handleAgentPostReply(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: {
    worktreePath?: unknown;
    commentId?: unknown;
    body?: unknown;
    outcome?: unknown;
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
  const wtPath =
    typeof parsed.worktreePath === "string" ? parsed.worktreePath : "";
  const commentId =
    typeof parsed.commentId === "string" ? parsed.commentId : "";
  const replyBody = typeof parsed.body === "string" ? parsed.body : "";
  if (!wtPath || !commentId || replyBody.length === 0) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "expected { worktreePath: string, commentId: string, body: string, outcome: 'addressed' | 'declined' | 'noted' }",
      }),
    );
    return;
  }
  if (!isOutcome(parsed.outcome)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid outcome" }));
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
  // Reject replies whose commentId never appeared in this worktree's
  // delivered list — an agent posting against a fabricated id is either
  // confused or talking past us; either way it would silently create an
  // orphan that the UI merge step drops.
  if (!agentQueue.isDeliveredCommentId(wtPath, commentId)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `commentId ${JSON.stringify(commentId)} is not a delivered comment for this worktree`,
      }),
    );
    return;
  }
  const id = agentQueue.postReply(wtPath, {
    commentId,
    body: replyBody,
    outcome: parsed.outcome,
    agentLabel:
      typeof parsed.agentLabel === "string" && parsed.agentLabel.length > 0
        ? parsed.agentLabel
        : undefined,
  });
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id }));
}

async function handleAgentListReplies(
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
  const replies = agentQueue.listReplies(wtPath);
  writeCorsHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ replies }));
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
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer) => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        // Stop accumulating but let the body finish streaming so the
        // request/response lifecycle stays in lockstep — fetch clients
        // may not read our response until they've finished writing the
        // body. Rejecting here would also work but sometimes lets the
        // outer catch write 413 before the socket is ready, which some
        // clients see as a connection reset.
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) {
        reject(new RequestBodyTooLargeError(MAX_REQUEST_BODY_BYTES));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
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

function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[server] ANTHROPIC_API_KEY is not set in the environment. See README — recommended path on macOS is `export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)` before `npm run dev`.",
    );
    process.exit(1);
  }
  const server = createApp();
  server.listen(PORT, HOST, () => {
    const allowed = ALLOWED_ORIGINS.size > 0 ? [...ALLOWED_ORIGINS].join(", ") : "(none)";
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] allowed browser origins: ${allowed}`);
  });
}

// Only run main when executed directly (not when imported by tests).
const isEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");
if (isEntry) {
  main();
}
