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
import { PromptResultsStack, type PromptRunView } from "./components/PromptResult";
import { buildAutoFillContext, type Prompt } from "./promptStore";
import { runPrompt } from "./promptRun";
import { buildSymbolIndex } from "./symbols";
import type { SymbolIndex } from "./symbols";
import type { ChangeSet, Cursor, EvidenceRef } from "./types";
import { blockCommentKey, lineNoteReplyKey, userCommentKey } from "./types";
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
  // changeset tree, so cache the result in a ref.
  const hydratedRef = useRef(loadSession(CHANGESETS));
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

    const hydrated = hydratedRef.current.state;
    if (!hydrated) return initial;
    return {
      ...initial,
      cursor: hydrated.cursor,
      readLines: hydrated.readLines,
      reviewedFiles: hydrated.reviewedFiles,
      dismissedGuides: hydrated.dismissedGuides,
      activeSkills: hydrated.activeSkills,
      ackedNotes: hydrated.ackedNotes,
      // initialState seeds replies with SEED_REPLIES; merge those with
      // any user replies/comments the persisted session captured.
      replies: { ...initial.replies, ...hydrated.replies },
    };
  });
  const apiKey = useApiKey();
  const [showHelp, setShowHelp] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showLoad, setShowLoad] = useState(false);
  const [freeRunnerOpen, setFreeRunnerOpen] = useState(false);
  // Counter that ticks each time the user presses `e` to run the current
  // selection. CodeRunner reads window.getSelection on the change.
  const [selectionRunTrigger, setSelectionRunTrigger] = useState(0);
  // Start with the plan visible so first-time reviewers see the "where to
  // start" view before the diff. They press Enter/click an entry point (or
  // Escape) to dismiss and can press `p` to reopen.
  const [showPlan, setShowPlan] = useState(true);
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  // Composer drafts persist across open/close. Closing the composer
  // (Esc or the close button) leaves the entry intact, so reopening
  // restores the in-progress text. Submitting clears the entry.
  // Hydrated from localStorage on boot (see hydratedRef above).
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => hydratedRef.current.drafts,
  );
  const [showPicker, setShowPicker] = useState(false);
  const [runs, setRuns] = useState<PromptRunView[]>([]);

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
        case "RUN_SELECTION":
          setSelectionRunTrigger((t) => t + 1);
          break;
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
  }, [showHelp, showPlan, showPicker, state.cursor, state.changesets, state.selection, suggestion, line]);

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
        <AiPlanButton
          status={planStatus}
          onGenerate={generatePlan}
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

      <div className={`main ${showInspector ? "main--with-inspector" : ""}`}>
        <Sidebar
          viewModel={buildSidebarViewModel({
            files: cs.files,
            skills: cs.skills,
            currentFileId: state.cursor.fileId,
            readLines: state.readLines,
            reviewedFiles: state.reviewedFiles,
            activeSkills: state.activeSkills,
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
          onToggleSkill={(id) => dispatch({ type: "TOGGLE_SKILL", skillId: id })}
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
            selection: state.selection,
          })}
          onSetExpandLevel={(hunkId, dir, level) =>
            dispatch({ type: "SET_EXPAND_LEVEL", hunkId, dir, level })
          }
          onToggleExpandFile={(fileId) =>
            dispatch({ type: "TOGGLE_EXPAND_FILE", fileId })
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
        selectionRunTrigger={selectionRunTrigger}
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
      <PromptResultsStack runs={runs} onClose={closePromptRun} />
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showLoad && (
        <LoadModal
          onClose={() => setShowLoad(false)}
          onLoad={(newCs) => {
            dispatch({ type: "LOAD_CHANGESET", changeset: newCs });
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

/**
 * Persistent AI-plan trigger. Replaces the modal-only "Send to Claude"
 * button so the reviewer doesn't have to reopen the plan to discover
 * the option. Status is mirrored from usePlan: idle → clickable; loading
 * → disabled with ellipsis; ready → checkmark, disabled (we already have
 * the AI plan); fallback → clickable retry.
 */
function AiPlanButton({
  status,
  onGenerate,
}: {
  status: "idle" | "loading" | "ready" | "fallback";
  onGenerate: () => void;
}) {
  const label =
    status === "loading"
      ? "✦ ai…"
      : status === "ready"
        ? "✦ ai ✓"
        : status === "fallback"
          ? "✦ ai retry"
          : "✦ ai plan";
  const disabled = status === "loading" || status === "ready";
  const title =
    status === "ready"
      ? "AI plan loaded — switch changesets to regenerate"
      : status === "loading"
        ? "Claude is reading the diff…"
        : "Send the diff to Claude for a richer plan. The diff will leave your machine.";
  return (
    <button
      className={`topbar__btn topbar__btn--ai topbar__btn--ai-${status}`}
      onClick={onGenerate}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}
