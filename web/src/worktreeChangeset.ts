import { apiUrl } from "./apiUrl";
import { parseDiff } from "./parseDiff";
import type { ChangeSet, CodeGraph } from "./types";

interface WorktreeChangesetResponse {
  diff: string;
  sha: string;
  subject: string;
  author: string;
  date: string;
  branch: string | null;
  fileContents?: Record<string, string>;
}

interface WorktreeGraphResponse {
  graph: CodeGraph;
}

type ErrorResponse = { error: string };

/**
 * Fetch the latest changeset for a worktree and parse it.
 *
 * Used by both the initial load (`useWorktreeLoader`) and the debug "reload
 * now" button. Returns a ChangeSet stamped with `worktreeSource`, or throws
 * an Error with a human-readable message on failure.
 *
 * Slice (a) of the live-reload plan will replace the manual button with
 * polling, but this helper stays — the polling code calls it once the
 * banner is dismissed.
 */
export async function fetchWorktreeChangeset(wt: {
  path: string;
  branch: string | null;
}): Promise<ChangeSet> {
  const res = await fetch(await apiUrl("/api/worktrees/changeset"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: wt.path }),
  });
  const json = (await res.json()) as WorktreeChangesetResponse | ErrorResponse;
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }

  let graph: CodeGraph | undefined;
  try {
    const graphRes = await fetch(await apiUrl("/api/worktrees/graph"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: wt.path }),
    });
    const graphJson = (await graphRes.json()) as WorktreeGraphResponse | ErrorResponse;
    if (graphRes.ok && !("error" in graphJson)) {
      graph = graphJson.graph;
    }
  } catch {
    // Graph is best-effort — a failed fetch leaves the diff scope intact.
  }

  const cs = parseDiff(json.diff, {
    id: `wt-${json.sha.slice(0, 12)}`,
    title:
      json.subject || `${wt.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
    author: json.author,
    head: json.branch ?? json.sha.slice(0, 7),
    fileContents: json.fileContents,
    graph,
  });
  if (cs.files.length === 0) {
    throw new Error("Latest commit produced no parseable diff (empty or merge?).");
  }
  cs.worktreeSource = {
    worktreePath: wt.path,
    commitSha: json.sha,
    branch: wt.branch ?? null,
  };
  return cs;
}
