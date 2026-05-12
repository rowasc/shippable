import { discoverSidecarPort } from "./port-discovery.js";

export const DEFAULT_PORT = 3001;

export interface HandlerDeps {
  fetchFn?: typeof fetch;
  port?: number;
  cwd?: () => string;
  /**
   * Discovery override. The default reads the sidecar's port file and
   * health-checks it. Tests stub this to bypass the filesystem.
   */
  discoverPort?: () => Promise<number | null>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [x: string]: unknown;
}

interface PullResponse {
  payload: string;
  ids: string[];
}

// Resolution order:
//   1. `deps.port` — explicit test override.
//   2. `SHIPPABLE_PORT` env — explicit user/dev override.
//   3. Sidecar port-file discovery (verified via /api/health).
//   4. `DEFAULT_PORT` (3001) — the dev-server default.
//
// Discovery sits below the env var so devs can still pin the MCP at a
// specific port (e.g. when running two sidecars side-by-side); it sits above
// the default so the Tauri-spawned sidecar — which uses an ephemeral port
// and never has `SHIPPABLE_PORT` set — is found automatically.
async function resolvePort(deps?: HandlerDeps): Promise<number> {
  if (deps?.port !== undefined) return deps.port;
  const envPort = process.env.SHIPPABLE_PORT;
  if (envPort !== undefined && envPort !== "") {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed)) return parsed;
  }
  const discover = deps?.discoverPort ?? (() => discoverSidecarPort({ fetchFn: deps?.fetchFn }));
  const discovered = await discover();
  if (discovered !== null) return discovered;
  return DEFAULT_PORT;
}

function resolveWorktreePath(
  input: { worktreePath?: string },
  deps?: HandlerDeps,
): string {
  if (input.worktreePath !== undefined && input.worktreePath !== "") {
    return input.worktreePath;
  }
  if (deps?.cwd) return deps.cwd();
  return process.cwd();
}

function errorResult(text: string): ToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

export async function handleCheckReviewComments(
  input: { worktreePath?: string },
  deps?: HandlerDeps,
): Promise<ToolResult> {
  const port = await resolvePort(deps);
  const worktreePath = resolveWorktreePath(input, deps);
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/api/agent/pull`;
  const fetchFn = deps?.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreePath }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: ${message}`,
    );
  }

  if (!response.ok) {
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: HTTP ${response.status}`,
    );
  }

  let body: PullResponse;
  try {
    body = (await response.json()) as PullResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: invalid JSON response (${message})`,
    );
  }

  const text = typeof body.payload === "string" && body.payload.length > 0
    ? body.payload
    : "No pending comments.";
  return {
    content: [{ type: "text", text }],
  };
}

export type Outcome = "addressed" | "declined" | "noted";

interface PostReplyInput {
  worktreePath?: string;
  commentId: string;
  /**
   * Free-form prose for the reply. Named `replyText` rather than `body`
   * because some model serializers conflate `body` with the HTML element
   * and emit `</body>` close tags into the value — see the reply-flow
   * notes in `docs/sdd/agent-reply-support/spec.md`.
   */
  replyText: string;
  outcome: Outcome;
}

interface PostReplyResponse {
  id: string;
}

export async function handlePostReviewReply(
  input: PostReplyInput,
  deps?: HandlerDeps,
): Promise<ToolResult> {
  const port = await resolvePort(deps);
  const worktreePath = resolveWorktreePath(input, deps);
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/api/agent/replies`;
  const fetchFn = deps?.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktreePath,
        commentId: input.commentId,
        // Wire-level field on the local server endpoint stays `body` —
        // the rename is contained to the MCP tool's input schema.
        body: input.replyText,
        outcome: input.outcome,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: ${message}`,
    );
  }

  if (!response.ok) {
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: HTTP ${response.status}`,
    );
  }

  let parsed: PostReplyResponse;
  try {
    parsed = (await response.json()) as PostReplyResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: invalid JSON response (${message})`,
    );
  }

  return {
    content: [
      { type: "text", text: `Posted reply ${parsed.id} for comment ${input.commentId}.` },
    ],
  };
}
