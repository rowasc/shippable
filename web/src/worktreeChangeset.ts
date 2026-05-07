import { apiUrl } from "./apiUrl";
import { fetchDiffCodeGraph } from "./codeGraphClient";
import { parseDiff } from "./parseDiff";
import type { ChangeSet, WorktreeState } from "./types";

interface WorktreeChangesetResponse {
  diff: string;
  sha: string;
  subject: string;
  author: string;
  date: string;
  branch: string | null;
  fileContents?: Record<string, string>;
  state?: WorktreeState;
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

  const cs = parseDiff(json.diff, {
    id: `wt-${json.sha.slice(0, 12)}`,
    title:
      json.subject || `${wt.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
    author: json.author,
    head: json.branch ?? json.sha.slice(0, 7),
    fileContents: json.fileContents,
  });
  if (cs.files.length === 0) {
    throw new Error("Latest commit produced no parseable diff (empty or merge?).");
  }
  // Upgrade the regex-derived graph to the LSP graph when available. Falls
  // through silently — the regex one is already on cs.graph.
  const lspGraph = await fetchDiffCodeGraph(wt.path, json.sha, cs.files);
  if (lspGraph) cs.graph = lspGraph;
  cs.worktreeSource = {
    worktreePath: wt.path,
    commitSha: json.sha,
    branch: wt.branch ?? null,
    state: json.state,
  };
  return cs;
}
