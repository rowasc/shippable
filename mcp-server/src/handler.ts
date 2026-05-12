import { discoverSidecarPort } from "./port-discovery.js";

export const DEFAULT_PORT = 3001;

// Appended to the `shippable_check_review_comments` response when the server
// returns at least one pending comment. Lives in the tool result (not the
// tool description) because descriptions fade from a model's working focus
// after a tool call; the response text does not. Suppressed on the empty
// branch so we don't train the agent to ignore it. See
// docs/sdd/auto-reply-hint/spec.md.
export const NEXT_STEP_HINT =
  "Next step: call `shippable_post_review_comment` once per comment above. " +
  "Pass the comment's `id` attribute as `parentId`, your prose as `replyText`, " +
  "and set `outcome` to `addressed` (you fixed it), `declined` (you intentionally " +
  "won't), or `noted` (you saw it, no action). The user can also trigger this " +
  "explicitly with the phrase \"report back to shippable\".";

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
    ? `${body.payload}\n\n${NEXT_STEP_HINT}`
    : "No pending comments.";
  return {
    content: [{ type: "text", text }],
  };
}

export type Outcome = "addressed" | "declined" | "noted";

/**
 * Input to the unified `shippable_post_review_comment` tool. Discriminated by
 * which fields are present:
 *
 *   - reply form: `parentId` + `outcome` (threads under an existing reviewer comment)
 *   - top-level form: `file` + `lines` (a fresh comment anchored to the diff)
 *
 * The `replyText` field carries the prose for both forms. It's named
 * `replyText` rather than `body` because some model serializers conflate
 * `body` with the HTML element and emit `</body>` close tags into the value
 * — see the reply-flow notes in `docs/sdd/agent-reply-support/spec.md`.
 */
export type PostReviewCommentInput =
  | {
      worktreePath?: string;
      parentId: string;
      replyText: string;
      outcome: Outcome;
    }
  | {
      worktreePath?: string;
      file: string;
      lines: string;
      replyText: string;
    };

interface PostCommentResponse {
  id: string;
}

export async function handlePostReviewComment(
  input: PostReviewCommentInput,
  deps?: HandlerDeps,
): Promise<ToolResult> {
  const port = await resolvePort(deps);
  const worktreePath = resolveWorktreePath(input, deps);
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/api/agent/comments`;
  const fetchFn = deps?.fetchFn ?? fetch;

  // Wire-level field on the local server endpoint stays `body` — the
  // `replyText` rename is contained to the MCP tool's input schema.
  const wireBody =
    "parentId" in input
      ? {
          worktreePath,
          parent: { commentId: input.parentId, outcome: input.outcome },
          body: input.replyText,
        }
      : {
          worktreePath,
          anchor: { file: input.file, lines: input.lines },
          body: input.replyText,
        };

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wireBody),
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

  let parsed: PostCommentResponse;
  try {
    parsed = (await response.json()) as PostCommentResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: invalid JSON response (${message})`,
    );
  }

  const text =
    "parentId" in input
      ? `Posted reply ${parsed.id} for comment ${input.parentId}.`
      : `Posted agent comment ${parsed.id} for ${input.file}:${input.lines}.`;
  return {
    content: [{ type: "text", text }],
  };
}
