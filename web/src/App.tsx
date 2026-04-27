import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./App.css";
import { CHANGESETS } from "./fixtures";
import { initialState, reducer, changesetCoverage } from "./state";
import { maybeSuggest } from "./guide";
import { planReview } from "./plan";
import { Sidebar } from "./components/Sidebar";
import { DiffView } from "./components/DiffView";
import { StatusBar } from "./components/StatusBar";
import { GuidePrompt } from "./components/GuidePrompt";
import { HelpOverlay } from "./components/HelpOverlay";
import { Inspector } from "./components/Inspector";
import { LoadModal } from "./components/LoadModal";
import { ReviewPlanView } from "./components/ReviewPlanView";
import { CodeRunner } from "./components/CodeRunner";
import { buildSymbolIndex } from "./symbols";
import type { SymbolIndex } from "./symbols";
import type { ChangeSet, Cursor, EvidenceRef } from "./types";
import { blockCommentKey, lineNoteReplyKey, userCommentKey } from "./types";
import { KEYMAP } from "./keymap";
import {
  buildDiffViewModel,
  buildSidebarViewModel,
  buildStatusBarViewModel,
  buildGuidePromptViewModel,
  buildInspectorViewModel,
} from "./view";

export default function App() {
  const [state, dispatch] = useReducer(reducer, CHANGESETS, (changesets) => {
    // ?cs=<id> (or the short `?c=<n>`) loads a specific sample changeset.
    // Accepts the full id ("cs-09") or the numeric tail ("09" / "9").
    const initial = initialState(changesets);
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("cs") ?? params.get("c");
    if (!wanted) return initial;
    const target = changesets.find(
      (c) => c.id === wanted || c.id === `cs-${wanted}` || c.id.replace(/^cs-/, "") === wanted,
    );
    if (!target) return initial;
    const file = target.files[0];
    const hunk = file.hunks[0];
    return {
      ...initial,
      cursor: { changesetId: target.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 },
    };
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showLoad, setShowLoad] = useState(false);
  // Start with the plan visible so first-time reviewers see the "where to
  // start" view before the diff. They press Enter/click an entry point (or
  // Escape) to dismiss and can press `p` to reopen.
  const [showPlan, setShowPlan] = useState(true);
  const [draftingKey, setDraftingKey] = useState<string | null>(null);

  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId)!;
  const line = hunk.lines[state.cursor.lineIdx];
  const symbolIndex = useMemo(() => buildSymbolIndex(cs), [cs]);
  const plan = useMemo(() => planReview(cs), [cs]);
  const jumpTo = (c: Cursor) => dispatch({ type: "SET_CURSOR", cursor: c });

  const suggestion = maybeSuggest(cs, state);
  const suggestionRef = useRef(suggestion);
  suggestionRef.current = suggestion;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showHelp && e.key !== "?" && e.key !== "Escape") return;
      // While the plan overlay is open, only the keys that toggle/close it
      // or open help reach the app handler. Entry-point clicks still work
      // because those go through the button's own onClick.
      if (showPlan && !["p", "?", "Escape"].includes(e.key)) return;

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
      const currentLine = hunk.lines[state.cursor.lineIdx];
      const predicates: Record<string, boolean> = {
        hasSuggestion: !!suggestionRef.current,
        lineHasAiNote: !!currentLine?.aiNote,
        hasSelection: !!state.selection,
        hasPlan: showPlan,
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

      switch (entry.action) {
        case "MOVE_LINE_DOWN":
          dispatch({ type: "MOVE_LINE", delta: 1 });
          break;
        case "MOVE_LINE_UP":
          dispatch({ type: "MOVE_LINE", delta: -1 });
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
        case "MARK_FILE_REVIEWED":
          dispatch({ type: "MARK_FILE_REVIEWED", fileId: state.cursor.fileId });
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
          const s = suggestionRef.current!;
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
          dispatch({ type: "DISMISS_GUIDE", guideId: suggestionRef.current!.id });
          break;
        case "CLOSE_HELP":
          if (showHelp) setShowHelp(false);
          break;
        case "OPEN_LOAD":
          setShowLoad(true);
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
  }, [showHelp, showPlan, state.cursor, state.changesets, state.selection]);

  const coverage = changesetCoverage(cs, state.reviewedLines);
  const fileIdx = cs.files.findIndex((f) => f.id === file.id);
  const hunkIdx = file.hunks.findIndex((h) => h.id === hunk.id);
  const guideViewModel = suggestion
    ? buildGuidePromptViewModel(suggestion, symbolIndex, cs.id)
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">shippable</span>
        <span className="topbar__sep">│</span>
        <span className="topbar__id">{cs.id}</span>
        <span className="topbar__title">{cs.title}</span>
        <span className="topbar__sep">│</span>
        <span className="topbar__branch">
          {cs.branch} → {cs.base}
        </span>
        <span className="topbar__spacer" />
        <span className="topbar__author">@{cs.author}</span>
        <button
          className="topbar__btn"
          onClick={() => setShowLoad(true)}
          title="load a changeset from URL, file, or paste (shift+L)"
        >
          + load
        </button>
      </header>

      <div className={`main ${showInspector ? "main--with-inspector" : ""}`}>
        <Sidebar
          viewModel={buildSidebarViewModel({
            files: cs.files,
            skills: cs.skills,
            currentFileId: state.cursor.fileId,
            reviewedLines: state.reviewedLines,
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
            reviewed: state.reviewedLines,
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
            onJump={jumpTo}
            onJumpToBlock={(cursor, selection) =>
              dispatch({ type: "SET_CURSOR", cursor, selection })
            }
            onToggleAck={(hunkId, lineIdx) =>
              dispatch({ type: "TOGGLE_ACK", hunkId, lineIdx })
            }
            onStartDraft={(key) => setDraftingKey(key)}
            onCancelDraft={() => setDraftingKey(null)}
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
      <CodeRunner currentFilePath={file.path} />
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
          coverage,
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
