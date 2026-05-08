import "./PlanDiagramView.css";
import type { PlanDiagram, PlanDiagramEdge, PlanDiagramNode } from "../planDiagram";
import type { EdgeKind, FileRole, SymbolShape } from "../types";
import { CopyButton } from "./CopyButton";

const NODE_WIDTH = 248;
const NODE_HEIGHT = 76;
const COLUMN_GAP = 100;
const ROW_GAP = 28;
const PADDING_X = 20;
const PADDING_Y = 18;

interface Props {
  diagram: PlanDiagram;
  includeMarkdown: boolean;
  onToggleMarkdown: () => void;
}

interface PositionedEdge extends PlanDiagramEdge {
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  fromBendOffset: number;
  toBendOffset: number;
  label: string;
}

// 14 file roles share a 5-tone palette + icon set. The icon does the
// disambiguation; the colour does the at-a-glance grouping.
const ROLE_TONE: Record<FileRole, "accent" | "blue" | "magenta" | "green" | "yellow" | "mute"> = {
  component: "magenta",
  hook: "magenta",
  route: "yellow",
  test: "blue",
  entity: "green",
  "type-def": "blue",
  schema: "green",
  migration: "green",
  config: "yellow",
  fixture: "mute",
  prompt: "accent",
  doc: "mute",
  style: "mute",
  code: "accent",
};

const ROLE_GLYPH: Record<FileRole, string> = {
  component: "◇",
  hook: "○",
  route: "→",
  test: "✓",
  entity: "▣",
  "type-def": "T",
  schema: "S",
  migration: "↑",
  config: "⚙",
  fixture: "·",
  prompt: "✦",
  doc: "¶",
  style: "~",
  code: "{}",
};

// Edges: tests get a dashed stroke; uses-hook a distinct accent;
// uses-type a neutral-blue accent; references the default; imports muted.
const EDGE_KIND_CLASS: Record<EdgeKind, string> = {
  imports: "plan-diagram__edge--imports",
  tests: "plan-diagram__edge--tests",
  "uses-hook": "plan-diagram__edge--uses-hook",
  "uses-type": "plan-diagram__edge--uses-type",
  references: "plan-diagram__edge--references",
};

