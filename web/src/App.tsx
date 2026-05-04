import { useEffect, useReducer, useRef, useState } from "react";
import "./App.css";
import { CHANGESETS } from "./fixtures";
import { initialState, reducer, changesetCoverage, reviewedFilesCount } from "./state";
import { maybeSuggest } from "./guide";
import { usePlan } from "./usePlan";
import { Sidebar } from "./components/Sidebar";
import { DiffView } from "./components/DiffView";
import { StatusBar } from "./components/StatusBar";
import { GuidePrompt } from "./components/GuidePrompt";
import { HelpOverlay } from "./components/HelpOverlay";
import { Inspector } from "./components/Inspector";
import { KeySetup } from "./components/KeySetup";
import { LoadModal } from "./components/LoadModal";
import { ReviewPlanView } from "./components/ReviewPlanView";
import { CodeRunner } from "./components/CodeRunner";
import { ThemePicker } from "./components/ThemePicker";
import { PromptPicker } from "./components/PromptPicker";
import { type PromptRunView } from "./components/PromptRunsPanel";
import { buildAutoFillContext, type Prompt } from "./promptStore";
import { runPrompt } from "./promptRun";
import { buildSymbolIndex } from "./symbols";
import type { SymbolIndex } from "./symbols";
import type {
  AgentContextSlice,
  AgentSessionRef,
  ChangeSet,
  Cursor,
  EvidenceRef,
  WorktreeSource,
} from "./types";
import { blockCommentKey, lineNoteReplyKey, userCommentKey } from "./types";
import {
  fetchAgentContextForWorktree,
  fetchHookStatus,
  installHook,
  sendInboxMessage,
} from "./agentContextClient";
import { KEYMAP } from "./keymap";
import { clearSession, loadSession, saveSession } from "./persist";
import { useApiKey } from "./useApiKey";
import { useTheme } from "./useTheme";
import {
  buildDiffViewModel,
  buildSidebarViewModel,
  buildStatusBarViewModel,
  buildGuidePromptViewModel,
  buildInspectorViewModel,
} from "./view";

