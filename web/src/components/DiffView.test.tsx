// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView";
import type { DiffViewModel } from "../view";

vi.mock("../highlight", () => ({
  highlightLines: vi.fn(async (lines: string[], language?: string) => ({
    language: language ?? "text",
    lines: lines.map(
      () => '<span class="shiki-token shiki-token--symbol" data-symbol="loadPrefs" data-token-col="7" role="button" tabindex="0">loadPrefs</span>',
    ),
  })),
}));

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
