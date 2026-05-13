export const DEFAULT_PORT = 3001;

export interface HandlerDeps {
  fetchFn?: typeof fetch;
  port?: number;
  cwd?: () => string;
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

function resolvePort(deps?: HandlerDeps): number {
  if (deps?.port !== undefined) return deps.port;
  const envPort = process.env.SHIPPABLE_PORT;
  if (envPort !== undefined && envPort !== "") {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed)) return parsed;
  }
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
  const port = resolvePort(deps);
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

export type AgentResponseIntent = "ack" | "accept" | "reject";
export type AskIntent = "comment" | "question" | "request" | "blocker";
export type AgentIntent = AgentResponseIntent | AskIntent;

interface PostInteractionInput {
  worktreePath?: string;
  /** Reply mode: the id of the interaction this entry answers. */
  parentId?: string;
  /** Top-level mode: 'line' for a single line, 'block' for a range. */
  target?: "line" | "block";
  /** Top-level mode: repo-relative file path. */
  file?: string;
  /** Top-level mode: the line number or inclusive range, e.g. "118" or "72-79". */
  lines?: string;
  body: string;
  intent: AgentIntent;
}

interface PostInteractionResponse {
  id: string;
}

const ASK_INTENTS: readonly AskIntent[] = [
  "comment",
  "question",
  "request",
  "blocker",
];
const RESPONSE_INTENTS: readonly AgentResponseIntent[] = [
  "ack",
  "accept",
  "reject",
];

function isAskIntent(value: unknown): value is AskIntent {
  return (
    typeof value === "string" && ASK_INTENTS.includes(value as AskIntent)
  );
}

function isResponseIntent(value: unknown): value is AgentResponseIntent {
  return (
    typeof value === "string" &&
    RESPONSE_INTENTS.includes(value as AgentResponseIntent)
  );
}

export async function handlePostReviewInteraction(
  input: PostInteractionInput,
  deps?: HandlerDeps,
): Promise<ToolResult> {
  const port = resolvePort(deps);
  const worktreePath = resolveWorktreePath(input, deps);
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/api/agent/replies`;
  const fetchFn = deps?.fetchFn ?? fetch;

  const hasParent =
    typeof input.parentId === "string" && input.parentId.length > 0;
  const hasAnchor =
    typeof input.target === "string" &&
    typeof input.file === "string" &&
    input.file.length > 0 &&
    typeof input.lines === "string" &&
    input.lines.length > 0;
  if (hasParent === hasAnchor) {
    return errorResult(
      "Either parentId (reply mode) or target+file+lines (top-level mode) must be set — never both.",
    );
  }
  if (hasParent && !isResponseIntent(input.intent)) {
    return errorResult(
      "Reply intent must be one of: ack, accept, reject.",
    );
  }
  if (!hasParent && !isAskIntent(input.intent)) {
    return errorResult(
      "Top-level intent must be one of: comment, question, request, blocker.",
    );
  }

  const payload: Record<string, unknown> = {
    worktreePath,
    body: input.body,
    intent: input.intent,
  };
  if (hasParent) {
    payload.parentId = input.parentId;
  } else {
    payload.target = input.target;
    payload.file = input.file;
    payload.lines = input.lines;
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

  let parsed: PostInteractionResponse;
  try {
    parsed = (await response.json()) as PostInteractionResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Error contacting Shippable server at ${baseUrl}: invalid JSON response (${message})`,
    );
  }

  const summary = hasParent
    ? `Posted reply ${parsed.id} for interaction ${input.parentId}.`
    : `Posted ${input.intent} ${parsed.id} on ${input.file}:${input.lines}.`;
  return {
    content: [{ type: "text", text: summary }],
  };
}
