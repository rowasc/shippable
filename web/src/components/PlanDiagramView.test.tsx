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

  it("emits the mermaid source augmented with click directives wired to onNavigate", () => {
    expect(html).toContain("flowchart LR");
    expect(html).toContain("classDef role-entity");
    expect(html).toContain("classDef role-route");
    expect(html).toContain("classDef role-test");
    // One click directive per node — mermaid resolves the callback name
    // against window when the diagram is rendered. The source is shown
    // inside a <code> block so quotes round-trip as `&quot;`.
    expect(html).toMatch(/click f0 __shippableDiagramClick (?:"|&quot;)src\/Cart\.php(?:"|&quot;)/);
    expect(html).toMatch(/click f1 __shippableDiagramClick (?:"|&quot;)src\/Routes\.php(?:"|&quot;)/);
    expect(html).toMatch(/click f2 __shippableDiagramClick (?:"|&quot;)src\/CartTest\.php(?:"|&quot;)/);
  });

  it("offers a 'copy mermaid source' affordance", () => {
    expect(html).toContain("Copy Mermaid diagram source");
  });

  it("does not render the disagreement legend when pathRole === fileRole everywhere", () => {
    const diagram = makeDiagram();
    diagram.nodes[0].pathRole = "entity";
    diagram.nodes[0].fileRole = "entity";
    const out = renderToStaticMarkup(
      <PlanDiagramView
        diagram={diagram}
        includeMarkdown={false}
        onToggleMarkdown={() => {}}
      />,
    );
    expect(out).not.toContain("plan-diagram__legend");
  });

  it("renders the disagreement legend when at least one node was upgraded by LSP", () => {
    const diagram = makeDiagram();
    diagram.nodes[0].pathRole = "code";
    diagram.nodes[0].fileRole = "entity";
    const out = renderToStaticMarkup(
      <PlanDiagramView
        diagram={diagram}
        includeMarkdown={false}
        onToggleMarkdown={() => {}}
      />,
    );
    expect(out).toContain("plan-diagram__legend");
    expect(out).toContain("classified as <strong>entity</strong>");
    expect(out).toContain("path looked like <em>code</em>");
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
