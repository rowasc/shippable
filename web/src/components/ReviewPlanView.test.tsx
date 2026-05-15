import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewPlanView } from "./ReviewPlanView";
import type {
  EntryPoint,
  EvidenceRef,
  ReviewPlan,
  StructureMapFile,
} from "../types";

function file(fileId: string, path: string): StructureMapFile {
  return {
    fileId,
    path,
    status: "modified",
    added: 1,
    removed: 0,
    isTest: false,
  };
}

function entry(
  fileId: string,
  evidence: EvidenceRef[] = [{ kind: "file", path: "x" }],
): EntryPoint {
  return {
    fileId,
    reason: { text: "why this matters", evidence },
  };
}

function plan(overrides: Partial<ReviewPlan> = {}): ReviewPlan {
  return {
    headline: "t",
    intent: [],
    map: { files: [], symbols: [] },
    entryPoints: [],
    ...overrides,
  };
}

// Count non-overlapping substring occurrences. Substring is fine here — we
// pick paths that don't appear in any class name or attribute.
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

describe("ReviewPlanView map split", () => {
  it("renders entry-point files in the priority list and the rest under 'other changes'", () => {
    const files = [
      file("f-a", "src/a.ts"),
      file("f-b", "src/b.ts"),
      file("f-c", "src/c.ts"),
      file("f-d", "src/d.ts"),
    ];
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files, symbols: [] },
          entryPoints: [entry("f-b"), entry("f-d")],
        })}
      />,
    );

    // Priority list contains the ranked entries; "other changes" divider
    // appears; non-ranked files render in a second list.
    const priorityList = html.match(
      /class="plan__files plan__files--priority"[\s\S]*?<\/ol>/,
    )?.[0];
    expect(priorityList).toBeTruthy();
    expect(priorityList).toContain("src/b.ts");
    expect(priorityList).toContain("src/d.ts");
    expect(priorityList).not.toContain("src/a.ts");
    expect(priorityList).not.toContain("src/c.ts");

    expect(html).toContain('class="plan__files-divider"');
  });

  it("does not list a file in both the priority and the 'other changes' group", () => {
    // Regression: if dedupe by fileId breaks, an entry's file appears twice
    // — once at the top with a rank and once in the inventory.
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files: [file("f-a", "src/only.ts")], symbols: [] },
          entryPoints: [entry("f-a")],
        })}
      />,
    );
    expect(countOccurrences(html, "src/only.ts")).toBe(1);
  });

  it("hides the 'other changes' divider when every changed file is a ranked entry", () => {
    const files = [file("f-a", "src/a.ts"), file("f-b", "src/b.ts")];
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files, symbols: [] },
          entryPoints: [entry("f-a"), entry("f-b")],
        })}
      />,
    );
    expect(html).not.toContain('class="plan__files-divider"');
  });

  it("shows the flat-diff empty state when there are no entry points", () => {
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files: [file("f-a", "src/a.ts")], symbols: [] },
          entryPoints: [],
        })}
      />,
    );
    expect(html).toContain("No clear entry point");
    expect(html).not.toContain('class="plan__files plan__files--priority"');
    expect(html).not.toContain('class="plan__files-divider"');
  });

  it("falls back to the entry's fileId when no matching file exists in the map", () => {
    // An AI plan can hallucinate an entry whose fileId doesn't correspond to
    // any changed file. The row must still render — without counts or badges
    // — using the raw fileId as the path label.
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files: [file("f-a", "src/a.ts")], symbols: [] },
          entryPoints: [entry("ghost-id")],
        })}
      />,
    );
    const priorityList = html.match(
      /class="plan__files plan__files--priority"[\s\S]*?<\/ol>/,
    )?.[0];
    expect(priorityList).toContain("ghost-id");
    // No counts span renders without a backing file.
    expect(priorityList).not.toContain('class="plan__file-counts"');
  });

  it("drops an entry whose reason carries no evidence (mirrors ClaimRow's invariant)", () => {
    // EntryPoint.reason is a Claim — the evidence-mandatory promise applies.
    // The file itself is real, so it should still appear, just unranked.
    const html = renderToStaticMarkup(
      <ReviewPlanView
        plan={plan({
          map: { files: [file("f-a", "src/a.ts")], symbols: [] },
          entryPoints: [entry("f-a", [])],
        })}
      />,
    );
    expect(html).not.toContain('class="plan__files plan__files--priority"');
    expect(html).toContain("src/a.ts");
    expect(html).toContain("No clear entry point");
  });
});
