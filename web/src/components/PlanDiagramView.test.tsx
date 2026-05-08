import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanDiagramView } from "./PlanDiagramView";
import type { PlanDiagram } from "../planDiagram";

function makeDiagram(): PlanDiagram {
  return {
    scope: "diff",
    mermaid: "flowchart LR",
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

describe("PlanDiagramView (typed file graph)", () => {
  const html = renderToStaticMarkup(
    <PlanDiagramView
      diagram={makeDiagram()}
      includeMarkdown={false}
      onToggleMarkdown={() => {}}
    />,
  );

  it("renders the role chip per node", () => {
    expect(html).toContain('data-file-role="entity"');
    expect(html).toContain('data-file-role="route"');
    expect(html).toContain('data-file-role="test"');
  });

  it("renders the shape subtitle when LSP shape is present", () => {
    expect(html).toContain("1 class");
    expect(html).toContain("4 properties");
  });

  it("styles edges by kind", () => {
    expect(html).toContain("plan-diagram__edge--references");
    expect(html).toContain("plan-diagram__edge--tests");
  });

  it("renders the static diagram-type tabs with the three disabled placeholders", () => {
    expect(html).toContain("plan-diagram__tab--active");
    expect(html).toContain("Class");
    expect(html).toContain("Sequence");
    expect(html).toContain("ER");
    expect(html).toContain('aria-disabled="true"');
  });

  it("surfaces classifier disagreement on the tooltip when pathRole !== fileRole", () => {
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
    expect(out).toContain("Classified as entity by LSP shape");
    expect(out).toContain("path looked like code");
  });
});
