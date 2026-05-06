import { useEffect, useState } from "react";
import { parseDiff } from "./parseDiff";
import { apiUrl } from "./apiUrl";
import type { ChangeSet, CodeGraph } from "./types";
import type { RecentSource } from "./recents";

const WORKTREES_DIR_KEY = "shippable.worktreesDir";

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

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

interface Props {
  onLoad: (cs: ChangeSet, source: RecentSource) => void;
}

export function useWorktreeLoader({ onLoad }: Props) {
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wtDir, setWtDir] = useState(
    () => localStorage.getItem(WORKTREES_DIR_KEY) ?? "",
  );
  const [wtBusy, setWtBusy] = useState(false);
  const [wtPickerBusy, setWtPickerBusy] = useState(false);
  const [wtList, setWtList] = useState<Worktree[] | null>(null);
  const [wtLoadingPath, setWtLoadingPath] = useState<string | null>(null);
  const [showManualPath, setShowManualPath] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(await apiUrl("/api/health"));
        if (!cancelled) setServerAvailable(res.ok);
      } catch {
        if (!cancelled) setServerAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function scanWorktrees(dirOverride?: string) {
    const dir = (dirOverride ?? wtDir).trim();
    if (!dir) return;
    setErr(null);
    setWtBusy(true);
    setWtList(null);
    try {
      const res = await fetch(await apiUrl("/api/worktrees/list"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as { worktrees: Worktree[] } | ErrorResponse;
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      }
      localStorage.setItem(WORKTREES_DIR_KEY, dir);
      setWtDir(dir);
      setWtList(json.worktrees);
      if (json.worktrees.length === 0) {
        setErr(`No worktrees found in ${dir}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(`Scan failed: ${msg}`);
    } finally {
      setWtBusy(false);
    }
  }

  async function pickDirectory() {
    setErr(null);
    setWtPickerBusy(true);
    try {
      const res = await fetch(await apiUrl("/api/worktrees/pick-directory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startPath: wtDir.trim() || undefined }),
      });
      const json = (await res.json()) as
        | { path: string }
        | { cancelled: true }
        | ErrorResponse;
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      }
      if ("cancelled" in json) return;
      setShowManualPath(false);
      await scanWorktrees(json.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setShowManualPath(true);
      setErr(`Choose folder failed: ${msg}`);
    } finally {
      setWtPickerBusy(false);
    }
  }

  async function loadFromWorktree(wt: Worktree) {
    setErr(null);
    setWtLoadingPath(wt.path);
    try {
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
      } catch (graphErr) {
        console.warn("[useWorktreeLoader] repo graph failed, staying diff-scoped:", graphErr);
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
        setErr("Latest commit produced no parseable diff (empty or merge?).");
        return;
      }
      cs.worktreeSource = {
        worktreePath: wt.path,
        commitSha: json.sha,
        branch: wt.branch ?? null,
      };
      onLoad(cs, { kind: "worktree", path: wt.path, branch: wt.branch });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(`Load failed: ${msg}`);
    } finally {
      setWtLoadingPath(null);
    }
  }

  return {
    err,
    loadFromWorktree,
    pickDirectory,
    scanWorktrees,
    serverAvailable,
    setShowManualPath,
    setWtDir,
    showManualPath,
    wtBusy,
    wtDir,
    wtList,
    wtLoadingPath,
    wtPickerBusy,
  };
}
