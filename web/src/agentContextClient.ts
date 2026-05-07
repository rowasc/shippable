// Thin client over the agent-context endpoints. See server/src/agent-context.ts
// and docs/concepts/agent-context.md for the design.

import { apiUrl } from "./apiUrl";
import type {
  AgentContextSlice,
  AgentSessionRef,
  CommentKind,
  DeliveredComment,
} from "./types";
import type { PolledAgentReply } from "./state";

export async function listSessionsForWorktree(
  worktreePath: string,
): Promise<AgentSessionRef[]> {
  const res = await fetch(await apiUrl("/api/worktrees/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: worktreePath }),
  });
  const json = (await res.json()) as
    | { sessions: AgentSessionRef[] }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.sessions;
}

export async function fetchMcpStatus(): Promise<{
  installed: boolean;
  /**
   * The `claude mcp add …` command the panel chip should display + copy.
   * Authoritative — comes from the server's path resolver so the chip
   * surfaces a working command even before `@shippable/mcp-server` lands
   * on npm. See `resolveInstallCommand` in `server/src/mcp-status.ts`.
   */
  installCommand: string;
}> {
  const res = await fetch(await apiUrl("/api/worktrees/mcp-status"));
  const json = (await res.json()) as
    | { installed: boolean; installCommand: string }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchAgentContext(args: {
  worktreePath: string;
  sessionFilePath: string;
  commitSha?: string | null;
}): Promise<AgentContextSlice> {
  const res = await fetch(await apiUrl("/api/worktrees/agent-context"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: args.worktreePath,
      sessionFilePath: args.sessionFilePath,
      commitSha: args.commitSha ?? null,
    }),
  });
  const json = (await res.json()) as
    | { slice: AgentContextSlice }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.slice;
}

// ── Agent comment queue (slice 2) ────────────────────────────────────────
// Thin wrappers over /api/agent/{enqueue,unenqueue,delivered}. The pull
// endpoint is consumed by the MCP server (slice 3), not the web client.

export async function enqueueComment(args: {
  worktreePath: string;
  commitSha: string;
  comment: {
    kind: CommentKind;
    file: string;
    lines?: string;
    body: string;
    supersedes?: string | null;
  };
}): Promise<{ id: string }> {
  const res = await fetch(await apiUrl("/api/agent/enqueue"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worktreePath: args.worktreePath,
      commitSha: args.commitSha,
      comment: args.comment,
    }),
  });
  const json = (await res.json()) as { id: string } | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export async function unenqueueComment(args: {
  worktreePath: string;
  id: string;
}): Promise<{ unenqueued: boolean }> {
  const res = await fetch(await apiUrl("/api/agent/unenqueue"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worktreePath: args.worktreePath,
      id: args.id,
    }),
  });
  const json = (await res.json()) as
    | { unenqueued: boolean }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchDelivered(
  worktreePath: string,
): Promise<DeliveredComment[]> {
  const url = await apiUrl(
    `/api/agent/delivered?path=${encodeURIComponent(worktreePath)}`,
  );
  const res = await fetch(url);
  const json = (await res.json()) as
    | { delivered: DeliveredComment[] }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.delivered;
}

export async function fetchAgentReplies(
  worktreePath: string,
): Promise<PolledAgentReply[]> {
  const url = await apiUrl(
    `/api/agent/replies?worktreePath=${encodeURIComponent(worktreePath)}`,
  );
  const res = await fetch(url);
  const json = (await res.json()) as
    | { replies: PolledAgentReply[] }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.replies;
}

/**
 * Convenience: list sessions for a worktree, pick the most recent that
 * matches, fetch its slice for the given commit. Returns null when no
 * matching session exists. The session picker can override this default
 * by passing `pinnedSessionFilePath`.
 */
export async function fetchAgentContextForWorktree(args: {
  worktreePath: string;
  commitSha: string;
  pinnedSessionFilePath?: string | null;
}): Promise<{
  slice: AgentContextSlice;
  candidates: AgentSessionRef[];
} | null> {
  const candidates = await listSessionsForWorktree(args.worktreePath);
  if (candidates.length === 0) return null;
  const session =
    (args.pinnedSessionFilePath
      ? candidates.find((c) => c.filePath === args.pinnedSessionFilePath)
      : null) ?? candidates[0];
  const slice = await fetchAgentContext({
    worktreePath: args.worktreePath,
    sessionFilePath: session.filePath,
    commitSha: args.commitSha,
  });
  return { slice, candidates };
}
