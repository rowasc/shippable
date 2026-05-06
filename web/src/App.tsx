import { useEffect, useReducer, useState } from "react";
import "./App.css";
import { findStub } from "./fixtures";
import { initialState, reducer } from "./state";
import { Welcome } from "./components/Welcome";
import { ReviewWorkspace } from "./components/ReviewWorkspace";
import type { ChangeSet, Reply } from "./types";
import {
  hasProgress,
  loadSession,
  peekSession,
  saveSession,
} from "./persist";
import {
  loadRecents,
  pushRecent,
  type RecentEntry,
  type RecentSource,
} from "./recents";
import { useTheme } from "./useTheme";

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
    />
  );
}
