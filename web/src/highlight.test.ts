import { describe, expect, it } from "vitest";
import { highlightLines } from "./highlight";

describe("highlightLines symbol tokens", () => {
  it("marks known function-call symbols as clickable", async () => {
    const result = await highlightLines(
      ["loadPrefs();"],
      "typescript",
      undefined,
      { clickableSymbols: ["loadPrefs"] },
    );

    expect(result.lines[0]).toContain('data-symbol="loadPrefs"');
    expect(result.lines[0]).toContain("shiki-token--symbol");
  });

  it("does not mark string literals as clickable symbols", async () => {
    const result = await highlightLines(
      ['const msg = "loadPrefs";'],
      "typescript",
      undefined,
      { clickableSymbols: ["loadPrefs"] },
    );

    expect(result.lines[0]).not.toContain('data-symbol="loadPrefs"');
  });

  it("can mark scoped identifiers clickable without fixture symbol metadata", async () => {
    const result = await highlightLines(
      ["return loadPrefs();"],
      "typescript",
      undefined,
      { allowAnyIdentifier: true },
    );

    expect(result.lines[0]).toContain('data-symbol="loadPrefs"');
    expect(result.lines[0]).toContain('data-token-col="7"');
  });
});
