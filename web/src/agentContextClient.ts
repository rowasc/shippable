// Thin client over the agent-context endpoints. See server/src/agent-context.ts
// and docs/concepts/agent-context.md for the design.

import { apiUrl } from "./apiUrl";
import type {
  AgentContextSlice,
  AgentSessionRef,
  DeliveredComment,
  DraftComment,
} from "./types";

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

export interface HookStatus {
  installed: boolean;
  partial: boolean;
  missing: string[];
}

export async function fetchHookStatus(): Promise<HookStatus> {
  const res = await fetch(await apiUrl("/api/worktrees/hook-status"));
  const json = (await res.json()) as HookStatus | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export interface InstallHookResult {
  installed: true;
  hookPath: string;
  settingsPath: string;
  didModify: boolean;
  backupPath: string | null;
}

export async function installHook(): Promise<InstallHookResult> {
  const res = await fetch(await apiUrl("/api/worktrees/install-hook"), {
    method: "POST",
  });
  const json = (await res.json()) as InstallHookResult | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchInboxStatus(
  worktreePath: string,
): Promise<{ exists: boolean; mtime: string | null }> {
  const res = await fetch(await apiUrl("/api/worktrees/inbox-status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: worktreePath }),
  });
  const json = (await res.json()) as
    | { exists: boolean; mtime: string | null }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

export async function sendInboxMessage(args: {
  worktreePath: string;
  message: string;
}): Promise<{ inboxPath: string; excludeWritten: boolean }> {
  const res = await fetch(await apiUrl("/api/worktrees/inbox"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: args.worktreePath,
      message: args.message,
    }),
  });
  const json = (await res.json()) as
    | { inboxPath: string; excludeWritten: boolean }
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

/**
 * Enqueue a batch of reviewer comments for an agent running in `worktreePath`.
 * The server stores them in-memory until the next hook invocation pulls them.
 * Returns the assigned ids in the same order as the input — callers pair
 * them with the local Reply records so a later `fetchDelivered` response
 * can flip the matching pip from `◌ queued` → `✓ delivered`.
 */
export async function enqueueComments(args: {
  worktreePath: string;
  commitSha: string;
  comments: DraftComment[];
}): Promise<{ enqueued: number; ids: string[] }> {
  const res = await fetch(await apiUrl("/api/agent/enqueue"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worktreePath: args.worktreePath,
      commitSha: args.commitSha,
      comments: args.comments,
    }),
  });
  const json = (await res.json()) as
    | { enqueued: number; ids: string[] }
    | { error: string };
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json;
}

/**
 * Read the per-worktree delivered comment list. The server returns newest
 * first and caps history at 200 entries (older deliveries fall off). The
 * UI uses the returned ids to set a `Set<string>` for pip rendering;
 * delivered metadata isn't persisted — re-fetch on remount.
 */
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
