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
import { buildSymbolIndex } from "./symbols";
import type { Cursor } from "./types";
import { lineNoteReplyKey, userCommentKey } from "./types";

export default function App() {
  const red = useMemo(() => reducer(CHANGESETS), []);
  const [state, dispatch] = useReducer(red, CHANGESETS, (changesets) => {
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
  const [draftingKey, setDraftingKey] = useState<string | null>(null);

  const cs = CHANGESETS.find((c) => c.id === state.cursor.changesetId)!;
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

      if (suggestionRef.current && (e.key === "Enter" || e.key === "y")) {
        const s = suggestionRef.current;
        e.preventDefault();
        dispatch({
          type: "SET_CURSOR",
          cursor: {
            changesetId: state.cursor.changesetId,
            fileId: s.toFileId,
            hunkId: s.toHunkId,
            lineIdx: s.toLineIdx,
          },
        });
        return;
      }
      if (suggestionRef.current && (e.key === "Escape" || e.key === "n")) {
        e.preventDefault();
        dispatch({ type: "DISMISS_GUIDE", guideId: suggestionRef.current.id });
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "MOVE_LINE", delta: 1 });
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          dispatch({ type: "MOVE_LINE", delta: -1 });
          break;
        case "J":
          e.preventDefault();
          dispatch({ type: "MOVE_HUNK", delta: 1 });
          break;
        case "K":
          e.preventDefault();
          dispatch({ type: "MOVE_HUNK", delta: -1 });
          break;
        case "Tab":
          e.preventDefault();
          dispatch({ type: "MOVE_FILE", delta: e.shiftKey ? -1 : 1 });
          break;
        case "?":
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        case "i":
          e.preventDefault();
          setShowInspector((v) => !v);
          break;
        case "a":
          e.preventDefault();
          dispatch({
            type: "TOGGLE_ACK",
            hunkId: state.cursor.hunkId,
            lineIdx: state.cursor.lineIdx,
          });
          break;
        case "r": {
          // open the reply composer for the current line's note if any
          const cline = hunk.lines[state.cursor.lineIdx];
          if (cline?.aiNote) {
            e.preventDefault();
            setDraftingKey(
              lineNoteReplyKey(state.cursor.hunkId, state.cursor.lineIdx),
            );
            setShowInspector(true);
          }
          break;
        }
        case "c":
          e.preventDefault();
          setDraftingKey(
            userCommentKey(state.cursor.hunkId, state.cursor.lineIdx),
          );
          setShowInspector(true);
          break;
        case "Escape":
          if (showHelp) setShowHelp(false);
          break;
        case "[":
          e.preventDefault();
          dispatch({
            type: "SWITCH_CHANGESET",
            changesetId: prevChangeset(state.cursor.changesetId),
          });
          break;
        case "]":
          e.preventDefault();
          dispatch({
            type: "SWITCH_CHANGESET",
            changesetId: nextChangeset(state.cursor.changesetId),
          });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, state.cursor]);

  const coverage = changesetCoverage(cs, state.reviewedLines);

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
      </header>

      <div className={`main ${showInspector ? "main--with-inspector" : ""}`}>
        <Sidebar
          cs={cs}
          state={state}
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
          file={file}
          currentHunkId={hunk.id}
          cursorLineIdx={state.cursor.lineIdx}
          reviewed={state.reviewedLines}
          acked={state.ackedNotes}
          replies={state.replies}
          expandLevelAbove={state.expandLevelAbove}
          expandLevelBelow={state.expandLevelBelow}
          fileFullyExpanded={state.fullExpandedFiles.has(file.id)}
          onSetExpandLevel={(hunkId, dir, level) =>
            dispatch({ type: "SET_EXPAND_LEVEL", hunkId, dir, level })
          }
          onToggleExpandFile={(fileId) =>
            dispatch({ type: "TOGGLE_EXPAND_FILE", fileId })
          }
        />
        {showInspector && (
          <Inspector
            file={file}
            hunk={hunk}
            line={line}
            cursor={state.cursor}
            symbols={symbolIndex}
            acked={state.ackedNotes}
            replies={state.replies}
            draftingKey={draftingKey}
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

      {suggestion && (
        <GuidePrompt
          suggestion={suggestion}
          symbols={symbolIndex}
          onJump={jumpTo}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      <StatusBar
        file={file}
        hunk={hunk}
        cs={cs}
        cursor={state.cursor}
        coverage={coverage}
      />
    </div>
  );
}

function nextChangeset(id: string): string {
  const i = CHANGESETS.findIndex((c) => c.id === id);
  return CHANGESETS[(i + 1) % CHANGESETS.length].id;
}
function prevChangeset(id: string): string {
  const i = CHANGESETS.findIndex((c) => c.id === id);
  return CHANGESETS[(i - 1 + CHANGESETS.length) % CHANGESETS.length].id;
}
