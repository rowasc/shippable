import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import { changesetCoverage, fileCoverage, reviewedFilesCount } from "../state";
import type { Action } from "../state";
import { maybeSuggest } from "../guide";
import { usePlan } from "../usePlan";
import { Sidebar } from "./Sidebar";
import { DiffView } from "./DiffView";
import { StatusBar } from "./StatusBar";
import { GuidePrompt } from "./GuidePrompt";
import { HelpOverlay } from "./HelpOverlay";
import { Inspector } from "./Inspector";
import { KeySetup } from "./KeySetup";
import { LoadModal } from "./LoadModal";
import { ReviewPlanView } from "./ReviewPlanView";
import { CodeRunner } from "./CodeRunner";
import { ThemePicker } from "./ThemePicker";
import { PromptPicker } from "./PromptPicker";
import { type PromptRunView } from "./PromptRunsPanel";
import { buildAutoFillContext, type Prompt } from "../promptStore";
import { runPrompt } from "../promptRun";
import { buildSymbolIndex } from "../symbols";
import type { SymbolIndex } from "../symbols";
import type {
  ChangeSet,
  Cursor,
  EvidenceRef,
  ReviewState,
  Reply,
} from "../types";
import { blockCommentKey, lineNoteReplyKey, noteKey, userCommentKey } from "../types";
import { KEYMAP } from "../keymap";
import { clearSession } from "../persist";
import { useApiKey } from "../useApiKey";
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
}

export function ReviewWorkspace({
  state,
  dispatch,
  drafts,
  setDrafts,
  themeId,
  setThemeId,
  onLoadChangeset,
}: Props) {
  const apiKey = useApiKey();
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
  const [runs, setRuns] = useState<PromptRunView[]>([]);
  const [sidebarWide, setSidebarWide] = useState(false);

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
      if (showPlan && !["p", "?", "Escape"].includes(e.key)) return;
      if (showPicker && e.key !== "Escape") return;

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

      const predicates: Record<string, boolean> = {
        hasSuggestion: !!suggestion,
        lineHasAiNote: !!line?.aiNote,
        hasSelection: !!state.selection,
        hasPlan: showPlan,
        hasPicker: showPicker,
      };

      const entry = KEYMAP.find(
        (km) =>
          km.key === e.key &&
          (km.shift === undefined ? true : km.shift === e.shiftKey) &&
          (km.when === undefined ? true : predicates[km.when]),
      );

      if (!entry) return;

      e.preventDefault();

      const preserveSelection = draftingKey?.startsWith("block:") ?? false;

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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    showHelp,
    showPlan,
    showPicker,
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
            // LoadModal currently only knows the parsed ChangeSet — no
            // source metadata. Tag as a "paste" so it still lands in
            // recents; it's a reasonable approximation for the prototype.
            onLoadChangeset(newCs, {}, { kind: "paste" });
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
          lineHasAiNote: !!line?.aiNote,
          lineNoteAcked: state.ackedNotes.has(
            noteKey(state.cursor.hunkId, state.cursor.lineIdx),
          ),
          currentFileReadFraction: fileCoverage(file, state.readLines),
          currentFileReviewed: state.reviewedFiles.has(file.id),
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
  const done = plan.entryPoints.filter((e) =>
    reviewedFiles.has(e.fileId),
  ).length;
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
