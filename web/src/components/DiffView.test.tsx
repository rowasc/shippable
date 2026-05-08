// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView";
import type { DiffViewModel } from "../view";

vi.mock("../highlight", () => ({
  highlightLines: vi.fn(async (lines: string[], language?: string) => ({
    language: language ?? "text",
    lines: lines.map((_line, i) => (
      <span
        key={i}
        className="shiki-token shiki-token--symbol"
        data-symbol="loadPrefs"
        data-token-col={7}
        role="button"
        tabIndex={0}
      >
        loadPrefs
      </span>
    )),
  })),
}));

// jsdom does not implement these methods on Element; the DiffView's
// scroll-on-cursor effect and the gutter pointer-capture path both poke
// them, so we install no-op stubs to keep the test environment quiet.
beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

afterEach(cleanup);

describe("DiffView symbol navigation", () => {
  it("calls onSymbolClick when a highlighted symbol is clicked", async () => {
    const onSymbolClick = vi.fn();

    render(
      <DiffView
        viewModel={fixtureViewModel()}
        onSetExpandLevel={() => undefined}
        onToggleExpandFile={() => undefined}
        onTogglePreviewFile={() => undefined}
        clickableSymbols={new Set(["loadPrefs"])}
        onSymbolClick={onSymbolClick}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "loadPrefs" }));

    expect(onSymbolClick).toHaveBeenCalledWith({
      symbol: "loadPrefs",
      file: "src/preferences.ts",
      language: "typescript",
      line: 0,
      col: 7,
    });
  });

  it("symbol click does not fire onLineFocus or open the context menu", async () => {
    const onLineFocus = vi.fn();
    const onLineContextMenu = vi.fn();
    const onSymbolClick = vi.fn();

    render(
      <DiffView
        viewModel={fixtureViewModel()}
        onSetExpandLevel={() => undefined}
        onToggleExpandFile={() => undefined}
        onTogglePreviewFile={() => undefined}
        clickableSymbols={new Set(["loadPrefs"])}
        onSymbolClick={onSymbolClick}
        onLineFocus={onLineFocus}
        onLineContextMenu={onLineContextMenu}
      />,
    );

    const token = await screen.findByRole("button", { name: "loadPrefs" });
    fireEvent.pointerDown(token, { button: 0 });
    fireEvent.click(token);

    expect(onSymbolClick).toHaveBeenCalled();
    expect(onLineFocus).not.toHaveBeenCalled();
    expect(onLineContextMenu).not.toHaveBeenCalled();
  });
});

