import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./App.css";
import { PRS } from "./fixtures";
import { initialState, reducer, prCoverage } from "./state";
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
  const red = useMemo(() => reducer(PRS), []);
  const [state, dispatch] = useReducer(red, PRS, (prs) => {
    // ?pr=<id> loads a specific sample PR (not-very-visible testing affordance).
    const initial = initialState(prs);
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("pr");
    if (!wanted) return initial;
    const target = prs.find((p) => p.id === wanted);
    if (!target) return initial;
    const file = target.files[0];
    const hunk = file.hunks[0];
    return {
      ...initial,
      cursor: { prId: target.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 },
    };
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [draftingKey, setDraftingKey] = useState<string | null>(null);

  const pr = PRS.find((p) => p.id === state.cursor.prId)!;
  const file = pr.files.find((f) => f.id === state.cursor.fileId)!;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId)!;
  const line = hunk.lines[state.cursor.lineIdx];
  const symbolIndex = useMemo(() => buildSymbolIndex(pr), [pr]);
  const jumpTo = (c: Cursor) => dispatch({ type: "SET_CURSOR", cursor: c });

  const suggestion = maybeSuggest(pr, state);
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
            prId: state.cursor.prId,
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
          dispatch({ type: "SWITCH_PR", prId: prevPr(state.cursor.prId) });
          break;
        case "]":
          e.preventDefault();
          dispatch({ type: "SWITCH_PR", prId: nextPr(state.cursor.prId) });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, state.cursor]);

  const coverage = prCoverage(pr, state.reviewedLines);

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__brand">critica</span>
        <span className="topbar__sep">│</span>
        <span className="topbar__pr">{pr.id}</span>
        <span className="topbar__title">{pr.title}</span>
        <span className="topbar__sep">│</span>
        <span className="topbar__branch">
          {pr.branch} → {pr.base}
        </span>
        <span className="topbar__spacer" />
        <span className="topbar__author">@{pr.author}</span>
      </header>

      <div className={`main ${showInspector ? "main--with-inspector" : ""}`}>
        <Sidebar
          pr={pr}
          state={state}
          onPickFile={(fileId) => {
            const f = pr.files.find((ff) => ff.id === fileId)!;
            dispatch({
              type: "SET_CURSOR",
              cursor: {
                prId: pr.id,
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
        pr={pr}
        cursor={state.cursor}
        coverage={coverage}
      />
    </div>
  );
}

function nextPr(id: string): string {
  const i = PRS.findIndex((p) => p.id === id);
  return PRS[(i + 1) % PRS.length].id;
}
function prevPr(id: string): string {
  const i = PRS.findIndex((p) => p.id === id);
  return PRS[(i - 1 + PRS.length) % PRS.length].id;
}
