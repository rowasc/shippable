import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./App.css";
import { CHANGESETS } from "./fixtures";
import { initialState, reducer, changesetCoverage } from "./state";
import { maybeSuggest } from "./guide";
import { Sidebar } from "./components/Sidebar";
import { DiffView } from "./components/DiffView";
import { StatusBar } from "./components/StatusBar";
import { GuidePrompt } from "./components/GuidePrompt";
import { HelpOverlay } from "./components/HelpOverlay";
import { Inspector } from "./components/Inspector";
import { LoadModal } from "./components/LoadModal";
import { buildSymbolIndex } from "./symbols";
import type { Cursor } from "./types";
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
    // ?cs=<id> loads a specific sample changeset (not-very-visible testing affordance).
    const initial = initialState(changesets);
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("cs");
    if (!wanted) return initial;
    const target = changesets.find((c) => c.id === wanted);
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
  const [draftingKey, setDraftingKey] = useState<string | null>(null);

  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId)!;
  const line = hunk.lines[state.cursor.lineIdx];
  const symbolIndex = useMemo(() => buildSymbolIndex(cs), [cs]);
  const jumpTo = (c: Cursor) => dispatch({ type: "SET_CURSOR", cursor: c });

  const suggestion = maybeSuggest(cs, state);
  const suggestionRef = useRef(suggestion);
  suggestionRef.current = suggestion;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showHelp && e.key !== "?" && e.key !== "Escape") return;

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
        case "TOGGLE_ACK":
          dispatch({
            type: "TOGGLE_ACK",
            hunkId: state.cursor.hunkId,
            lineIdx: state.cursor.lineIdx,
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
  }, [showHelp, state.cursor, state.changesets, state.selection]);

  const coverage = changesetCoverage(cs, state.reviewedLines);
  const fileIdx = cs.files.findIndex((f) => f.id === file.id);
  const hunkIdx = file.hunks.findIndex((h) => h.id === hunk.id);
  const guideViewModel = suggestion
    ? buildGuidePromptViewModel(suggestion, symbolIndex, cs.id)
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">critica</span>
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
