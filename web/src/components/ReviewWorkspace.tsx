import { useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import { changesetCoverage, fileCoverage, reviewedFilesCount } from "../state";
import type { Action } from "../state";
import {
  fetchDefinition,
  fetchDefinitionCapabilities,
  findCapabilityForLanguage,
  isProgrammingLanguage,
  type DefinitionCapabilities,
  type DefinitionClickTarget,
  type DefinitionLocation,
} from "../definitionNav";
import { maybeSuggest } from "../guide";
import { usePlan } from "../usePlan";
import { Sidebar } from "./Sidebar";
import { DiffView } from "./DiffView";
import { StatusBar } from "./StatusBar";
import { GuidePrompt } from "./GuidePrompt";
import { HelpOverlay } from "./HelpOverlay";
import { Inspector } from "./Inspector";
import { LoadModal } from "./LoadModal";
import { ReviewPlanView } from "./ReviewPlanView";
import { CodeRunner } from "./CodeRunner";
import { ThemePicker } from "./ThemePicker";
import { PromptPicker } from "./PromptPicker";
import { CommandPalette } from "./CommandPalette";
import { type PromptRunView } from "./PromptRunsPanel";
import { buildAutoFillContext, type Prompt } from "../promptStore";
import { runPrompt } from "../promptRun";
import { buildSymbolIndex } from "../symbols";
import type { SymbolIndex } from "../symbols";
import type {
  AgentContextSlice,
  AgentSessionRef,
  ChangeSet,
  Cursor,
  EvidenceRef,
  ReviewState,
  Reply,
  WorktreeSource,
} from "../types";
import { blockCommentKey, lineNoteReplyKey, noteKey, userCommentKey } from "../types";
import {
  enqueueComment,
  fetchAgentContextForWorktree,
  fetchMcpStatus,
  unenqueueComment,
} from "../agentContextClient";
import { deriveCommentPayload } from "../agentCommentPayload";
import { buildReplyAnchor } from "../anchor";
import { fetchWorktreeChangeset } from "../worktreeChangeset";
import { useDeliveredPolling } from "../useDeliveredPolling";
import { KEYMAP, type ActionId } from "../keymap";
import { clearSession } from "../persist";
import type { ThemeId } from "../tokens";
import type { RecentSource } from "../recents";
import {
  buildDiffViewModel,
  buildSidebarViewModel,
  buildStatusBarViewModel,
  buildGuidePromptViewModel,
  buildInspectorViewModel,
} from "../view";

interface Props {
  state: ReviewState;
  dispatch: Dispatch<Action>;
  drafts: Record<string, string>;
  setDrafts: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  /** Called when LoadModal parses a fresh changeset — App handles dispatch
   *  + recents upsert. */
  onLoadChangeset: (
    cs: ChangeSet,
    replies: Record<string, Reply[]>,
    source: RecentSource,
  ) => void;
  currentSource: RecentSource | null;
  /**
   * Called by the debug "reload now" affordance to swap the current
   * worktree-loaded changeset for its latest snapshot, running the
   * content-anchor pass on existing comments. Slice (a) of the live-reload
   * plan will replace the manual button with a polling banner; the App
   * handler stays the same.
   */
  onReloadChangeset: (
    prevChangesetId: string,
    cs: ChangeSet,
    source: RecentSource,
  ) => void;
  /** Live-reload banner (idle / stale / gone) — null when no worktree
   *  changeset is loaded. Rendered between the topbar and the main view. */
  liveReloadBar?: ReactNode;
}

export function ReviewWorkspace({
  state,
  dispatch,
  drafts,
  setDrafts,
  themeId,
  setThemeId,
  onLoadChangeset,
  currentSource,
  onReloadChangeset,
  liveReloadBar,
}: Props) {
  const [showHelp, setShowHelp] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showLoad, setShowLoad] = useState(false);
  const [freeRunnerOpen, setFreeRunnerOpen] = useState(false);
  const [runRequest, setRunRequest] = useState<{
    tick: number;
    source: string;
  } | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [mouseTip, setMouseTip] = useState<string | null>(null);
  const [runs, setRuns] = useState<PromptRunView[]>([]);
  const [sidebarWide, setSidebarWide] = useState(false);
  const [definitionCapabilities, setDefinitionCapabilities] =
    useState<DefinitionCapabilities | null>(null);
  const [definitionCapabilitiesError, setDefinitionCapabilitiesError] =
    useState<string | null>(null);
  const [definitionPeek, setDefinitionPeek] = useState<DefinitionPeekState>({
    kind: "idle",
  });
  // TODO(slice-a): remove this `debugDirty` toggle once polling lands —
  // it stamps `originType: "dirty"` on new replies so the detached-pile UX
  // is reachable from slice (c) alone. Grep `TODO(slice-a)` to find every
  // call site (state, JSX button, reload-handler branch, anchor builder).
  const [debugDirty, setDebugDirty] = useState(false);
  const [debugReloading, setDebugReloading] = useState(false);
  const [debugReloadError, setDebugReloadError] = useState<string | null>(null);

  const runControllersRef = useRef<Map<string, AbortController>>(new Map());
  const mouseTipTimeoutRef = useRef<number | null>(null);

  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId)!;
  const line = hunk.lines[state.cursor.lineIdx];
  const symbolIndex = buildSymbolIndex(cs);
  const clickableSymbols = new Set(symbolIndex.keys());

  // Agent-context state. Provenance lives on cs.worktreeSource so it
  // survives reloads and changeset switches; the slice/sessions/error are
  // transient and per-cs.
  const [agentSlice, setAgentSlice] = useState<AgentContextSlice | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionRef[]>([]);
  const [pinnedSession, setPinnedSession] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentRefreshTick, setAgentRefreshTick] = useState(0);
  // MCP-install status with retry+backoff. The dev server's port briefly
  // disappears during `tsx watch` reloads; a single attempt can hit
  // ECONNREFUSED and leave the banner stuck "unknown". After ~31s of
  // attempts we give up silently — the install affordance stays visible
  // until the user dismisses it.
  const [mcpStatus, setMcpStatus] = useState<{
    installed: boolean;
    installCommand: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const tryFetch = () => {
      fetchMcpStatus()
        .then((s) => {
          if (!cancelled) setMcpStatus(s);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt >= 5) return;
          const delay = Math.min(1000 * 2 ** attempt, 10000);
          timer = window.setTimeout(tryFetch, delay);
        });
    };
    tryFetch();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const activeWorktreeSource: WorktreeSource | null = cs.worktreeSource ?? null;
  const wtPath = activeWorktreeSource?.worktreePath ?? null;
  const wtSha = activeWorktreeSource?.commitSha ?? null;

  // Polling runs while the panel is mounted AND the tab is visible — see
  // docs/sdd/agent-reply-support/spec.md for why per-comment outstanding
  // gates are unsound under multi-reply.
  const {
    delivered: deliveredComments,
    agentReplies: polledAgentReplies,
    lastSuccessfulPollAt: deliveredLastSuccessAt,
    error: deliveredErrorState,
  } = useDeliveredPolling({ worktreePath: wtPath });

  // Reconcile polled agent replies into the matching reviewer Reply's
  // `agentReplies` array. The reducer is idempotent so we don't have to
  // dedupe before dispatching.
  useEffect(() => {
    if (polledAgentReplies.length === 0) return;
    dispatch({ type: "MERGE_AGENT_REPLIES", polled: polledAgentReplies });
  }, [polledAgentReplies, dispatch]);

  const wantedFetchKey =
    wtPath && wtSha
      ? `${wtPath}|${wtSha}|${pinnedSession ?? ""}|${agentRefreshTick}`
      : null;
  // "Adjusting state during render" pattern (mirrors usePlan): when the
  // fetch key transitions, flip loading/error synchronously here so the
  // effect body stays free of sync setState.
  const [lastFetchKey, setLastFetchKey] = useState<string | null>(null);
  if (lastFetchKey !== wantedFetchKey) {
    setLastFetchKey(wantedFetchKey);
    if (wantedFetchKey) {
      setAgentLoading(true);
      setAgentError(null);
    } else {
      setAgentLoading(false);
    }
  }
  useEffect(() => {
    if (!wantedFetchKey || !wtPath || !wtSha) return;
    let cancelled = false;
    fetchAgentContextForWorktree({
      worktreePath: wtPath,
      commitSha: wtSha,
      pinnedSessionFilePath: pinnedSession,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setAgentSlice(null);
          setAgentSessions([]);
        } else {
          setAgentSlice(res.slice);
          setAgentSessions(res.candidates);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAgentError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setAgentLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // wtPath/wtSha/pinnedSession are folded into wantedFetchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedFetchKey]);
  const {
    plan,
    status: planStatus,
    error: planError,
    generate: generatePlan,
  } = usePlan(cs);
  const jumpTo = (c: Cursor) => dispatch({ type: "SET_CURSOR", cursor: c });

  const suggestion = maybeSuggest(cs, state);
  const lineNoteAcked = state.ackedNotes.has(
    noteKey(state.cursor.hunkId, state.cursor.lineIdx),
  );

  const palettePredicates: Record<string, boolean> = {
    hasSuggestion: !!suggestion,
    lineHasAiNote: !!line?.aiNote,
    hasSelection: !!state.selection,
    hasPlan: showPlan,
    hasPicker: showPicker,
    hasCommandPalette: showCommandPalette,
  };

  function runAction(action: ActionId) {
    const preserveSelection = draftingKey?.startsWith("block:") ?? false;
    switch (action) {
      case "MOVE_LINE_DOWN":
        dispatch({ type: "MOVE_LINE", delta: 1, preserveSelection });
        break;
      case "MOVE_LINE_UP":
        dispatch({ type: "MOVE_LINE", delta: -1, preserveSelection });
        break;
      case "MOVE_LINE_DOWN_EXTEND":
        dispatch({ type: "MOVE_LINE", delta: 1, extend: true });
        break;
      case "MOVE_LINE_UP_EXTEND":
        dispatch({ type: "MOVE_LINE", delta: -1, extend: true });
        break;
      case "COLLAPSE_SELECTION":
        dispatch({ type: "COLLAPSE_SELECTION" });
        break;
      case "MOVE_HUNK_DOWN":
        dispatch({ type: "MOVE_HUNK", delta: 1 });
        break;
      case "MOVE_HUNK_UP":
        dispatch({ type: "MOVE_HUNK", delta: -1 });
        break;
      case "MOVE_FILE_NEXT":
        dispatch({ type: "MOVE_FILE", delta: 1 });
        break;
      case "MOVE_FILE_PREV":
        dispatch({ type: "MOVE_FILE", delta: -1 });
        break;
      case "TOGGLE_HELP":
        setShowHelp((v) => !v);
        break;
      case "TOGGLE_INSPECTOR":
        setShowInspector((v) => !v);
        break;
      case "TOGGLE_PLAN":
        setShowPlan((v) => !v);
        break;
      case "CLOSE_PLAN":
        setShowPlan(false);
        break;
      case "TOGGLE_ACK":
        dispatch({
          type: "TOGGLE_ACK",
          hunkId: state.cursor.hunkId,
          lineIdx: state.cursor.lineIdx,
        });
        break;
      case "TOGGLE_FILE_REVIEWED":
        dispatch({
          type: "TOGGLE_FILE_REVIEWED",
          fileId: state.cursor.fileId,
        });
        break;
      case "START_REPLY":
        setDraftingKey(
          lineNoteReplyKey(state.cursor.hunkId, state.cursor.lineIdx),
        );
        setShowInspector(true);
        break;
      case "START_COMMENT": {
        const sel = state.selection;
        const key =
          sel && sel.hunkId === state.cursor.hunkId
            ? blockCommentKey(
                sel.hunkId,
                Math.min(sel.anchor, sel.head),
                Math.max(sel.anchor, sel.head),
              )
            : userCommentKey(state.cursor.hunkId, state.cursor.lineIdx);
        setDraftingKey(key);
        setShowInspector(true);
        break;
      }
      case "ACCEPT_GUIDE": {
        if (!suggestion) break;
        dispatch({
          type: "SET_CURSOR",
          cursor: {
            changesetId: state.cursor.changesetId,
            fileId: suggestion.toFileId,
            hunkId: suggestion.toHunkId,
            lineIdx: suggestion.toLineIdx,
          },
        });
        break;
      }
      case "DISMISS_GUIDE":
        if (!suggestion) break;
        dispatch({ type: "DISMISS_GUIDE", guideId: suggestion.id });
        break;
      case "CLOSE_HELP":
        if (showHelp) setShowHelp(false);
        break;
      case "OPEN_LOAD":
        setShowLoad(true);
        break;
      case "OPEN_RUNNER":
        setFreeRunnerOpen(true);
        break;
      case "OPEN_PROMPT_PICKER":
        setShowPicker((v) => !v);
        break;
      case "CLOSE_PROMPT_PICKER":
        setShowPicker(false);
        break;
      case "OPEN_COMMAND_PALETTE":
        setShowCommandPalette(true);
        break;
      case "CLOSE_COMMAND_PALETTE":
        setShowCommandPalette(false);
        break;
      case "RUN_SELECTION": {
        const sel = state.selection;
        const lines =
          sel && sel.hunkId === hunk.id
            ? hunk.lines.slice(
                Math.min(sel.anchor, sel.head),
                Math.max(sel.anchor, sel.head) + 1,
              )
            : hunk.lines;
        const source = lines
          .filter((l) => l.kind !== "del")
          .map((l) => l.text)
          .join("\n");
        setRunRequest((prev) => ({
          tick: (prev?.tick ?? 0) + 1,
          source,
        }));
        break;
      }
      case "PREV_CHANGESET":
        dispatch({
          type: "SWITCH_CHANGESET",
          changesetId: cycleChangeset(
            state.changesets,
            state.cursor.changesetId,
            -1,
          ),
        });
        break;
      case "NEXT_CHANGESET":
        dispatch({
          type: "SWITCH_CHANGESET",
          changesetId: cycleChangeset(
            state.changesets,
            state.cursor.changesetId,
            1,
          ),
        });
        break;
    }
  }

  function flashMouseTip(chord: string, label: string) {
    if (mouseTipTimeoutRef.current !== null) {
      window.clearTimeout(mouseTipTimeoutRef.current);
    }
    setMouseTip(`tip: next time press ${chord} for ${label}`);
    mouseTipTimeoutRef.current = window.setTimeout(() => {
      setMouseTip(null);
      mouseTipTimeoutRef.current = null;
    }, 2600);
  }
  const currentWorkspaceRoot =
    currentSource?.kind === "worktree"
      ? currentSource.path
      : (cs.worktreeSource?.worktreePath ?? null);
  const definitionScopeKey = `${cs.id}:${file.id}:${currentWorkspaceRoot ?? ""}`;
  const definitionCapability = findCapabilityForLanguage(definitionCapabilities, file.language);
  const canUseServerDefinitions =
    currentWorkspaceRoot !== null &&
    definitionCapability?.available === true;
  const allowAnyIdentifier = canUseServerDefinitions;

  useEffect(() => {
    let cancelled = false;
    void fetchDefinitionCapabilities()
      .then((capabilities) => {
        if (cancelled) return;
        setDefinitionCapabilities(capabilities);
        setDefinitionCapabilitiesError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDefinitionCapabilities({
          languages: [],
          requiresWorktree: true,
          anyAvailable: false,
        });
        setDefinitionCapabilitiesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showHelp && e.key !== "?" && e.key !== "Escape") return;
      if (showPlan && !["p", "?", "Escape"].includes(e.key)) return;
      if (showPicker && e.key !== "Escape") return;
      // The palette has its own keyboard handlers; the global keymap only
      // needs to handle Escape as a fallback when focus has escaped the
      // palette's box (e.g. after clicking outside the input).
      if (showCommandPalette && e.key !== "Escape") return;

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Tab" && tgt && tgt !== document.body) return;

      const entry = KEYMAP.find(
        (km) =>
          km.key === e.key &&
          (km.shift === undefined ? true : km.shift === e.shiftKey) &&
          (km.meta ?? false) === e.metaKey &&
          (km.ctrl ?? false) === e.ctrlKey &&
          (km.when === undefined ? true : palettePredicates[km.when]),
      );

      if (!entry) return;

      e.preventDefault();
      runAction(entry.action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // palettePredicates and runAction are rebuilt every render; including
    // them would cause the effect to re-register each render anyway. The
    // explicit deps below already cover everything either of them reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showHelp,
    showPlan,
    showPicker,
    showCommandPalette,
    state.cursor,
    state.changesets,
    state.selection,
    suggestion,
    line,
    draftingKey,
    hunk.id,
    hunk.lines,
    dispatch,
  ]);

  useEffect(
    () => () => {
      if (mouseTipTimeoutRef.current !== null) {
        window.clearTimeout(mouseTipTimeoutRef.current);
      }
    },
    [],
  );

  const readCoverage = changesetCoverage(cs, state.readLines);
  const reviewedFiles = reviewedFilesCount(cs, state.reviewedFiles);
  const fileIdx = cs.files.findIndex((f) => f.id === file.id);
  const hunkIdx = file.hunks.findIndex((h) => h.id === hunk.id);
  const guideViewModel = suggestion
    ? buildGuidePromptViewModel(suggestion, symbolIndex, cs.id)
    : null;

  function startPromptRun(prompt: Prompt, rendered: string) {
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    runControllersRef.current.set(id, controller);
    setRuns((prev) => [
      { id, promptName: prompt.name, text: "", status: "streaming" },
      ...prev,
    ]);
    setShowPicker(false);
    const patchRun = (patch: (r: PromptRunView) => PromptRunView) =>
      setRuns((prev) => prev.map((r) => (r.id === id ? patch(r) : r)));
    runPrompt(
      { text: rendered, signal: controller.signal },
      {
        onText: (chunk) => patchRun((r) => ({ ...r, text: r.text + chunk })),
        onDone: () => {
          runControllersRef.current.delete(id);
          patchRun((r) => ({ ...r, status: "done" }));
        },
        onError: (msg) => {
          runControllersRef.current.delete(id);
          patchRun((r) => ({ ...r, status: "error", error: msg }));
        },
      },
    );
  }

  function closePromptRun(id: string) {
    runControllersRef.current.get(id)?.abort();
    runControllersRef.current.delete(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSymbolClick(target: DefinitionClickTarget) {
    const inDiffTarget = symbolIndex.get(target.symbol);
    if (inDiffTarget) {
      dispatch({ type: "SET_CURSOR", cursor: inDiffTarget });
      setDefinitionPeek({ kind: "idle" });
      return;
    }

    if (currentWorkspaceRoot === null) {
      setDefinitionPeek({
        kind: "unsupported",
        symbol: target.symbol,
        message: "Load the diff from a local worktree before asking the server for definitions.",
        scopeKey: definitionScopeKey,
      });
      return;
    }
    if (!definitionCapability) {
      const supported = definitionCapabilities?.languages
        .map((l) => l.id.toUpperCase())
        .join(", ") ?? "none";
      setDefinitionPeek({
        kind: "unsupported",
        symbol: target.symbol,
        message: `No language module handles ${file.language} yet. Supported: ${supported}.`,
        scopeKey: definitionScopeKey,
      });
      return;
    }
    if (!definitionCapability.available) {
      setDefinitionPeek({
        kind: "unsupported",
        symbol: target.symbol,
        message: definitionCapability.reason ?? "Definition lookup is unavailable.",
        scopeKey: definitionScopeKey,
      });
      return;
    }
    if (!canUseServerDefinitions) {
      setDefinitionPeek({
        kind: "unsupported",
        symbol: target.symbol,
        message: "Definition lookup is still initializing.",
        scopeKey: definitionScopeKey,
      });
      return;
    }

    setDefinitionPeek({ kind: "loading", symbol: target.symbol, scopeKey: definitionScopeKey });
    try {
      const response = await fetchDefinition({
        file: target.file,
        language: target.language,
        line: target.line,
        col: target.col,
        workspaceRoot: currentWorkspaceRoot,
      });
      if (response.status === "unsupported") {
        setDefinitionPeek({
          kind: "unsupported",
          symbol: target.symbol,
          message: response.reason,
          scopeKey: definitionScopeKey,
        });
        return;
      }
      if (response.status === "error") {
        setDefinitionPeek({
          kind: "error",
          symbol: target.symbol,
          message: response.error,
          scopeKey: definitionScopeKey,
        });
        return;
      }
      const jumpTarget = response.definitions
        .map((definition) => resolveDefinitionToCursor(cs, definition))
        .find((cursor): cursor is Cursor => cursor !== null);
      if (jumpTarget) {
        dispatch({ type: "SET_CURSOR", cursor: jumpTarget });
        setDefinitionPeek({ kind: "idle" });
        return;
      }
      setDefinitionPeek({
        kind: "results",
        symbol: target.symbol,
        definitions: response.definitions,
        scopeKey: definitionScopeKey,
      });
    } catch (err) {
      setDefinitionPeek({
        kind: "error",
        symbol: target.symbol,
        message: err instanceof Error ? err.message : String(err),
        scopeKey: definitionScopeKey,
      });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">shippable</span>
        <span className="topbar__sep">│</span>
        <span className="topbar__id">{cs.id}</span>
        <span className="topbar__title">{cs.title}</span>
        <PlanChip
          isOpen={showPlan}
          plan={plan}
          reviewedFiles={state.reviewedFiles}
          onToggle={() => {
            flashMouseTip("p", "the review plan");
            setShowPlan((v) => !v);
          }}
        />
        <span className="topbar__sep">│</span>
        <span className="topbar__branch">
          {cs.branch} → {cs.base}
        </span>
        <DefinitionStatusChip
          currentSource={currentSource}
          fileLanguage={file.language}
          capabilities={definitionCapabilities}
          fetchError={definitionCapabilitiesError}
        />
        <span className="topbar__spacer" />
        <span className="topbar__author">@{cs.author}</span>
        <ThemePicker value={themeId} onChange={setThemeId} />
        <button
          type="button"
          className={`topbar__btn ${showInspector ? "topbar__btn--on" : ""}`}
          onClick={() => {
            flashMouseTip("i", "the inspector");
            setShowInspector((v) => !v);
          }}
          title="toggle the inspector (i)"
        >
          <span className="topbar__btn-label">◫ inspector</span>
          <kbd>i</kbd>
        </button>
        <button
          type="button"
          className="topbar__btn"
          onClick={() => {
            flashMouseTip("⇧R", "the free code runner");
            setFreeRunnerOpen(true);
          }}
          title="open a free code runner — type or paste a snippet (shift+R)"
        >
          <span className="topbar__btn-label">▷ run</span>
          <kbd>⇧R</kbd>
        </button>
        <button
          type="button"
          className="topbar__btn"
          onClick={() => {
            flashMouseTip("⇧L", "load changeset");
            setShowLoad(true);
          }}
          title="load a changeset from URL, file, or paste (shift+L)"
        >
          <span className="topbar__btn-label">+ load</span>
          <kbd>⇧L</kbd>
        </button>
        {activeWorktreeSource && (
          <>
            <button
              type="button"
              className="topbar__btn"
              disabled={debugReloading}
              onClick={async () => {
                if (!activeWorktreeSource) return;
                setDebugReloading(true);
                setDebugReloadError(null);
                try {
                  const reloaded = await fetchWorktreeChangeset({
                    path: activeWorktreeSource.worktreePath,
                    branch: activeWorktreeSource.branch,
                  });
                  // TODO(slice-a): drop this branch — polling will set
                  // `dirty` from the probe instead of the debug toggle.
                  if (reloaded.worktreeSource && debugDirty) {
                    reloaded.worktreeSource.dirty = true;
                  }
                  onReloadChangeset(cs.id, reloaded, {
                    kind: "worktree",
                    path: activeWorktreeSource.worktreePath,
                    branch: activeWorktreeSource.branch,
                  });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  setDebugReloadError(msg);
                } finally {
                  setDebugReloading(false);
                }
              }}
              title="debug: re-fetch the worktree changeset and run the anchor pass"
            >
              <span className="topbar__btn-label">
                {debugReloading ? "reloading…" : "↻ reload"}
              </span>
            </button>
            {/* TODO(slice-a): remove this whole button when polling lands. */}
            <button
              type="button"
              className={`topbar__btn ${debugDirty ? "topbar__btn--on" : ""}`}
              onClick={() => setDebugDirty((v) => !v)}
              title="debug: tag new comments as dirty-origin (forces the dirty caption on detach)"
            >
              <span className="topbar__btn-label">
                {debugDirty ? "● dirty-on" : "○ dirty-off"}
              </span>
            </button>
          </>
        )}
        {debugReloadError && (
          <span className="topbar__error" title={debugReloadError}>
            reload failed
          </span>
        )}
        <button
          type="button"
          className="topbar__btn"
          onClick={() => {
            flashMouseTip("?", "help");
            setShowHelp(true);
          }}
          title="open shortcut help (?)"
        >
          <span className="topbar__btn-label">help</span>
          <kbd>?</kbd>
        </button>
        <button
          className="topbar__btn topbar__btn--danger"
          onClick={() => {
            if (
              window.confirm(
                "Reset this review session? Read marks, sign-offs, comments, and drafts will be cleared.",
              )
            ) {
              clearSession();
              window.location.reload();
            }
          }}
          title="clear persisted progress and reload"
        >
          × reset
        </button>
      </header>

      {liveReloadBar}

      <div
        className={`main ${showInspector ? "main--with-inspector" : ""} ${
          sidebarWide ? "main--wide-sidebar" : ""
        }`}
      >
        <Sidebar
          viewModel={buildSidebarViewModel({
            files: cs.files,
            currentFileId: state.cursor.fileId,
            readLines: state.readLines,
            reviewedFiles: state.reviewedFiles,
            detachedReplies: state.detachedReplies,
          })}
          onPickFile={(fileId) => {
            const f = cs.files.find((ff) => ff.id === fileId)!;
            dispatch({
              type: "SET_CURSOR",
              cursor: {
                changesetId: cs.id,
                fileId,
                hunkId: f.hunks[0].id,
                lineIdx: 0,
              },
            });
          }}
          runs={runs}
          onCloseRun={closePromptRun}
          wide={sidebarWide}
          onToggleWide={() => setSidebarWide((v) => !v)}
        />
        <div className="reviewpane">
          <DefinitionPeek
            peek={definitionPeek.kind !== "idle" && definitionPeek.scopeKey === definitionScopeKey
              ? definitionPeek
              : { kind: "idle" }}
            onDismiss={() => setDefinitionPeek({ kind: "idle" })}
          />
          <DiffView
            viewModel={buildDiffViewModel({
              file,
              currentHunkId: hunk.id,
              cursorLineIdx: state.cursor.lineIdx,
              read: state.readLines,
              isFileReviewed: state.reviewedFiles.has(file.id),
              acked: state.ackedNotes,
              replies: state.replies,
              expandLevelAbove: state.expandLevelAbove,
              expandLevelBelow: state.expandLevelBelow,
              fileFullyExpanded: state.fullExpandedFiles.has(file.id),
              filePreviewing: state.previewedFiles.has(file.id),
              imageAssets: cs.imageAssets,
              selection: state.selection,
            })}
            onSetExpandLevel={(hunkId, dir, level) =>
              dispatch({ type: "SET_EXPAND_LEVEL", hunkId, dir, level })
            }
            onToggleExpandFile={(fileId) =>
              dispatch({ type: "TOGGLE_EXPAND_FILE", fileId })
            }
            onTogglePreviewFile={(fileId) =>
              dispatch({ type: "TOGGLE_PREVIEW_FILE", fileId })
            }
            clickableSymbols={clickableSymbols}
            allowAnyIdentifier={allowAnyIdentifier}
            onSymbolClick={handleSymbolClick}
          />
        </div>
        {showInspector && (
          <Inspector
            viewModel={buildInspectorViewModel({
              file,
              hunk,
              line,
              cursor: state.cursor,
              symbols: symbolIndex,
              acked: state.ackedNotes,
              replies: state.replies,
              draftingKey,
            })}
            symbols={symbolIndex}
            draftBodies={drafts}
            onJump={jumpTo}
            onJumpToBlock={(cursor, selection) =>
              dispatch({ type: "SET_CURSOR", cursor, selection })
            }
            onToggleAck={(hunkId, lineIdx) =>
              dispatch({ type: "TOGGLE_ACK", hunkId, lineIdx })
            }
            onStartDraft={(key) => setDraftingKey(key)}
            onCloseDraft={() => setDraftingKey(null)}
            onChangeDraft={(key, body) =>
              setDrafts((prev) => ({ ...prev, [key]: body }))
            }
            onSubmitReply={(key, body) => {
              const createdAt = new Date();
              const replyId = `r-${createdAt.getTime()}`;
              dispatch({
                type: "ADD_REPLY",
                targetKey: key,
                reply: {
                  id: replyId,
                  author: "you",
                  body,
                  createdAt: createdAt.toISOString(),
                  enqueuedCommentId: null,
                  // TODO(slice-a): replace `debugDirty` with the value
                  // from the polling probe; this whole `{ dirty }` arg
                  // can drop the toggle reference.
                  ...buildReplyAnchor(key, cs, { dirty: debugDirty }),
                },
              });
              setDrafts((prev) => {
                if (!(key in prev)) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setDraftingKey(null);
              // Fire-and-forget enqueue when a worktree is loaded.
              // Non-worktree loads (paste/url/upload) save the Reply
              // locally only; the pip never appears.
              if (activeWorktreeSource) {
                const derived = deriveCommentPayload(key, cs);
                if (derived) {
                  enqueueComment({
                    worktreePath: activeWorktreeSource.worktreePath,
                    commitSha: activeWorktreeSource.commitSha,
                    comment: { ...derived, body },
                  })
                    .then((r) =>
                      dispatch({
                        type: "PATCH_REPLY_ENQUEUED_ID",
                        targetKey: key,
                        replyId,
                        enqueuedCommentId: r.id,
                      }),
                    )
                    .catch((err: unknown) => {
                      console.error("[shippable] enqueueComment failed:", err);
                      // Surface the failure as an errored pip; the user can
                      // click it to retry. The reply itself stays in place
                      // so nothing is lost.
                      dispatch({
                        type: "SET_REPLY_ENQUEUE_ERROR",
                        targetKey: key,
                        replyId,
                        error: true,
                      });
                    });
                }
              }
            }}
            onRetryReply={(key, replyId) => {
              // Errored-pip retry path. Looks up the Reply by id, derives
              // the same {kind,file,lines} the original submit produced,
              // and re-POSTs /api/agent/enqueue. NO supersedes here — the
              // original POST never landed an id, so there's no predecessor
              // to replace. Mirrors the spec from the v0 task list.
              if (!activeWorktreeSource) return;
              const target = state.replies[key]?.find((r) => r.id === replyId);
              if (!target) return;
              const derived = deriveCommentPayload(key, cs);
              if (!derived) return;
              // Optimistically clear the error so the pip flips back to ◌
              // queued the moment the user clicks; if the retry fails we set
              // it again on the catch.
              dispatch({
                type: "SET_REPLY_ENQUEUE_ERROR",
                targetKey: key,
                replyId,
                error: false,
              });
              enqueueComment({
                worktreePath: activeWorktreeSource.worktreePath,
                commitSha: activeWorktreeSource.commitSha,
                comment: { ...derived, body: target.body },
              })
                .then((r) =>
                  dispatch({
                    type: "PATCH_REPLY_ENQUEUED_ID",
                    targetKey: key,
                    replyId,
                    enqueuedCommentId: r.id,
                  }),
                )
                .catch((err: unknown) => {
                  console.error("[shippable] retry enqueueComment failed:", err);
                  dispatch({
                    type: "SET_REPLY_ENQUEUE_ERROR",
                    targetKey: key,
                    replyId,
                    error: true,
                  });
                });
            }}
            onDeleteReply={(key, replyId) => {
              const target = state.replies[key]?.find((r) => r.id === replyId);
              const enqueuedId = target?.enqueuedCommentId ?? null;
              if (enqueuedId && activeWorktreeSource) {
                unenqueueComment({
                  worktreePath: activeWorktreeSource.worktreePath,
                  id: enqueuedId,
                }).catch((err: unknown) => {
                  console.error("[shippable] unenqueueComment failed:", err);
                });
              }
              dispatch({ type: "DELETE_REPLY", targetKey: key, replyId });
            }}
            onVerifyAiNote={(recipe) => {
              setRunRequest((prev) => ({
                tick: (prev?.tick ?? 0) + 1,
                source: recipe.source,
                inputs: recipe.inputs,
              }));
            }}
            agentContext={
              activeWorktreeSource
                ? {
                    slice: agentSlice,
                    candidates: agentSessions,
                    selectedSessionFilePath:
                      pinnedSession ?? agentSlice?.session.filePath ?? null,
                    loading: agentLoading,
                    error: agentError,
                    mcpStatus,
                    delivered: deliveredComments,
                    lastSuccessfulPollAt: deliveredLastSuccessAt,
                    deliveredError: deliveredErrorState,
                    onPickSession: (fp) => setPinnedSession(fp),
                    onRefresh: () => setAgentRefreshTick((t) => t + 1),
                  }
                : undefined
            }
          />
        )}
      </div>

      {guideViewModel && (
        <GuidePrompt viewModel={guideViewModel} onJump={jumpTo} />
      )}
      {showPlan && (
        <div className="planview-overlay" onClick={() => setShowPlan(false)}>
          <div
            className="planview-overlay__box"
            onClick={(e) => e.stopPropagation()}
          >
            <ReviewPlanView
              plan={plan}
              changeset={cs}
              status={planStatus}
              error={planError}
              onGenerateAi={generatePlan}
              onJumpToEntry={(entry) => {
                const f = cs.files.find((ff) => ff.id === entry.fileId);
                if (!f) return;
                const hunkId = entry.hunkId ?? f.hunks[0].id;
                dispatch({
                  type: "SET_CURSOR",
                  cursor: {
                    changesetId: cs.id,
                    fileId: entry.fileId,
                    hunkId,
                    lineIdx: 0,
                  },
                });
                setShowPlan(false);
              }}
              onNavigate={(ev) => {
                const target = resolveEvidenceToCursor(ev, cs, symbolIndex);
                if (!target) return;
                dispatch({ type: "SET_CURSOR", cursor: target });
                setShowPlan(false);
              }}
            />
          </div>
        </div>
      )}
      <CodeRunner
        currentFilePath={file.path}
        freeOpen={freeRunnerOpen}
        onFreeClose={() => setFreeRunnerOpen(false)}
        runRequest={runRequest}
      />
      {showPicker && (
        <PromptPicker
          context={buildAutoFillContext(cs, file, hunk, state.selection)}
          onClose={() => setShowPicker(false)}
          onSubmit={(prompt, rendered) => startPromptRun(prompt, rendered)}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          predicates={palettePredicates}
          onClose={() => setShowCommandPalette(false)}
          onPick={(action) => {
            setShowCommandPalette(false);
            runAction(action);
          }}
        />
      )}
      {showHelp && (
        <HelpOverlay
          context={buildHelpContext({
            hasSelection:
              !!state.selection && state.selection.hunkId === state.cursor.hunkId,
            lineHasAiNote: !!line?.aiNote,
            lineNoteAcked,
            currentFileReadFraction: fileCoverage(file, state.readLines),
            currentFileReviewed: state.reviewedFiles.has(file.id),
            showInspector,
          })}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showLoad && (
        <LoadModal
          onClose={() => setShowLoad(false)}
          onLoad={(newCs, source) => {
            onLoadChangeset(newCs, {}, source);
            // Clear any prior slice/sessions so the fresh load doesn't
            // briefly show the previous worktree's transcript while the
            // new fetch runs. Provenance lives on cs.worktreeSource.
            setPinnedSession(null);
            setAgentSlice(null);
            setAgentSessions([]);
            setAgentError(null);
            setShowLoad(false);
          }}
        />
      )}
      <StatusBar
        transientHint={mouseTip}
        viewModel={buildStatusBarViewModel({
          totalFiles: cs.files.length,
          fileIdx,
          totalHunks: file.hunks.length,
          hunkIdx,
          totalLines: hunk.lines.length,
          lineIdx: state.cursor.lineIdx,
          readCoverage,
          reviewedFiles,
          selection: selectionForStatusBar(hunk, state.selection),
          lineHasAiNote: !!line?.aiNote,
          lineNoteAcked,
          currentFileReadFraction: fileCoverage(file, state.readLines),
          currentFileReviewed: state.reviewedFiles.has(file.id),
        })}
      />
    </div>
  );
}

type DefinitionPeekState =
  | { kind: "idle" }
  | { kind: "loading"; symbol: string; scopeKey: string }
  | { kind: "unsupported"; symbol: string; message: string; scopeKey: string }
  | { kind: "error"; symbol: string; message: string; scopeKey: string }
  | {
      kind: "results";
      symbol: string;
      definitions: DefinitionLocation[];
      scopeKey: string;
    };

function DefinitionStatusChip({
  currentSource,
  fileLanguage,
  capabilities,
  fetchError,
}: {
  currentSource: RecentSource | null;
  fileLanguage: string;
  capabilities: DefinitionCapabilities | null;
  fetchError: string | null;
}) {
  // Hide entirely for non-programming files (markdown, json, yaml, …).
  // Plan-symbols.md L11: a "JS/TS only" chip on a markdown file is worse
  // than nothing.
  if (!isProgrammingLanguage(fileLanguage)) return null;

  if (capabilities === null && !fetchError) {
    return (
      <span
        className="topbar__meta-chip topbar__meta-chip--muted"
        title="Checking definition-navigation support."
      >
        def: checking
      </span>
    );
  }

  if (currentSource?.kind !== "worktree") {
    return (
      <span
        className="topbar__meta-chip topbar__meta-chip--muted"
        title="Load this diff from a local worktree before asking the server for definitions."
      >
        def: worktree only
      </span>
    );
  }

  if (fetchError) {
    return (
      <span
        className="topbar__meta-chip topbar__meta-chip--bad"
        title={`Couldn't reach the server for capabilities: ${fetchError}`}
      >
        def: unreachable
      </span>
    );
  }

  const cap = findCapabilityForLanguage(capabilities, fileLanguage);

  // Programming language we *could* handle in principle, but no module
  // claims it. Show the supported set so the user can see what's missing.
  if (!cap) {
    const supported = capabilities!.languages
      .filter((l) => l.available)
      .map((l) => l.id.toUpperCase());
    if (supported.length === 0) {
      return (
        <span
          className="topbar__meta-chip topbar__meta-chip--bad"
          title="No language servers are currently configured. See the README for setup."
        >
          def: unavailable
        </span>
      );
    }
    return (
      <span
        className="topbar__meta-chip topbar__meta-chip--muted"
        title={`Supported here: ${supported.join(", ")}. ${fileLanguage} isn't wired up yet.`}
      >
        {`def: ${supported.join(", ")} only`}
      </span>
    );
  }

  if (cap.available) {
    return (
      <span
        className="topbar__meta-chip topbar__meta-chip--ok"
        title={`Go-to-definition uses ${cap.resolver ?? cap.id} against the loaded worktree root.`}
      >
        {`def: ${cap.id.toUpperCase()} LSP`}
      </span>
    );
  }

  return (
    <span
      className="topbar__meta-chip topbar__meta-chip--bad"
      title={cap.reason ?? `Definition lookup unavailable for ${cap.id}.`}
    >
      {`def: ${cap.id.toUpperCase()} unavailable`}
    </span>
  );
}

function DefinitionPeek({
  peek,
  onDismiss,
}: {
  peek: DefinitionPeekState;
  onDismiss: () => void;
}) {
  if (peek.kind === "idle") return null;

  return (
    <section className={`definition-peek definition-peek--${peek.kind}`}>
      <div className="definition-peek__header">
        <strong>definition</strong>
        {" symbol "}
        <code>{peek.symbol}</code>
        <button className="definition-peek__close" onClick={onDismiss}>
          ×
        </button>
      </div>
      {peek.kind === "loading" && (
        <div className="definition-peek__body">Resolving against the workspace root…</div>
      )}
      {peek.kind === "unsupported" && (
        <div className="definition-peek__body">{peek.message}</div>
      )}
      {peek.kind === "error" && (
        <div className="definition-peek__body">{peek.message}</div>
      )}
      {peek.kind === "results" && (
        <div className="definition-peek__body">
          {peek.definitions.length === 0 ? (
            <div>No definition result came back from the language server.</div>
          ) : (
            peek.definitions.map((definition) => (
              <article key={`${definition.uri}:${definition.line}:${definition.col}`}>
                <div className="definition-peek__path">
                  {definition.file}:{definition.line + 1}
                </div>
                <pre className="definition-peek__preview">
                  {definition.preview || "No preview available."}
                </pre>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Turn a plan-view evidence reference into a Cursor for navigation.
 * Returns null for "description" (unreachable via click) and for refs that
 * don't resolve — the caller should treat null as "do nothing".
 */
function resolveEvidenceToCursor(
  ev: EvidenceRef,
  cs: ChangeSet,
  symbols: SymbolIndex,
): Cursor | null {
  switch (ev.kind) {
    case "description":
      return null;
    case "file": {
      const f = cs.files.find((ff) => ff.path === ev.path);
      if (!f || f.hunks.length === 0) return null;
      return {
        changesetId: cs.id,
        fileId: f.id,
        hunkId: f.hunks[0].id,
        lineIdx: 0,
      };
    }
    case "hunk": {
      for (const f of cs.files) {
        const h = f.hunks.find((hh) => hh.id === ev.hunkId);
        if (h) {
          return {
            changesetId: cs.id,
            fileId: f.id,
            hunkId: h.id,
            lineIdx: 0,
          };
        }
      }
      return null;
    }
    case "symbol": {
      return symbols.get(ev.name) ?? null;
    }
  }
}

function resolveDefinitionToCursor(
  cs: ChangeSet,
  definition: DefinitionLocation,
): Cursor | null {
  if (!definition.workspaceRelativePath) return null;
  const file = cs.files.find((entry) => entry.path === definition.workspaceRelativePath);
  if (!file) return null;
  for (const hunk of file.hunks) {
    const lineIdx = hunk.lines.findIndex((line) => line.newNo === definition.line + 1);
    if (lineIdx === -1) continue;
    return {
      changesetId: cs.id,
      fileId: file.id,
      hunkId: hunk.id,
      lineIdx,
    };
  }
  return null;
}

function cycleChangeset(
  list: { id: string }[],
  currentId: string,
  delta: number,
): string {
  if (list.length <= 1) return currentId;
  const i = list.findIndex((c) => c.id === currentId);
  const n = list.length;
  return list[(i + delta + n) % n].id;
}

function selectionForStatusBar(
  hunk: { id: string; lines: { oldNo?: number; newNo?: number }[] },
  selection: { hunkId: string; anchor: number; head: number } | null,
): { lo: number; hi: number; loLineNo: number; hiLineNo: number } | null {
  if (!selection || selection.hunkId !== hunk.id) return null;
  const lo = Math.min(selection.anchor, selection.head);
  const hi = Math.max(selection.anchor, selection.head);
  const loLine = hunk.lines[lo];
  const hiLine = hunk.lines[hi];
  return {
    lo,
    hi,
    loLineNo: loLine?.newNo ?? loLine?.oldNo ?? lo + 1,
    hiLineNo: hiLine?.newNo ?? hiLine?.oldNo ?? hi + 1,
  };
}

function buildHelpContext({
  hasSelection,
  lineHasAiNote,
  lineNoteAcked,
  currentFileReadFraction,
  currentFileReviewed,
  showInspector,
}: {
  hasSelection: boolean;
  lineHasAiNote: boolean;
  lineNoteAcked: boolean;
  currentFileReadFraction: number;
  currentFileReviewed: boolean;
  showInspector: boolean;
}) {
  if (hasSelection) {
    return {
      title: "right now: selection active",
      rows: [
        { chord: "c", label: "start a comment on this selection" },
        { chord: "e", label: "run the selected code in the runner" },
        { chord: "/", label: "run a prompt on the selected code" },
        { chord: "Esc", label: "collapse the selection" },
      ],
      hint: "Selection commands are local to the diff. App-wide commands live under ⌘K / ⌃K.",
    };
  }

  if (lineHasAiNote && !lineNoteAcked) {
    return {
      title: "right now: AI note on this line",
      rows: [
        { chord: "a", label: "ack or un-ack the note" },
        { chord: "r", label: "reply to the note" },
        { chord: "c", label: "start your own comment on this line" },
      ],
      hint: "This section changes with context. The table below is still the full key sheet.",
    };
  }

  if (currentFileReadFraction >= 1 && !currentFileReviewed) {
    return {
      title: "right now: file is ready to sign off",
      rows: [
        { chord: "⇧m", label: "mark this file reviewed" },
        { chord: "]/[", label: "move to the next or previous file" },
        { chord: "p", label: "reopen the plan before moving on" },
      ],
      hint: "Signing off is separate from cursor visits. Read marks are automatic; review verdicts are not.",
    };
  }

  return {
    title: "right now: app-level actions",
    rows: [
      { chord: "⌘k/⌃k", label: "open the command palette for app actions" },
      { chord: "p", label: "toggle the review plan" },
      {
        chord: "i",
        label: showInspector ? "hide the inspector" : "reopen the inspector",
      },
      { chord: "⇧l", label: "load a changeset" },
      { chord: "⇧r", label: "open the free code runner" },
    ],
    hint: "Use ? for the full shortcut sheet. Use ⌘K / ⌃K when you want app-level commands instead of diff navigation.",
  };
}

/**
 * Persistent plan summary in the topbar. Shows "plan · X/N" where X is
 * the number of suggested entry-point files the reviewer has signed off
 * on (Shift+M) and N is the total number of entries. Click toggles the
 * plan modal — same gesture as `p`.
 */
function PlanChip({
  isOpen,
  plan,
  reviewedFiles,
  onToggle,
}: {
  isOpen: boolean;
  plan: { entryPoints: { fileId: string }[] } | null;
  reviewedFiles: Set<string>;
  onToggle: () => void;
}) {
  const total = plan?.entryPoints.length ?? 0;
  const done =
    plan?.entryPoints.filter((e) => reviewedFiles.has(e.fileId)).length ?? 0;
  const allDone = total > 0 && done === total;
  return (
    <button
      className={`topbar__btn topbar__btn--plan ${
        isOpen ? "topbar__btn--on" : ""
      } ${allDone ? "topbar__btn--done" : ""}`}
      onClick={onToggle}
      title="open the review plan (p)"
      type="button"
    >
      <span className="topbar__btn-label">
        ◇ plan{total > 0 ? ` · ${done}/${total}` : ""}
      </span>
      <kbd>p</kbd>
    </button>
  );
}
