import { describe, expect, it } from "vitest";
import { buildPlanDiagram } from "./planDiagram";
import type { ReviewPlan } from "./types";

const BASE_REASON = {
  text: "start here",
  evidence: [{ kind: "file" as const, path: "src/core.ts" }],
};

describe("buildPlanDiagram", () => {
  it("groups symbol references into file-to-file edges and emits Mermaid source", () => {
    const plan: ReviewPlan = {
      headline: "diagram",
      intent: [],
      map: {
        files: [
          {
            fileId: "core",
            path: "src/core.ts",
            status: "added",
            added: 12,
            removed: 0,
            isTest: false,
          },
          {
            fileId: "panel",
            path: "src/panel.tsx",
            status: "modified",
            added: 8,
            removed: 2,
            isTest: false,
          },
          {
            fileId: "panel-test",
            path: "src/panel.test.tsx",
            status: "added",
            added: 15,
            removed: 0,
            isTest: true,
          },
        ],
        symbols: [
          {
            name: "loadPrefs",
            definedIn: "src/core.ts",
            referencedIn: ["src/panel.tsx", "src/panel.test.tsx"],
          },
          {
            name: "savePrefs",
            definedIn: "src/core.ts",
            referencedIn: ["src/panel.tsx"],
          },
          {
            name: "PreferencesPanel",
            definedIn: "src/panel.tsx",
            referencedIn: ["src/panel.test.tsx"],
          },
        ],
      },
      entryPoints: [{ fileId: "core", reason: BASE_REASON }],
    };

    const diagram = buildPlanDiagram(plan);
    const core = diagram.nodes.find((node) => node.fileId === "core");
    const panel = diagram.nodes.find((node) => node.fileId === "panel");
    const test = diagram.nodes.find((node) => node.fileId === "panel-test");
    const coreToPanel = diagram.edges.find(
      (edge) => edge.from === core?.id && edge.to === panel?.id,
    );

    expect(core?.column).toBe(0);
    expect(panel?.column).toBe(1);
    expect(test?.column).toBe(2);
    expect(core?.isEntryPoint).toBe(true);
    expect(test?.isTest).toBe(true);
    expect(coreToPanel?.labels).toEqual(["loadPrefs", "savePrefs"]);
    expect(diagram.mermaid).toContain("flowchart LR");
    expect(diagram.mermaid).toContain('classDef entry fill:#fff1cc');
    expect(diagram.mermaid).toContain('classDef test fill:#eef6ff');
    expect(diagram.mermaid).toContain('src/core.ts');
    expect(diagram.mermaid).toContain('loadPrefs, savePrefs');
  });

  it("still emits nodes when the structure map has no internal references", () => {
    const plan: ReviewPlan = {
      headline: "flat",
      intent: [],
      map: {
        files: [
          {
            fileId: "docs",
            path: "docs/notes.md",
            status: "modified",
            added: 3,
            removed: 1,
            isTest: false,
          },
        ],
        symbols: [],
      },
      entryPoints: [],
    };

    const diagram = buildPlanDiagram(plan);

    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.edges).toHaveLength(0);
    expect(diagram.mermaid).toContain("%% no dependency edges detected");
    expect(diagram.mermaid).toContain('f0["docs/notes.md"]');
  });

  it("uses an attached repo graph when available, including unchanged neighbors", () => {
    const plan: ReviewPlan = {
      headline: "repo graph",
      intent: [],
      map: {
        files: [
          {
            fileId: "changed",
            path: "src/changed.ts",
            status: "modified",
            added: 4,
            removed: 1,
            isTest: false,
          },
        ],
        symbols: [],
      },
      entryPoints: [{ fileId: "changed", reason: BASE_REASON }],
    };

    const diagram = buildPlanDiagram(plan, {
      scope: "repo",
      nodes: [
        { path: "src/core.ts", isTest: false },
        { path: "src/changed.ts", isTest: false },
      ],
      edges: [
        {
          fromPath: "src/core.ts",
          toPath: "src/changed.ts",
          labels: ["buildThing"],
          kind: "symbol",
        },
      ],
    });

    expect(diagram.scope).toBe("repo");
    expect(diagram.nodes.map((node) => node.path)).toEqual([
      "src/core.ts",
      "src/changed.ts",
    ]);
    expect(diagram.nodes.find((node) => node.path === "src/core.ts")?.status).toBeUndefined();
    expect(diagram.nodes.find((node) => node.path === "src/changed.ts")?.status).toBe("modified");
    expect(diagram.mermaid).toContain('buildThing');
  });
});
