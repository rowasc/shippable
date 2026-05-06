import { useEffect, useMemo, useReducer, useState } from "react";
import "./App.css";
import { findStub } from "./fixtures";
import { initialState, reducer } from "./state";
import { Welcome } from "./components/Welcome";
import { ReviewWorkspace } from "./components/ReviewWorkspace";
import { LiveReloadBar } from "./components/LiveReloadBar";
import type {
  ChangeSet,
  CodeGraph,
  Reply,
  WorktreeProvenance,
  WorktreeState,
} from "./types";
import {
  getLiveReloadEnabled,
  hasProgress,
  loadSession,
  peekSession,
  saveSession,
  setLiveReloadEnabled,
} from "./persist";
import {
  loadRecents,
  pushRecent,
  type RecentEntry,
  type RecentSource,
} from "./recents";
import { useTheme } from "./useTheme";
import { useWorktreeLiveReload } from "./useWorktreeLiveReload";
import { parseDiff } from "./parseDiff";
import { apiUrl } from "./apiUrl";

interface BootSeed {
  changesets: ChangeSet[];
  replies: Record<string, Reply[]>;
  /** Whether to overlay the persisted snapshot onto initialState. */
  applyPersisted: boolean;
  /** What put us here — used to upsert into recents on boot. Null = welcome. */
  source: RecentSource | null;
}

/**
 * Decide what to show on first paint. URL param wins, then a real
 * resumable session (persisted progress + a known changeset), otherwise
 * welcome.
 */
function resolveBoot(): BootSeed {
  const params = new URLSearchParams(window.location.search);
  const wanted = params.get("cs") ?? params.get("c");
  if (wanted) {
    const stub = findStub(wanted);
    if (stub) {
      return {
        changesets: [stub.changeset],
        replies: { ...stub.replies },
        applyPersisted: false,
        source: { kind: "stub", code: stub.code },
      };
    }
  }

  const peeked = peekSession();
  if (peeked && hasProgress(peeked)) {
    const csId = peeked.cursor.changesetId;
    const recent = loadRecents().find((r) => r.id === csId);
    if (recent) {
      return {
        changesets: [recent.changeset],
        replies: { ...recent.replies },
        applyPersisted: true,
        source: recent.source,
      };
    }
    const stub = findStub(csId);
    if (stub) {
      return {
        changesets: [stub.changeset],
        replies: { ...stub.replies },
        applyPersisted: true,
        source: { kind: "stub", code: stub.code },
      };
    }
  }

  return { changesets: [], replies: {}, applyPersisted: false, source: null };
}

