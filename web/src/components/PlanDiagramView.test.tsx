import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanDiagramView } from "./PlanDiagramView";
import type { PlanDiagram } from "../planDiagram";

function makeDiagram(): PlanDiagram {
  return {
    scope: "diff",
    mermaid: [
      "flowchart LR",
      '  subgraph g0["src"]',
      '    f0["Cart.php"]',
      '    f1["Routes.php"]',
      '    f2["CartTest.php"]',
      "  end",
      '  f0 -->|"Cart"| f1',
      '  f0 -. "Cart (tests)" .-> f2',
      "  classDef role-entity fill:#e9f9ee,stroke:#1a7f37;",
      "  classDef role-route fill:#fff1cc,stroke:#9a6700,stroke-width:1.5px;",
      "  classDef role-test fill:#eef6ff,stroke:#1f6feb,stroke-dasharray:4 3;",
      "  class f0 role-entity;",
      "  class f1 role-route;",
      "  class f2 role-test;",
    ].join("\n"),
    markdownCount: 0,
    nodes: [
      {
        id: "f0",
        path: "src/Cart.php",
        isTest: false,
        isEntryPoint: false,
        role: "changed",
        pathRole: "code",
        fileRole: "entity",
        shape: { classes: 1, properties: 4, methods: 1 },
        symbols: [{ name: "Cart", kind: "Class", line: 1 }],
        column: 0,
        row: 0,
      },
      {
        id: "f1",
        path: "src/Routes.php",
        isTest: false,
        isEntryPoint: true,
        role: "changed",
        pathRole: "route",
        fileRole: "route",
        column: 1,
        row: 0,
      },
      {
        id: "f2",
        path: "src/CartTest.php",
        isTest: true,
        isEntryPoint: false,
        role: "changed",
        pathRole: "test",
        fileRole: "test",
        column: 2,
        row: 0,
      },
    ],
    edges: [
      { id: "e0", from: "f0", to: "f1", labels: ["Cart"], kind: "references" },
      { id: "e1", from: "f0", to: "f2", labels: ["Cart"], kind: "tests" },
    ],
  };
}

describe("PlanDiagramView (mermaid renderer)", () => {
  const html = renderToStaticMarkup(
    <PlanDiagramView
      diagram={makeDiagram()}
      includeMarkdown={false}
      onToggleMarkdown={() => {}}
    />,
  );

  it("renders the static diagram-type tab strip with the four disabled placeholders", () => {
    expect(html).toContain("plan-diagram__tab--active");
    expect(html).toContain("Class");
    expect(html).toContain("State");
    expect(html).toContain("Sequence");
    expect(html).toContain("ER");
    expect(html).toContain('aria-disabled="true"');
  });

  it("emits one mermaid `click ... call cb(path) tooltip` per node", () => {
    expect(html).toContain("flowchart LR");
    expect(html).toContain("classDef role-entity");
    expect(html).toContain("classDef role-route");
    expect(html).toContain("classDef role-test");
    // The `call cb(arg)` form is what makes mermaid pass our path
    // through to the dispatcher; without `call(...)` the third quoted
    // string would land in the tooltip slot, not the callback. The
    // source renders inside a <code> block so `"` round-trips as
    // `&quot;`.
    const Q = "(?:\"|&quot;)";
    expect(html).toMatch(
      new RegExp(`click f0 call __shippableDiagramClick\\(${Q}src/Cart\\.php${Q}\\) ${Q}Data class`),
    );
    expect(html).toMatch(
      new RegExp(`click f1 call __shippableDiagramClick\\(${Q}src/Routes\\.php${Q}\\) ${Q}Request entry point`),
    );
    expect(html).toMatch(
      new RegExp(`click f2 call __shippableDiagramClick\\(${Q}src/CartTest\\.php${Q}\\) ${Q}Test file`),
    );
  });

  it("includes the LSP shape summary in the tooltip when present", () => {
    expect(html).toContain("1 class, 1 method, 4 properties");
  });

  it("offers a 'copy mermaid source' affordance", () => {
    expect(html).toContain("Copy Mermaid diagram source");
  });

  it("renders the empty state when the diagram has no nodes", () => {
    const diagram: PlanDiagram = {
      scope: "diff",
      mermaid: "flowchart LR",
      markdownCount: 0,
      nodes: [],
      edges: [],
    };
    const out = renderToStaticMarkup(
      <PlanDiagramView
        diagram={diagram}
        includeMarkdown={false}
        onToggleMarkdown={() => {}}
      />,
    );
    expect(out).toContain("No files in this change.");
  });
});
