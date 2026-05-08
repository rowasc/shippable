import { postJson } from "./apiClient";
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
  parentSha?: string | null;
  fileContents?: Record<string, string>;
  state?: WorktreeState;
}

/**
 * Thrown when the server returns a valid changeset but the diff is empty —
 * branch at parity with its base, an explicitly picked merge commit, a clean
 * working tree, etc. Distinct from parse failures so callers can surface a
 * soft "no changes here, pick a different range" UI instead of a hard error.
 */
export class EmptyDiffError extends Error {
  readonly summary: string;
  constructor(summary: string) {
    super(summary);
    this.name = "EmptyDiffError";
    this.summary = summary;
  }
}

function summariseEmpty(
  opts: LoadOpts | undefined,
  branch: string | null,
  parentSha: string | null | undefined,
): string {
  if (opts?.kind === "range") {
    const from = opts.fromRef.length > 7 ? opts.fromRef.slice(0, 7) : opts.fromRef;
    const to = opts.toRef.length > 7 ? opts.toRef.slice(0, 7) : opts.toRef;
    return `No changes between ${from} and ${to}.`;
  }
  if (opts?.kind === "ref") {
    const r = opts.ref.length > 7 ? opts.ref.slice(0, 7) : opts.ref;
    return `No changes in commit ${r} (empty commit or merge?).`;
  }
  if (opts?.kind === "dirty") {
    return "No uncommitted changes.";
  }
  // Default branch view.
  const branchLabel = branch ?? "this branch";
  if (parentSha === "working tree") {
    return `No uncommitted changes on ${branchLabel}.`;
  }
  if (parentSha) {
    return `No new changes on ${branchLabel} since base ${parentSha}.`;
  }
  return `No changes on ${branchLabel} (no base detected).`;
}

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
  const { commits } = await postJson<{ commits: CommitInfo[] }>(
    "/api/worktrees/commits",
    { path: worktreePath, ...(limit ? { limit } : {}) },
  );
  return commits;
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

  const json = await postJson<WorktreeChangesetResponse>(
    "/api/worktrees/changeset",
    body,
  );

  // Range loads use a deterministic id so two reviews of the same slice land
  // on the same ChangeSet identity (matters for ReviewState persistence).
  // The "to" portion uses the resolved sha so a `toRef === "HEAD"` pick produces
  // `wt-range-<from>-<sha>` instead of the literal string `wt-range-<from>-HEAD`.
  const id =
    opts?.kind === "range"
      ? `wt-range-${opts.fromRef.slice(0, 7)}-${json.sha.slice(0, 7)}${opts.includeDirty ? "-d" : ""}`
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
    throw new EmptyDiffError(summariseEmpty(opts, json.branch, json.parentSha));
  }
  const lspGraph = await fetchDiffCodeGraph(wt.path, json.sha, cs.files);
  if (lspGraph) cs.graph = lspGraph;
  // The server stamps `dirty:<hash>` on json.sha when the loaded view contains
  // uncommitted edits — applies to `kind: "dirty"` and to range picks with
  // `includeDirty` against HEAD when the tree is actually dirty. Comments
  // authored against this view need `originType: "dirty"`, which keys off this.
  const isDirtyView = json.sha.startsWith("dirty:");
  cs.worktreeSource = {
    worktreePath: wt.path,
    commitSha: json.sha,
    branch: wt.branch ?? null,
    state: json.state,
    ...(isDirtyView ? { dirty: true } : {}),
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