export function PlanDiagramView({ diagram, includeMarkdown, onToggleMarkdown }: Props) {
  const hasMarkdown = diagram.markdownCount > 0;
  const markdownToggle = hasMarkdown ? (
    <button
      type="button"
      className="plan-diagram__toggle"
      onClick={onToggleMarkdown}
      aria-pressed={includeMarkdown}
      title={
        includeMarkdown
          ? "Hide markdown files from the diagram"
          : `Include ${diagram.markdownCount} markdown file${diagram.markdownCount === 1 ? "" : "s"} in the diagram`
      }
    >
      {includeMarkdown ? "hide docs" : "show docs"}
    </button>
  ) : null;

  if (diagram.nodes.length === 0) {
    return (
      <section className="plan-diagram">
        <DiagramTabs />
        <div className="plan-diagram__head">
          <div>
            <div className="plan-diagram__title">Diagram</div>
            <div className="plan-diagram__hint">
              {hasMarkdown && !includeMarkdown
                ? "Only markdown files in this change — toggle to include them."
                : "No files in this change."}
            </div>
          </div>
          {markdownToggle}
        </div>
      </section>
    );
  }

  const positions = new Map(
    diagram.nodes.map((node) => [
      node.id,
      {
        x: PADDING_X + node.column * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING_Y + node.row * (NODE_HEIGHT + ROW_GAP),
      },
    ]),
  );

  const maxColumn = Math.max(...diagram.nodes.map((node) => node.column));
  const maxRow = Math.max(...diagram.nodes.map((node) => node.row));
  const width = PADDING_X * 2 + (maxColumn + 1) * NODE_WIDTH + maxColumn * COLUMN_GAP;
  const height = PADDING_Y * 2 + (maxRow + 1) * NODE_HEIGHT + maxRow * ROW_GAP;
  const positionedEdges = positionEdges(diagram, positions);

  return (
    <section className="plan-diagram">
      <DiagramTabs />
      <div className="plan-diagram__head">
        <div>
          <div className="plan-diagram__title">Map</div>
          <div className="plan-diagram__hint">
            {diagram.scope === "repo"
              ? "Generated from the current worktree checkout. Changed files stay highlighted; unchanged repo neighbors give the wider map."
              : diagram.nodes.some((node) => node.role === "context")
                ? "Generated from the current diff. Dimmed nodes are unchanged repo files the diff reaches into."
                : "Generated from the current diff. Copy the Mermaid source if you want to refine it elsewhere."}
          </div>
        </div>
        <div className="plan-diagram__head-actions">
          {markdownToggle}
          <CopyButton text={diagram.mermaid} title="Copy Mermaid diagram source" />
        </div>
      </div>

      <div className="plan-diagram__canvas">
        <svg
          className="plan-diagram__svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Code map for the current changeset"
        >
          <defs>
            {(["accent", "blue", "magenta", "green", "yellow", "mute"] as const).map((tone) => (
              <marker
                key={tone}
                id={`plan-diagram-arrow-${tone}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className={`plan-diagram__arrowhead plan-diagram__arrowhead--${tone}`}
                />
              </marker>
            ))}
          </defs>

          {positionedEdges.map((edge) => (
            <DiagramEdgeView key={edge.id} edge={edge} />
          ))}

          {diagram.nodes.map((node) => {
            const pos = positions.get(node.id)!;
            return <DiagramNodeView key={node.id} node={node} x={pos.x} y={pos.y} />;
          })}
        </svg>
      </div>

      <details className="plan-diagram__source">
        <summary>Mermaid source</summary>
        <pre className="plan-diagram__code">
          <code>{diagram.mermaid}</code>
        </pre>
      </details>
    </section>
  );
}

function DiagramTabs() {
  // Static placeholders. Disabled tabs explain *why* — the data is missing,
  // not the UI. See docs/plans/diagram-typed-file-graph.md.
  return (
    <div className="plan-diagram__tabs" role="tablist" aria-label="Diagram types">
      <button
        type="button"
        role="tab"
        aria-selected="true"
        className="plan-diagram__tab plan-diagram__tab--active"
      >
        Map
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="Class diagram needs symbol-level capture (methods, fields per class)."
      >
        Class
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="State diagram needs control-flow extraction we don't capture today."
      >
        State
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="Sequence diagram needs call-trace data we don't capture today."
      >
        Sequence
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="ER diagram needs schema parsing we don't capture today."
      >
        ER
      </button>
    </div>
  );
}

function DiagramEdgeView({ edge }: { edge: PositionedEdge }) {
  const startX = edge.fromPoint.x;
  const startY = edge.fromPoint.y;
  const endX = edge.toPoint.x;
  const endY = edge.toPoint.y;
  const baseBend = Math.min(48, Math.abs(endX - startX) / 2);
  const sourceBend = Math.max(16, baseBend + edge.fromBendOffset);
  const targetBend = Math.max(16, baseBend + edge.toBendOffset);
  const sign = endX >= startX ? 1 : -1;
  const labelX = startX + (endX - startX) / 2;
  const labelY = startY + (endY - startY) / 2 - 12;
  const labelWidth = Math.max(52, edge.label.length * 7 + 18);
  const tone = edgeTone(edge.kind);

  return (
    <g
      className={`plan-diagram__edge ${EDGE_KIND_CLASS[edge.kind]}`}
      data-kind={edge.kind}
    >
      <path
        d={`M ${startX} ${startY} C ${startX + sign * sourceBend} ${startY}, ${endX - sign * targetBend} ${endY}, ${endX} ${endY}`}
        className="plan-diagram__edge-path"
        markerEnd={`url(#plan-diagram-arrow-${tone})`}
      />
      <rect
        className="plan-diagram__edge-label-bg"
        x={labelX - labelWidth / 2}
        y={labelY - 10}
        width={labelWidth}
        height={18}
        rx="9"
        ry="9"
      />
      <text className="plan-diagram__edge-label" x={labelX} y={labelY}>
        {edge.label}
      </text>
    </g>
  );
}

function DiagramNodeView({
  node,
  x,
  y,
}: {
  node: PlanDiagramNode;
  x: number;
  y: number;
}) {
  const { dir, base } = splitPath(node.path);
  const tone = ROLE_TONE[node.fileRole];
  const glyph = ROLE_GLYPH[node.fileRole];
  const shapeText = formatShape(node.shape);
  return (
    <g
      className="plan-diagram__node"
      data-entry={node.isEntryPoint ? "true" : "false"}
      data-test={node.isTest ? "true" : "false"}
      data-status={node.status}
      data-role={node.role}
      data-file-role={node.fileRole}
      data-tone={tone}
    >
      <title>{nodeTooltip(node)}</title>
      <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" ry="8" />
      <text className="plan-diagram__node-glyph" x={x + 14} y={y + 24}>
        {glyph}
      </text>
      <text className="plan-diagram__node-base" x={x + 36} y={y + 24}>
        {truncate(base, 26)}
      </text>
      <text className="plan-diagram__node-dir" x={x + 36} y={y + 40}>
        {dir || "."}
      </text>
      {shapeText ? (
        <text className="plan-diagram__node-shape" x={x + 36} y={y + 58}>
          {shapeText}
        </text>
      ) : null}
      <text className="plan-diagram__node-role" x={x + NODE_WIDTH - 14} y={y + 24}>
        {node.fileRole}
      </text>
      <text className="plan-diagram__node-meta" x={x + NODE_WIDTH - 14} y={y + 40}>
        {statusGlyph(node.status)}
        {node.fanIn !== undefined && node.fanIn > 0 ? ` ↩${node.fanIn}` : ""}
      </text>
    </g>
  );
}

function nodeTooltip(node: PlanDiagramNode): string {
  const lines: string[] = [node.path];
  if (node.role === "context") {
    lines.push("(context — unchanged file referenced by the diff)");
  }
  if (node.pathRole !== node.fileRole) {
    lines.push(
      `Classified as ${node.fileRole} by LSP shape (path looked like ${node.pathRole}).`,
    );
  } else {
    lines.push(`Role: ${node.fileRole}`);
  }
  if (node.symbols && node.symbols.length > 0) {
    lines.push("");
    for (const sym of node.symbols.slice(0, 12)) {
      lines.push(`${sym.kind}  ${sym.name}  · L${sym.line + 1}`);
    }
    if (node.symbols.length > 12) {
      lines.push(`… +${node.symbols.length - 12} more`);
    }
  }
  if (node.fanIn !== undefined && node.fanIn > 0) {
    lines.push("");
    lines.push(`Fan-in: ${node.fanIn} file${node.fanIn === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}

function formatShape(shape: SymbolShape | undefined): string | null {
  if (!shape) return null;
  const parts: string[] = [];
  const push = (count: number | undefined, singular: string, plural: string): void => {
    if (!count) return;
    parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  push(shape.classes, "class", "classes");
  push(shape.interfaces, "interface", "interfaces");
  push(shape.methods, "method", "methods");
  push(shape.properties, "property", "properties");
  push(shape.functions, "function", "functions");
  push(shape.types, "type", "types");
  push(shape.enums, "enum", "enums");
  push(shape.constants, "constant", "constants");
  push(shape.variables, "variable", "variables");
  push(shape.modules, "module", "modules");
  push(shape.namespaces, "namespace", "namespaces");
  if (parts.length === 0) return null;
  return parts.slice(0, 3).join(" · ");
}

function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf("/");
  if (index === -1) return { dir: "", base: path };
  return {
    dir: path.slice(0, index),
    base: path.slice(index + 1),
  };
}

function formatEdgeLabel(labels: string[]): string {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

function statusGlyph(status: PlanDiagramNode["status"]): string {
  switch (status) {
    case "added":
      return "+";
    case "deleted":
      return "-";
    case "renamed":
      return "~";
    case "modified":
      return "~";
    default:
      return "·";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function positionEdges(
  diagram: PlanDiagram,
  positions: Map<string, { x: number; y: number }>,
): PositionedEdge[] {
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node] as const));
  const outgoingByNode = new Map<string, PlanDiagramEdge[]>();
  const incomingByNode = new Map<string, PlanDiagramEdge[]>();

  for (const edge of diagram.edges) {
    const outgoing = outgoingByNode.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingByNode.set(edge.from, outgoing);

    const incoming = incomingByNode.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByNode.set(edge.to, incoming);
  }

  for (const edges of outgoingByNode.values()) {
    edges.sort((a, b) => compareEdges(a, b, nodeById));
  }
  for (const edges of incomingByNode.values()) {
    edges.sort((a, b) => compareEdges(a, b, nodeById));
  }

  return diagram.edges.flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return [];

    const fromCol = nodeById.get(edge.from)?.column ?? 0;
    const toCol = nodeById.get(edge.to)?.column ?? 0;
    const isBackward = fromCol > toCol;

    const outgoing = outgoingByNode.get(edge.from) ?? [edge];
    const incoming = incomingByNode.get(edge.to) ?? [edge];
    const outgoingIndex = outgoing.findIndex((candidate) => candidate.id === edge.id);
    const incomingIndex = incoming.findIndex((candidate) => candidate.id === edge.id);
    const label = formatEdgeLabel(edge.labels);

    return [{
      ...edge,
      fromPoint: {
        x: isBackward ? from.x : from.x + NODE_WIDTH,
        y: from.y + NODE_HEIGHT / 2 + laneOffset(outgoing.length, outgoingIndex),
      },
      toPoint: {
        x: isBackward ? to.x + NODE_WIDTH : to.x,
        y: to.y + NODE_HEIGHT / 2 + laneOffset(incoming.length, incomingIndex),
      },
      fromBendOffset: laneBendOffset(outgoing.length, outgoingIndex),
      toBendOffset: laneBendOffset(incoming.length, incomingIndex),
      label,
    }];
  });
}

function compareEdges(
  edgeA: PlanDiagramEdge,
  edgeB: PlanDiagramEdge,
  nodeById: Map<string, PlanDiagramNode>,
): number {
  const targetA = nodeById.get(edgeA.to)?.path ?? edgeA.to;
  const targetB = nodeById.get(edgeB.to)?.path ?? edgeB.to;
  if (targetA !== targetB) return targetA.localeCompare(targetB);
  return formatEdgeLabel(edgeA.labels).localeCompare(formatEdgeLabel(edgeB.labels));
}

function laneOffset(total: number, index: number): number {
  if (total <= 1) return 0;
  const spacing = 12;
  return (index - (total - 1) / 2) * spacing;
}

function laneBendOffset(total: number, index: number): number {
  if (total <= 1) return 0;
  const stride = 10;
  return (index - (total - 1) / 2) * stride;
}

function edgeTone(kind: EdgeKind): "accent" | "blue" | "magenta" | "green" | "yellow" | "mute" {
  switch (kind) {
    case "tests":
      return "blue";
    case "uses-hook":
      return "magenta";
    case "uses-type":
      return "blue";
    case "references":
      return "accent";
    case "imports":
      return "mute";
  }
}
