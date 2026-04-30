import "./Gallery.css";
import { useState, useReducer, useCallback, useEffect, useMemo } from "react";
import { DiffView } from "./DiffView";
import { ReviewPlanView } from "./ReviewPlanView";
import { SyntaxShowcase } from "./SyntaxShowcase";
import { ThemePicker } from "./ThemePicker";
import { reducer } from "../state";
import { buildDiffViewModel } from "../view";
import { ALL_FIXTURES } from "../gallery-fixtures";
import { useTheme } from "../useTheme";
import {
  DEMO_SCRIPT,
  DEFAULT_FRAME_DURATION_MS,
  type DemoFrame,
} from "../demo-script";
import type {
  DiffGalleryFixture,
  GalleryFixture,
  PlanGalleryFixture,
  SyntaxGalleryFixture,
} from "../gallery-fixtures";
import type { EvidenceRef } from "../types";

/**
 * Resolve every entry in DEMO_SCRIPT to its fixture once. Drops any frame whose
 * fixture name doesn't exist (so a typo in the script doesn't crash the
 * gallery).
 */
function resolveScript(): { frame: DemoFrame; fixture: GalleryFixture }[] {
  const byName = new Map(ALL_FIXTURES.map((f) => [f.name, f]));
  const out: { frame: DemoFrame; fixture: GalleryFixture }[] = [];
  for (const frame of DEMO_SCRIPT) {
    const fixture = byName.get(frame.fixtureName);
    if (fixture) out.push({ frame, fixture });
  }
  return out;
}

