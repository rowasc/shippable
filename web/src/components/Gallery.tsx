import "./Gallery.css";
import { useState, useReducer, useCallback } from "react";
import { DiffView } from "./DiffView";
import { ReviewPlanView } from "./ReviewPlanView";
import { reducer } from "../state";
import { buildDiffViewModel } from "../view";
import { ALL_FIXTURES } from "../gallery-fixtures";
import type {
  DiffGalleryFixture,
  GalleryFixture,
  PlanGalleryFixture,
} from "../gallery-fixtures";
import type { EvidenceRef } from "../types";

export function Gallery() {
  const [selected, setSelected] = useState<GalleryFixture>(ALL_FIXTURES[0]);
  const [lastNav, setLastNav] = useState<EvidenceRef | null>(null);

  // Clear the nav indicator when switching fixtures — stale info from a
  // previous screen would be misleading.
  const chooseFixture = (f: GalleryFixture) => {
    setSelected(f);
    setLastNav(null);
  };

  return (
    <div className="gallery">
      <nav className="gallery__nav">
        <div className="gallery__brand">
          <span className="gallery__brand-name">critica</span>
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
          {lastNav && (
            <span className="gallery__topbar-nav">
              → navigated: {describeNav(lastNav)}
            </span>
          )}
        </header>
        <div className="gallery__stage">
          <div className="gallery__stage-inner">
            <GalleryItem
              key={selected.name}
              fixture={selected}
              onNavigate={setLastNav}
            />
          </div>
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
        reviewed: itemState.reviewedLines,
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