describe("DiffView line interactions", () => {
  function multiLineViewModel(): DiffViewModel {
    return {
      path: "src/multi.ts",
      language: "typescript",
      status: "modified",
      fileId: "file-multi",
      isFileReviewed: false,
      canExpandFile: false,
      fileFullyExpanded: false,
      fullFileLines: [],
      filePreviewing: false,
      canPreview: false,
      previewSource: "",
      hunks: [
        {
          id: "hunk-A",
          header: "@@ -1,3 +1,3 @@",
          coverage: 0,
          isCurrent: true,
          aiReviewed: false,
          definesSymbols: [],
          referencesSymbols: [],
          contextAbove: [],
          contextBelow: [],
          lines: [
            {
              kind: "add",
              text: "alpha;",
              newNo: 1,
              isCursor: true,
              isRead: false,
              isSelected: false,
              isAcked: false,
              hasUserComment: false,
              aiGlyph: " ",
            },
            {
              kind: "add",
              text: "beta;",
              newNo: 2,
              isCursor: false,
              isRead: false,
              isSelected: false,
              isAcked: false,
              hasUserComment: false,
              aiGlyph: " ",
            },
            {
              kind: "add",
              text: "gamma;",
              newNo: 3,
              isCursor: false,
              isRead: false,
              isSelected: false,
              isAcked: false,
              hasUserComment: false,
              aiGlyph: " ",
            },
          ],
        },
        {
          id: "hunk-B",
          header: "@@ -10,1 +10,1 @@",
          coverage: 0,
          isCurrent: false,
          aiReviewed: false,
          definesSymbols: [],
          referencesSymbols: [],
          contextAbove: [],
          contextBelow: [],
          lines: [
            {
              kind: "context",
              text: "later;",
              newNo: 10,
              oldNo: 10,
              isCursor: false,
              isRead: false,
              isSelected: false,
              isAcked: false,
              hasUserComment: false,
              aiGlyph: " ",
            },
          ],
        },
      ],
    };
  }

  type DiffViewHandlers = Pick<
    React.ComponentProps<typeof DiffView>,
    "onLineFocus" | "onLineSelectRange" | "onLineCharSelect" | "onLineContextMenu"
  >;

  function renderMulti(handlers: DiffViewHandlers) {
    return render(
      <DiffView
        viewModel={multiLineViewModel()}
        onSetExpandLevel={() => undefined}
        onToggleExpandFile={() => undefined}
        onTogglePreviewFile={() => undefined}
        {...handlers}
      />,
    );
  }

  function lineGutter(container: HTMLElement, hunkId: string, lineIdx: number): HTMLElement {
    const hunk = container.querySelector(`[data-hunk-id="${hunkId}"]`);
    if (!hunk) throw new Error(`hunk ${hunkId} missing`);
    const line = hunk.querySelector(`[data-line-idx="${lineIdx}"]`);
    if (!line) throw new Error(`line ${lineIdx} missing in ${hunkId}`);
    const gutter = line.querySelector(".line__sign");
    if (!gutter) throw new Error(`sign column missing on line ${lineIdx}`);
    return gutter as HTMLElement;
  }

  function lineText(container: HTMLElement, hunkId: string, lineIdx: number): HTMLElement {
    const hunk = container.querySelector(`[data-hunk-id="${hunkId}"]`);
    const line = hunk?.querySelector(`[data-line-idx="${lineIdx}"]`);
    const text = line?.querySelector(".line__text");
    if (!text) throw new Error("line__text missing");
    return text as HTMLElement;
  }

  it("pointerdown on the gutter calls onLineFocus with extend reflecting shiftKey", () => {
    const onLineFocus = vi.fn();
    const { container } = renderMulti({ onLineFocus });
    fireEvent.pointerDown(lineGutter(container, "hunk-A", 1), { button: 0 });
    expect(onLineFocus).toHaveBeenCalledWith("hunk-A", 1, { extend: false });
  });

  it("shift-click on the gutter passes extend=true", () => {
    const onLineFocus = vi.fn();
    const { container } = renderMulti({ onLineFocus });
    fireEvent.pointerDown(lineGutter(container, "hunk-A", 2), {
      button: 0,
      shiftKey: true,
    });
    expect(onLineFocus).toHaveBeenLastCalledWith("hunk-A", 2, { extend: true });
  });

  it("right-click on a line calls onLineContextMenu", () => {
    const onLineContextMenu = vi.fn();
    const { container } = renderMulti({ onLineContextMenu });
    const target = lineGutter(container, "hunk-A", 1);
    fireEvent.contextMenu(target, { clientX: 100, clientY: 200 });
    expect(onLineContextMenu).toHaveBeenCalledWith("hunk-A", 1, 100, 200);
  });

  it("text-content pointerdown does not call onLineFocus immediately", () => {
    const onLineFocus = vi.fn();
    const { container } = renderMulti({ onLineFocus });
    fireEvent.pointerDown(lineText(container, "hunk-A", 1), { button: 0 });
    expect(onLineFocus).not.toHaveBeenCalled();
  });

  it("text-content collapsed pointerup falls through to onLineFocus", () => {
    const onLineFocus = vi.fn();
    const { container } = renderMulti({ onLineFocus });
    const target = lineText(container, "hunk-A", 1);
    fireEvent.pointerDown(target, { button: 0 });
    fireEvent.pointerUp(target);
    expect(onLineFocus).toHaveBeenCalledWith("hunk-A", 1, { extend: false });
  });

  it("interactionsEnabled=false suppresses pointer + contextmenu callbacks", () => {
    const onLineFocus = vi.fn();
    const onLineContextMenu = vi.fn();
    const { container } = render(
      <DiffView
        viewModel={multiLineViewModel()}
        onSetExpandLevel={() => undefined}
        onToggleExpandFile={() => undefined}
        onTogglePreviewFile={() => undefined}
        onLineFocus={onLineFocus}
        onLineContextMenu={onLineContextMenu}
        interactionsEnabled={false}
      />,
    );
    fireEvent.pointerDown(lineGutter(container, "hunk-A", 0), { button: 0 });
    fireEvent.contextMenu(lineGutter(container, "hunk-A", 0));
    expect(onLineFocus).not.toHaveBeenCalled();
    expect(onLineContextMenu).not.toHaveBeenCalled();
  });
});

function fixtureViewModel(): DiffViewModel {
  return {
    path: "src/preferences.ts",
    language: "typescript",
    status: "modified",
    fileId: "file-1",
    isFileReviewed: false,
    canExpandFile: false,
    fileFullyExpanded: false,
    fullFileLines: [],
    filePreviewing: false,
    canPreview: false,
    previewSource: "",
    hunks: [
      {
        id: "hunk-1",
        header: "@@ -1,1 +1,1 @@",
        coverage: 0,
        isCurrent: false,
        aiReviewed: false,
        definesSymbols: ["loadPrefs"],
        referencesSymbols: [],
        contextAbove: [],
        contextBelow: [],
        lines: [
          {
            kind: "add",
            text: "loadPrefs();",
            newNo: 1,
            isCursor: false,
            isRead: false,
            isSelected: false,
            isAcked: false,
            hasUserComment: false,
            aiGlyph: " ",
          },
        ],
      },
    ],
  };
}