export function Gallery() {
  const [themeId, setThemeId] = useTheme();
  const [selected, setSelected] = useState<GalleryFixture>(ALL_FIXTURES[0]);
  const [lastNav, setLastNav] = useState<EvidenceRef | null>(null);

  // Play mode state.
  const script = useMemo(resolveScript, []);
  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [hovering, setHovering] = useState(false);

  // Clear the nav indicator when switching fixtures — stale info from a
  // previous screen would be misleading.
  const chooseFixture = (f: GalleryFixture) => {
    setSelected(f);
    setLastNav(null);
    // Manual nav exits play mode but keeps the user's place in the catalog.
    setPlaying(false);
  };

  // Apply the active script frame: switch to its fixture and (if set) theme.
  // We deliberately do NOT reset the theme between frames — if frame N+1 has
  // no themeId, the theme from frame N stays in place.
  useEffect(() => {
    if (!playing) return;
    const entry = script[frameIdx];
    if (!entry) return;
    setSelected(entry.fixture);
    setLastNav(null);
    if (entry.frame.themeId) {
      setThemeId(entry.frame.themeId);
    }
  }, [playing, frameIdx, script, setThemeId]);

  // Auto-advance timer. Pauses on hover.
  useEffect(() => {
    if (!playing || hovering || script.length === 0) return;
    const entry = script[frameIdx];
    const duration = entry?.frame.durationMs ?? DEFAULT_FRAME_DURATION_MS;
    const id = window.setTimeout(() => {
      setFrameIdx((i) => (i + 1) % script.length);
    }, duration);
    return () => window.clearTimeout(id);
  }, [playing, hovering, frameIdx, script]);

  const startOrTogglePlay = () => {
    if (script.length === 0) return;
    if (!playing) {
      // When entering play mode, snap to the current frame's fixture/theme so
      // the first frame renders immediately — the effect above will pick it up.
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  };

  const goPrev = () => {
    if (script.length === 0) return;
    setFrameIdx((i) => (i - 1 + script.length) % script.length);
    if (!playing) setPlaying(true);
  };

  const goNext = () => {
    if (script.length === 0) return;
    setFrameIdx((i) => (i + 1) % script.length);
    if (!playing) setPlaying(true);
  };

  const currentEntry = playing ? script[frameIdx] : null;
  const currentCaption = currentEntry?.frame.caption ?? null;

  return (
    <div className="gallery">
      <nav className="gallery__nav">
        <div className="gallery__brand">
          <span className="gallery__brand-name">shippable</span>
          <span className="gallery__brand-sep">│</span>
          <span className="gallery__brand-label">screen catalog</span>
        </div>
        <ul className="gallery__list">
          {ALL_FIXTURES.map((f) => (
            <li key={f.name}>
              <button
                className={
                  "gallery__item" +
                  (selected.name === f.name ? " gallery__item--active" : "")
                }
                onClick={() => chooseFixture(f)}
              >
                <div className="gallery__item-name">{f.name}</div>
                <div className="gallery__item-desc">{f.description}</div>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="gallery__main">
        <header className="gallery__topbar">
          <span className="gallery__topbar-name">{selected.name}</span>
          <span className="gallery__topbar-sep">│</span>
          <span className="gallery__topbar-desc">{selected.description}</span>
          <span className="gallery__topbar-spacer" />
          <div className="gallery__play" role="group" aria-label="Demo playback">
            <button
              type="button"
              className="gallery__play-btn"
              onClick={goPrev}
              disabled={script.length === 0}
              title="Previous frame"
              aria-label="Previous frame"
            >
              ◀ prev
            </button>
            <button
              type="button"
              className={
                "gallery__play-btn gallery__play-btn--primary" +
                (playing ? " gallery__play-btn--active" : "")
              }
              onClick={startOrTogglePlay}
              disabled={script.length === 0}
              title={playing ? "Pause demo" : "Play demo"}
              aria-pressed={playing}
            >
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              type="button"
              className="gallery__play-btn"
              onClick={goNext}
              disabled={script.length === 0}
              title="Next frame"
              aria-label="Next frame"
            >
              next ▶
            </button>
            <span className="gallery__play-counter">
              {script.length === 0
                ? "0 / 0"
                : `${frameIdx + 1} / ${script.length}`}
            </span>
          </div>
          <ThemePicker value={themeId} onChange={setThemeId} />
          {lastNav && (
            <span className="gallery__topbar-nav">
              → navigated: {describeNav(lastNav)}
            </span>
          )}
        </header>
        <div
          className="gallery__stage"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <div className="gallery__stage-inner">
            <GalleryItem
              key={selected.name}
              fixture={selected}
              onNavigate={setLastNav}
            />
          </div>
          {currentCaption && (
            <div
              className={
                "gallery__caption" +
                (hovering ? " gallery__caption--paused" : "")
              }
              role="status"
              aria-live="polite"
            >
              <span className="gallery__caption-text">{currentCaption}</span>
              {hovering && (
                <span className="gallery__caption-hint">paused</span>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function describeNav(ev: EvidenceRef): string {
  switch (ev.kind) {
    case "description":
      return "description";
    case "file":
      return ev.path;
    case "hunk":
      return ev.hunkId;
    case "symbol":
      return `${ev.name} (in ${ev.definedIn})`;
  }
}

function GalleryItem({
  fixture,
  onNavigate,
}: {
  fixture: GalleryFixture;
  onNavigate: (ev: EvidenceRef) => void;
}) {
  if (fixture.kind === "plan") {
    return <PlanGalleryItem fixture={fixture} onNavigate={onNavigate} />;
  }
  if (fixture.kind === "syntax") {
    return <SyntaxGalleryItem fixture={fixture} />;
  }
  return <DiffGalleryItem fixture={fixture} />;
}

function PlanGalleryItem({
  fixture,
  onNavigate,
}: {
  fixture: PlanGalleryFixture;
  onNavigate: (ev: EvidenceRef) => void;
}) {
  return <ReviewPlanView plan={fixture.plan} onNavigate={onNavigate} />;
}

function DiffGalleryItem({ fixture }: { fixture: DiffGalleryFixture }) {
  const cs = fixture.state.changesets.find(
    (c) => c.id === fixture.state.cursor.changesetId,
  )!;
  const file = cs.files.find((f) => f.id === fixture.fileId)!;
  const hunk = file.hunks.find((h) => h.id === fixture.hunkId)!;

  const [itemState, dispatch] = useReducer(reducer, fixture.state);

  const handleSetExpandLevel = useCallback(
    (hunkId: string, dir: "above" | "below", level: number) =>
      dispatch({ type: "SET_EXPAND_LEVEL", hunkId, dir, level }),
    [],
  );

  const handleToggleExpandFile = useCallback(
    (fileId: string) => dispatch({ type: "TOGGLE_EXPAND_FILE", fileId }),
    [],
  );

  return (
    <DiffView
      viewModel={buildDiffViewModel({
        file,
        currentHunkId: hunk.id,
        cursorLineIdx:
          itemState.cursor.hunkId === hunk.id
            ? itemState.cursor.lineIdx
            : fixture.cursorLineIdx,
        read: itemState.readLines,
        isFileReviewed: itemState.reviewedFiles.has(file.id),
        acked: itemState.ackedNotes,
        replies: itemState.replies,
        expandLevelAbove: itemState.expandLevelAbove,
        expandLevelBelow: itemState.expandLevelBelow,
        fileFullyExpanded: itemState.fullExpandedFiles.has(file.id),
        selection: itemState.selection,
      })}
      onSetExpandLevel={handleSetExpandLevel}
      onToggleExpandFile={handleToggleExpandFile}
    />
  );
}

function SyntaxGalleryItem({ fixture }: { fixture: SyntaxGalleryFixture }) {
  return <SyntaxShowcase snippets={fixture.snippets} />;
}
