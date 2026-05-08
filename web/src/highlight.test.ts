import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { highlightLines } from "./highlight";

function renderLine(node: unknown): string {
  return renderToStaticMarkup(node as ReactElement);
}

describe("highlightLines symbol tokens", () => {
  it("marks known function-call symbols as clickable", async () => {
    const result = await highlightLines(
      ["loadPrefs();"],
      "typescript",
      undefined,
      { clickableSymbols: ["loadPrefs"] },
    );

    const html = renderLine(result.lines[0]);
    expect(html).toContain('data-symbol="loadPrefs"');
    expect(html).toContain("shiki-token--symbol");
  });

  it("does not mark string literals as clickable symbols", async () => {
    const result = await highlightLines(
      ['const msg = "loadPrefs";'],
      "typescript",
      undefined,
      { clickableSymbols: ["loadPrefs"] },
    );

    expect(renderLine(result.lines[0])).not.toContain('data-symbol="loadPrefs"');
  });

  it("can mark scoped identifiers clickable without fixture symbol metadata", async () => {
    const result = await highlightLines(
      ["return loadPrefs();"],
      "typescript",
      undefined,
      { allowAnyIdentifier: true },
    );

    const html = renderLine(result.lines[0]);
    expect(html).toContain('data-symbol="loadPrefs"');
    expect(html).toContain('data-token-col="7"');
  });
});