export default function App() {
  const [themeId, setThemeId] = useTheme();
  const [boot] = useState<BootSeed>(() => resolveBoot());
  const [hydrated] = useState(() =>
    boot.applyPersisted
      ? loadSession(boot.changesets)
      : { state: null, drafts: {} as Record<string, string> },
  );
  const [state, dispatch] = useReducer(reducer, boot, (b) => {
    const initial = initialState(b.changesets, b.replies);
    const persisted = hydrated.state;
    if (!persisted) return initial;
    return {
      ...initial,
      cursor: persisted.cursor,
      readLines: persisted.readLines,
      reviewedFiles: persisted.reviewedFiles,
      dismissedGuides: persisted.dismissedGuides,
      ackedNotes: persisted.ackedNotes,
      replies: { ...initial.replies, ...persisted.replies },
      detachedReplies: persisted.detachedReplies,
    };
  });
  const [recents, setRecents] = useState<RecentEntry[]>(() => {
    // On boot with a resolved changeset, upsert it into recents — the
    // next welcome shows it at the top. For the welcome boot (no source)
    // just return the persisted list as-is.
    if (boot.source && boot.changesets.length > 0) {
      return pushRecent(boot.changesets[0], boot.replies, boot.source);
    }
    return loadRecents();
  });
  const [currentSource, setCurrentSource] = useState<RecentSource | null>(boot.source);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => hydrated.drafts,
  );

  // Debounced persist of state + drafts. The reducer guards against
  // non-LOAD actions when changesets is empty, so saving the welcome
  // sentinel state is harmless — it won't pass hasProgress() on next
  // boot and welcome will reappear.
  useEffect(() => {
    const t = window.setTimeout(() => saveSession(state, drafts), 300);
    return () => window.clearTimeout(t);
  }, [state, drafts]);

  function handleLoadChangeset(
    cs: ChangeSet,
    replies: Record<string, Reply[]>,
    source: RecentSource,
  ) {
    dispatch({ type: "LOAD_CHANGESET", changeset: cs, replies });
    setCurrentSource(source);
    setRecents(pushRecent(cs, replies, source));
  }

  // Reload-in-place. Replaces the changeset whose id is `prevChangesetId`
  // and runs the content-anchor pass over its replies. Used by the debug
  // "reload now" button today; slice (a) of the live-reload plan will
  // wire the polling banner to this same path.
  function handleReloadChangeset(
    prevChangesetId: string,
    cs: ChangeSet,
    source: RecentSource,
  ) {
    dispatch({ type: "RELOAD_CHANGESET", prevChangesetId, changeset: cs });
    // Round-trip through recents so the next welcome screen surfaces the
    // newest sha rather than pinning the stale one.
    setRecents(pushRecent(cs, {}, source));
  }

  // ── Live reload ───────────────────────────────────────────────────────
  // Provenance (path + branch + sha + dirtyHash baseline) lives on the
  // active changeset's worktreeSource. We derive it for the polling hook +
  // banner; null for non-worktree loads (paste/url/upload/stub).
  const activeCs =
    state.changesets.find((c) => c.id === state.cursor.changesetId) ?? null;
  const provenance: WorktreeProvenance | null = useMemo(() => {
    const src = activeCs?.worktreeSource;
    if (!src || !src.state) return null;
    return { path: src.worktreePath, branch: src.branch, state: src.state };
  }, [activeCs]);

  const [liveReloadEnabled, setLiveReloadEnabledState] = useState(true);
  const [staleNext, setStaleNext] = useState<WorktreeState | null>(null);
  const [worktreeGone, setWorktreeGone] = useState(false);
  const [busyReloading, setBusyReloading] = useState(false);
  const [lastProvenancePath, setLastProvenancePath] = useState<string | null>(
    null,
  );

  // "Adjust state during render" when the loaded worktree changes: hydrate
  // the per-worktree toggle and clear stale/gone banners that belonged to
  // the previous worktree. Avoids the cascading-render lint warning that
  // setState-inside-useEffect would trigger.
  const currentPath = provenance?.path ?? null;
  if (lastProvenancePath !== currentPath) {
    setLastProvenancePath(currentPath);
    if (currentPath) {
      setLiveReloadEnabledState(getLiveReloadEnabled(currentPath));
    }
    setStaleNext(null);
    setWorktreeGone(false);
  }

  useWorktreeLiveReload({
    provenance,
    enabled: liveReloadEnabled && !worktreeGone,
    onDrift: (next) => setStaleNext(next),
    onWorktreeGone: () => setWorktreeGone(true),
  });

  function toggleLiveReload() {
    if (!provenance) return;
    const next = !liveReloadEnabled;
    setLiveReloadEnabledState(next);
    setLiveReloadEnabled(provenance.path, next);
    if (!next) setStaleNext(null);
  }

  async function reloadWorktree() {
    if (!provenance || !activeCs || busyReloading) return;
    setBusyReloading(true);
    try {
      const wantDirty = staleNext?.dirty ?? false;
      const res = await fetch(await apiUrl("/api/worktrees/changeset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: provenance.path, dirty: wantDirty }),
      });
      const json = (await res.json()) as
        | {
            diff: string;
            sha: string;
            subject: string;
            author: string;
            branch: string | null;
            fileContents?: Record<string, string>;
            state: WorktreeState;
          }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      }
      let graph: CodeGraph | undefined;
      try {
        const g = await fetch(await apiUrl("/api/worktrees/graph"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: provenance.path }),
        });
        const gj = (await g.json()) as { graph?: CodeGraph; error?: string };
        if (g.ok && gj.graph) graph = gj.graph;
      } catch {
        // graph is optional; missing it just means a diff-scoped view
      }
      const newCs = parseDiff(json.diff, {
        id: `wt-${json.sha.slice(0, 12)}`,
        title:
          json.subject ||
          `${provenance.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
        author: json.author,
        head: json.branch ?? json.sha.slice(0, 7),
        fileContents: json.fileContents,
        graph,
      });
      newCs.worktreeSource = {
        worktreePath: provenance.path,
        commitSha: json.sha,
        branch: provenance.branch,
        state: json.state,
      };
      handleLoadChangeset(newCs, {}, {
        kind: "worktree",
        path: provenance.path,
        branch: provenance.branch,
      });
      setStaleNext(null);
    } catch (err) {
      console.error("[shippable] live-reload reload failed:", err);
    } finally {
      setBusyReloading(false);
    }
  }

  const liveReloadBar = provenance ? (
    <LiveReloadBar
      provenance={provenance}
      enabled={liveReloadEnabled}
      staleNext={staleNext}
      worktreeGone={worktreeGone}
      busyReloading={busyReloading}
      onToggleEnabled={toggleLiveReload}
      onReload={reloadWorktree}
      onDismissStale={() => setStaleNext(null)}
      onDismissGone={() => setWorktreeGone(false)}
    />
  ) : null;

  if (state.changesets.length === 0) {
    return (
      <Welcome
        recents={recents}
        onLoad={handleLoadChangeset}
        onRecentsChange={setRecents}
      />
    );
  }

  return (
    <ReviewWorkspace
      state={state}
      dispatch={dispatch}
      drafts={drafts}
      setDrafts={setDrafts}
      themeId={themeId}
      setThemeId={setThemeId}
      onLoadChangeset={handleLoadChangeset}
      currentSource={currentSource}
      onReloadChangeset={handleReloadChangeset}
      liveReloadBar={liveReloadBar}
    />
  );
}
