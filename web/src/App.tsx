import { useEffect, useMemo, useReducer, useState } from "react";
import "./App.css";
import { findStub } from "./fixtures";
import { initialState, mergeInteractionMaps, reducer } from "./state";
import { Welcome } from "./components/Welcome";
import { ReviewWorkspace } from "./components/ReviewWorkspace";
import { LiveReloadBar } from "./components/LiveReloadBar";
import { FindBar } from "./components/FindBar";
import { useTauriMenu } from "./useTauriMenu";
import type {
  ChangeSet,
  DetachedInteraction,
  Interaction,
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
import { postJson } from "./apiClient";
import { fetchDiffCodeGraph } from "./codeGraphClient";

interface BootSeed {
  changesets: ChangeSet[];
  /** Pre-seeded Interactions for this changeset (stub fixtures or recents). */
  interactions: Record<string, Interaction[]>;
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
        interactions: { ...stub.interactions },
        applyPersisted: false,
        source: { kind: "stub", code: stub.code },
      };
    }
  }

  const peeked = peekSession();
  if (peeked && hasProgress(peeked)) {
    const csId = peeked.cursor.changesetId;
    const recent = loadRecents().find((r) => r.id === csId);
    if (recent && isResumableChangeset(recent.changeset)) {
      return {
        changesets: [recent.changeset],
        interactions: { ...recent.interactions },
        applyPersisted: true,
        source: recent.source,
      };
    }
    const stub = findStub(csId);
    if (stub && isResumableChangeset(stub.changeset)) {
      return {
        changesets: [stub.changeset],
        interactions: { ...stub.interactions },
        applyPersisted: true,
        source: { kind: "stub", code: stub.code },
      };
    }
  }

  return {
    changesets: [],
    interactions: {},
    applyPersisted: false,
    source: null,
  };
}

// Stored recents from before the pushRecent guard landed can have empty
// `files`. Treat them as non-resumable so boot falls through to Welcome
// instead of crashing on a cursor we can't anchor.
function isResumableChangeset(cs: ChangeSet): boolean {
  for (const f of cs.files) {
    if (f.hunks.length > 0) return true;
  }
  return false;
}

export default function App() {
  const [themeId, setThemeId] = useTheme();
  const { findOpen, closeFind } = useTauriMenu();
  const [boot] = useState<BootSeed>(() => resolveBoot());
  const [hydrated] = useState(() =>
    boot.applyPersisted
      ? loadSession(boot.changesets)
      : { state: null, drafts: {} as Record<string, string> },
  );
  const [state, dispatch] = useReducer(reducer, boot, (b) => {
    const initial = initialState(b.changesets, b.interactions);
    const persisted = hydrated.state;
    if (!persisted) return initial;
    // Persisted Interactions land on top of ingest-derived ones (AI /
    // teammate) so the round-trip ends with user-authored entries appended
    // to each thread, after the ingest head.
    const mergedInteractions = mergeInteractionMaps(
      initial.interactions,
      persisted.interactions,
    );
    return {
      ...initial,
      cursor: persisted.cursor,
      readLines: persisted.readLines,
      reviewedFiles: persisted.reviewedFiles,
      dismissedGuides: persisted.dismissedGuides,
      interactions: mergedInteractions,
      detachedInteractions: persisted.detachedInteractions,
    };
  });
  const [recents, setRecents] = useState<RecentEntry[]>(() => {
    // On boot with a resolved changeset, upsert it into recents — the
    // next welcome shows it at the top. For the welcome boot (no source)
    // just return the persisted list as-is.
    if (boot.source && boot.changesets.length > 0) {
      return pushRecent(boot.changesets[0], boot.interactions, boot.source);
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
    interactions: Record<string, Interaction[]>,
    source: RecentSource,
    prData?: {
      prInteractions: Record<string, Interaction[]>;
      prDetached: DetachedInteraction[];
    },
  ) {
    // Loads coming through this path (paste, URL, PR, worktree) carry no
    // ingest-derived AI annotations today — `interactions` is whatever
    // user-authored / stub-seeded state the caller threads in.
    dispatch({
      type: "LOAD_CHANGESET",
      changeset: cs,
      interactions,
    });
    if (prData) {
      dispatch({
        type: "MERGE_PR_INTERACTIONS",
        changesetId: cs.id,
        prInteractions: prData.prInteractions,
        prDetached: prData.prDetached,
      });
    }
    setCurrentSource(source);
    setRecents(pushRecent(cs, interactions, source));
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
      const json = await postJson<{
        diff: string;
        sha: string;
        subject: string;
        author: string;
        branch: string | null;
        fileContents?: Record<string, string>;
        state: WorktreeState;
      }>("/api/worktrees/changeset", {
        path: provenance.path,
        dirty: wantDirty,
      });
      const newCs = parseDiff(json.diff, {
        id: `wt-${json.sha.slice(0, 12)}`,
        title:
          json.subject ||
          `${provenance.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
        author: json.author,
        head: json.branch ?? json.sha.slice(0, 7),
        fileContents: json.fileContents,
      });
      const lspGraph = await fetchDiffCodeGraph(provenance.path, json.sha, newCs.files);
      if (lspGraph) newCs.graph = lspGraph;
      newCs.worktreeSource = {
        worktreePath: provenance.path,
        commitSha: json.sha,
        branch: provenance.branch,
        state: json.state,
      };
      // RELOAD_CHANGESET (not LOAD_CHANGESET) so the anchoring pass runs:
      // existing replies re-anchor to the new diff or move into the
      // Detached pile. LOAD_CHANGESET would silently orphan them.
      const source: RecentSource = {
        kind: "worktree",
        path: provenance.path,
        branch: provenance.branch,
      };
      dispatch({
        type: "RELOAD_CHANGESET",
        prevChangesetId: activeCs.id,
        changeset: newCs,
      });
      setCurrentSource(source);
      setRecents(pushRecent(newCs, {}, source));
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
      <>
        <Welcome
          recents={recents}
          onLoad={handleLoadChangeset}
          onRecentsChange={setRecents}
        />
        <FindBar open={findOpen} onClose={closeFind} />
      </>
    );
  }

  return (
    <>
      <ReviewWorkspace
        state={state}
        dispatch={dispatch}
        drafts={drafts}
        setDrafts={setDrafts}
        themeId={themeId}
        setThemeId={setThemeId}
        onLoadChangeset={handleLoadChangeset}
        currentSource={currentSource}
        liveReloadBar={liveReloadBar}
      />
      <FindBar open={findOpen} onClose={closeFind} />
    </>
  );
}
