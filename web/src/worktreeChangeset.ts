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

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
}

export async function fetchWorktreeCommits(
  worktreePath: string,
  limit?: number,
): Promise<CommitInfo[]> {
  const res = await fetch(await apiUrl("/api/worktrees/commits"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: worktreePath, ...(limit ? { limit } : {}) }),
  });
  const json = (await res.json()) as { commits: CommitInfo[] } | ErrorResponse;
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.commits;
}

export type LoadOpts =
  | { kind: "range"; fromRef: string; toRef: string; includeDirty: boolean }
  | { kind: "ref"; ref: string }
  | { kind: "dirty" };

/**
 * Fetch a changeset for a worktree and parse it.
 *
 * `opts` selects the slice: range, single commit, dirty-only, or (when
 * omitted) the cumulative branch view that LoadModal defaults to. Returns
 * a ChangeSet stamped with `worktreeSource`, or throws with a human-readable
 * message on failure.
 *
 * Slice (a) of the live-reload plan replaced the manual button with
 * polling; this helper stays — the polling code calls it once the banner
 * is dismissed.
 */
export async function fetchWorktreeChangeset(
  wt: { path: string; branch: string | null },
  opts?: LoadOpts,
): Promise<ChangeSet> {
  const body: Record<string, unknown> = { path: wt.path };
  if (opts?.kind === "range") {
    body.fromRef = opts.fromRef;
    body.toRef = opts.toRef;
    body.includeDirty = opts.includeDirty;
  } else if (opts?.kind === "ref") {
    body.ref = opts.ref;
  } else if (opts?.kind === "dirty") {
    body.dirty = true;
  }

  const res = await fetch(await apiUrl("/api/worktrees/changeset"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as WorktreeChangesetResponse | ErrorResponse;
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }

  // Range loads use a deterministic id so two reviews of the same slice land
  // on the same ChangeSet identity (matters for ReviewState persistence).
  const id =
    opts?.kind === "range"
      ? `wt-range-${opts.fromRef.slice(0, 7)}-${opts.toRef.slice(0, 7)}${opts.includeDirty ? "-d" : ""}`
      : `wt-${json.sha.slice(0, 12)}`;

  const cs = parseDiff(json.diff, {
    id,
    title:
      json.subject || `${wt.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
    author: json.author,
    head: json.branch ?? json.sha.slice(0, 7),
    fileContents: json.fileContents,
  });
  if (cs.files.length === 0) {
    throw new Error("Latest commit produced no parseable diff (empty or merge?).");
  }
  const lspGraph = await fetchDiffCodeGraph(wt.path, json.sha, cs.files);
  if (lspGraph) cs.graph = lspGraph;
  cs.worktreeSource = {
    worktreePath: wt.path,
    commitSha: json.sha,
    branch: wt.branch ?? null,
    state: json.state,
    ...(opts?.kind === "range"
      ? {
          range: {
            fromRef: opts.fromRef,
            toRef: opts.toRef,
            includeDirty: opts.includeDirty,
          },
        }
      : {}),
  };
  return cs;
}