export default function App() {
  const [themeId, setThemeId] = useTheme();
  // Read the persisted session once at boot. We need the result both for
  // the reducer init (state hydration) and for restoring drafts below;
  // calling loadSession twice would re-validate and re-walk the
  // changeset tree, so cache the result in lazy useState.
  const [hydrated] = useState(() => loadSession(CHANGESETS));
  const [state, dispatch] = useReducer(reducer, CHANGESETS, (changesets) => {
    const initial = initialState(changesets);

    // ?cs=<id> (or the short `?c=<n>`) wins over the persisted cursor —
    // a URL param is an explicit "go here" gesture; persistence is
    // background restore.
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("cs") ?? params.get("c");
    if (wanted) {
      const target = changesets.find(
        (c) =>
          c.id === wanted ||
          c.id === `cs-${wanted}` ||
          c.id.replace(/^cs-/, "") === wanted,
      );
      if (target) {
        const file = target.files[0];
        const hunk = file.hunks[0];
        return {
          ...initial,
          cursor: {
            changesetId: target.id,
            fileId: file.id,
            hunkId: hunk.id,
            lineIdx: 0,
          },
        };
      }
    }

    const persisted = hydrated.state;
    if (!persisted) return initial;
    return {
      ...initial,
      cursor: persisted.cursor,
      readLines: persisted.readLines,
      reviewedFiles: persisted.reviewedFiles,
      dismissedGuides: persisted.dismissedGuides,
      ackedNotes: persisted.ackedNotes,
      // initialState seeds replies with SEED_REPLIES; merge those with
      // any user replies/comments the persisted session captured.
      replies: { ...initial.replies, ...persisted.replies },
    };
  });
  const apiKey = useApiKey();
  const [showHelp, setShowHelp] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showLoad, setShowLoad] = useState(false);

  // Agent-context state. The provenance (worktreePath/commitSha/branch)
  // travels on the ChangeSet itself (`cs.worktreeSource`), so it survives
  // page reloads and switching between changesets. The fetched slice and
  // session list stay as plain useState — they're transient and per-cs.
  const [agentSlice, setAgentSlice] = useState<AgentContextSlice | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionRef[]>([]);
  const [pinnedSession, setPinnedSession] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentRefreshTick, setAgentRefreshTick] = useState(0);
  // Hook status is fetched at App mount with retry+backoff. The server's
  // port briefly disappears during `tsx watch` reload windows, so a single
  // attempt can hit ECONNREFUSED and leave the banner stuck in "unknown".
  // After a few retries we give up silently — composer still works.
  const [hookStatus, setHookStatus] = useState<{ installed: boolean } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const tryFetch = () => {
      fetchHookStatus()
        .then((s) => {
          if (!cancelled) setHookStatus(s);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt >= 5) return; // ~31s cumulative, give up
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
  const [freeRunnerOpen, setFreeRunnerOpen] = useState(false);
  // Each press of `e` produces a fresh request with the snippet pulled from
  // the diff cursor (or the active block selection). The tick lets the
  // CodeRunner effect re-trigger on the same source.
  const [runRequest, setRunRequest] = useState<{
    tick: number;
    source: string;
  } | null>(null);
  // Start with the plan visible so first-time reviewers see the "where to
  // start" view before the diff. They press Enter/click an entry point (or
  // Escape) to dismiss and can press `p` to reopen.
  const [showPlan, setShowPlan] = useState(true);
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  // Composer drafts persist across open/close. Closing the composer
  // (Esc or the close button) leaves the entry intact, so reopening
  // restores the in-progress text. Submitting clears the entry.
  // Hydrated from localStorage on boot (see `hydrated` above).
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => hydrated.drafts,
  );
  const [showPicker, setShowPicker] = useState(false);
  const [runs, setRuns] = useState<PromptRunView[]>([]);
  const [sidebarWide, setSidebarWide] = useState(false);

  // Debounced session save. Every state/drafts change schedules a write
  // 300ms out; rapid edits coalesce so j/k navigation doesn't thrash
  // localStorage. The effect cleanup cancels a pending write when the
  // dependencies change again before the timer fires.
  useEffect(() => {
    const t = window.setTimeout(() => saveSession(state, drafts), 300);
    return () => window.clearTimeout(t);
  }, [state, drafts]);
  // One AbortController per in-flight run, keyed by run id. Lives in a ref
  // so we can abort without re-rendering and so prior runs survive when a
  // new run starts.
  const runControllersRef = useRef<Map<string, AbortController>>(new Map());

  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId)!;
  const line = hunk.lines[state.cursor.lineIdx];
  const symbolIndex = buildSymbolIndex(cs);

  // The agent-context panel only renders when the active changeset is the
  // one we just loaded from a worktree. Switching back to a fixture or to
  // an older changeset hides the panel — we don't try to remember sources
  // across changeset switches.
  // Provenance comes straight off the active ChangeSet. When the cursor
  // moves to a fixture (no worktreeSource), the panel hides automatically.
  const activeWorktreeSource: WorktreeSource | null = cs.worktreeSource ?? null;
  const wtPath = activeWorktreeSource?.worktreePath ?? null;
  const wtSha = activeWorktreeSource?.commitSha ?? null;
  const wantedFetchKey =
    wtPath && wtSha
      ? `${wtPath}|${wtSha}|${pinnedSession ?? ""}|${agentRefreshTick}`
      : null;

  // "Adjusting state during render" pattern (mirrors usePlan in this repo):
  // when the fetch key transitions, flip loading/error synchronously here
  // so the effect body itself stays free of sync setState.
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
    // wtPath/wtSha/pinnedSession are folded into wantedFetchKey; depending
    // on the key alone is what we want.
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showHelp && e.key !== "?" && e.key !== "Escape") return;
      // While the plan overlay is open, only the keys that toggle/close it
      // or open help reach the app handler. Entry-point clicks still work
      // because those go through the button's own onClick.
      if (showPlan && !["p", "?", "Escape"].includes(e.key)) return;
      // Picker overlay swallows everything except Escape; the picker handles
      // its own internal input focus.
      if (showPicker && e.key !== "Escape") return;

      // Let the browser own keys while the user has a text selection or is
      // typing into an input/textarea — don't steal shift+arrow, cmd+c, etc.
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
      // Tab is also the browser's focus traversal key. When focus is on a
      // button (topbar/sidebar), Tab should move focus naturally — not
      // hop files. Constrain Tab handling to "focus is on body".
      if (e.key === "Tab" && tgt && tgt !== document.body) return;

      // Evaluate runtime predicates once so keymap entries can reference them.
      const predicates: Record<string, boolean> = {
        hasSuggestion: !!suggestion,
        lineHasAiNote: !!line?.aiNote,
        hasSelection: !!state.selection,
        hasPlan: showPlan,
        hasPicker: showPicker,
      };

      // Find the matching keymap entry (key + optional shift requirement +
      // optional context predicate).
      const entry = KEYMAP.find(
        (km) =>
          km.key === e.key &&
          (km.shift === undefined ? true : km.shift === e.shiftKey) &&
          (km.when === undefined ? true : predicates[km.when]),
      );

      if (!entry) return;

      e.preventDefault();

      // Block-comment drafts pin the selection across same-hunk moves so
      // the reviewer can scroll back through the range they're commenting
      // on without losing the visual cue.
      const preserveSelection =
        draftingKey?.startsWith("block:") ?? false;

      switch (entry.action) {
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
          dispatch({ type: "TOGGLE_FILE_REVIEWED", fileId: state.cursor.fileId });
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
          const s = suggestion!;
          dispatch({
            type: "SET_CURSOR",
            cursor: {
              changesetId: state.cursor.changesetId,
              fileId: s.toFileId,
              hunkId: s.toHunkId,
              lineIdx: s.toLineIdx,
            },
          });
          break;
        }
        case "DISMISS_GUIDE":
          dispatch({ type: "DISMISS_GUIDE", guideId: suggestion!.id });
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
        case "RUN_SELECTION": {
          // Pull the snippet from diff state, not window.getSelection — the
          // gesture is keyboard-driven. If the reviewer has a same-hunk
          // block selection, use those lines; otherwise fall back to the
          // current hunk so a single-line cursor still has runnable
          // context. Drop deletion (`-`) lines: they don't exist in the
          // post-change file.
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
            changesetId: cycleChangeset(state.changesets, state.cursor.changesetId, -1),
          });
          break;
        case "NEXT_CHANGESET":
          dispatch({
            type: "SWITCH_CHANGESET",
            changesetId: cycleChangeset(state.changesets, state.cursor.changesetId, 1),
          });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, showPlan, showPicker, state.cursor, state.changesets, state.selection, suggestion, line, draftingKey, hunk.id, hunk.lines]);

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
    // New runs go to the top so the most recent is most visible.
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
        onText: (chunk) =>
          patchRun((r) => ({ ...r, text: r.text + chunk })),
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
          onToggle={() => setShowPlan((v) => !v)}
        />
        <span className="topbar__sep">│</span>
        <span className="topbar__branch">
          {cs.branch} → {cs.base}
        </span>
        <span className="topbar__spacer" />
        <span className="topbar__author">@{cs.author}</span>
        <ThemePicker value={themeId} onChange={setThemeId} />
        <button
          className="topbar__btn"
          onClick={() => setFreeRunnerOpen(true)}
          title="open a free code runner — type or paste a snippet (shift+R)"
        >
          ▷ run
        </button>
        <button
          className="topbar__btn"
          onClick={() => setShowLoad(true)}
          title="load a changeset from URL, file, or paste (shift+L)"
        >
          + load
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
        />
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
              dispatch({
                type: "ADD_REPLY",
                targetKey: key,
                reply: {
                  id: `r-${Date.now()}`,
                  author: "you",
                  body,
                  createdAt: new Date().toISOString(),
                },
              });
              setDrafts((prev) => {
                if (!(key in prev)) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setDraftingKey(null);
            }}
            onDeleteReply={(key, replyId) =>
              dispatch({ type: "DELETE_REPLY", targetKey: key, replyId })
            }
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
                    hookStatus,
                    worktreePath: activeWorktreeSource.worktreePath,
                    onPickSession: (fp) => setPinnedSession(fp),
                    onRefresh: () => setAgentRefreshTick((t) => t + 1),
                    onSendToAgent: async (message) => {
                      await sendInboxMessage({
                        worktreePath: activeWorktreeSource.worktreePath,
                        message,
                      });
                    },
                    onInstallHook: async () => {
                      const r = await installHook();
                      // Refresh banner state without waiting on a reload.
                      setHookStatus({ installed: true });
                      return {
                        didModify: r.didModify,
                        backupPath: r.backupPath,
                      };
                    },
                  }
                : undefined
            }
          />
        )}
      </div>

      {guideViewModel && (
        <GuidePrompt
          viewModel={guideViewModel}
          onJump={jumpTo}
        />
      )}
      {showPlan && (
        <div
          className="planview-overlay"
          onClick={() => setShowPlan(false)}
        >
          <div
            className="planview-overlay__box"
            onClick={(e) => e.stopPropagation()}
          >
            <ReviewPlanView
              plan={plan}
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
      {(apiKey.status.kind === "missing" ||
        apiKey.status.kind === "saved-pending-restart") && (
        <KeySetup
          onSave={apiKey.save}
          onSkip={apiKey.skip}
          saved={apiKey.status.kind === "saved-pending-restart"}
        />
      )}
      {showPicker && (
        <PromptPicker
          context={buildAutoFillContext(cs, file, hunk, state.selection)}
          onClose={() => setShowPicker(false)}
          onSubmit={(prompt, rendered) => startPromptRun(prompt, rendered)}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showLoad && (
        <LoadModal
          onClose={() => setShowLoad(false)}
          onLoad={(newCs) => {
            dispatch({ type: "LOAD_CHANGESET", changeset: newCs });
            // Clear any prior slice/sessions so the new load never briefly
            // shows the previous worktree's transcript while the fetch runs.
            // Provenance lives on cs.worktreeSource and is read directly.
            setPinnedSession(null);
            setAgentSlice(null);
            setAgentSessions([]);
            setAgentError(null);
            setShowLoad(false);
          }}
        />
      )}
      <StatusBar
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
        })}
      />
    </div>
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

/**
 * Resolve the active selection into the line-number range the StatusBar
 * needs. Returns null when there's no selection or it doesn't match the
 * current hunk (defensive — shouldn't happen, but cheaper than throwing).
 */
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
  plan: { entryPoints: { fileId: string }[] };
  reviewedFiles: Set<string>;
  onToggle: () => void;
}) {
  const total = plan.entryPoints.length;
  const done = plan.entryPoints.filter((e) => reviewedFiles.has(e.fileId)).length;
  const allDone = total > 0 && done === total;
  return (
    <button
      className={`topbar__btn topbar__btn--plan ${
        isOpen ? "topbar__btn--on" : ""
      } ${allDone ? "topbar__btn--done" : ""}`}
      onClick={onToggle}
      title="open the review plan (p)"
    >
      ◇ plan{total > 0 ? ` · ${done}/${total}` : ""}
    </button>
  );
}

