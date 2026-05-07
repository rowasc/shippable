import "./PlanDiagramView.css";
import type { PlanDiagram, PlanDiagramEdge, PlanDiagramNode } from "../planDiagram";
import { CopyButton } from "./CopyButton";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 96;
const ROW_GAP = 28;
const PADDING_X = 20;
const PADDING_Y = 18;
const EDGE_TONES = ["accent", "blue", "magenta", "green", "yellow"] as const;

type EdgeTone = (typeof EDGE_TONES)[number];

interface Props {
  diagram: PlanDiagram;
}

interface PositionedEdge extends PlanDiagramEdge {
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  tone: EdgeTone;
  strokeWidth: number;
  label: string;
}

export function PlanDiagramView({ diagram }: Props) {
  if (diagram.nodes.length === 0) {
    return (
      <section className="plan-diagram">
        <div className="plan-diagram__head">
          <div>
            <div className="plan-diagram__title">Diagram</div>
            <div className="plan-diagram__hint">No files in this change.</div>
          </div>
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
      <div className="plan-diagram__head">
        <div>
          <div className="plan-diagram__title">Diagram</div>
          <div className="plan-diagram__hint">
            {diagram.scope === "repo"
              ? "Generated from the current worktree checkout. Changed files stay highlighted; unchanged repo neighbors give the wider map."
              : diagram.nodes.some((node) => node.role === "context")
                ? "Generated from the current diff. Dimmed nodes are unchanged repo files the diff reaches into."
                : "Generated from the current diff. Copy the Mermaid source if you want to refine it elsewhere."}
          </div>
        </div>
        <CopyButton text={diagram.mermaid} title="Copy Mermaid diagram source" />
      </div>

      <div className="plan-diagram__canvas">
        <svg
          className="plan-diagram__svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Code map for the current changeset"
        >
          <defs>
            {EDGE_TONES.map((tone) => (
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

function DiagramEdgeView({ edge }: { edge: PositionedEdge }) {
  const startX = edge.fromPoint.x;
  const startY = edge.fromPoint.y;
  const endX = edge.toPoint.x;
  const endY = edge.toPoint.y;
  const bend = Math.max(48, Math.abs(endX - startX) / 2);
  const labelX = startX + (endX - startX) / 2;
  const labelY = startY + (endY - startY) / 2 - 12;
  const labelWidth = Math.max(52, edge.label.length * 7 + 18);

  return (
    <g className={`plan-diagram__edge plan-diagram__edge--${edge.tone}`}>
      <path
        d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
        className="plan-diagram__edge-path"
        markerEnd={`url(#plan-diagram-arrow-${edge.tone})`}
        style={{ strokeWidth: edge.strokeWidth }}
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
  return (
    <g
      className="plan-diagram__node"
      data-entry={node.isEntryPoint ? "true" : "false"}
      data-test={node.isTest ? "true" : "false"}
      data-status={node.status}
      data-role={node.role}
    >
      <title>
        {node.path}
        {node.role === "context"
          ? " — context (unchanged file referenced by the diff)"
          : ""}
      </title>
      <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" ry="8" />
      <text className="plan-diagram__node-dir" x={x + 14} y={y + 22}>
        {dir || "."}
      </text>
      <text className="plan-diagram__node-base" x={x + 14} y={y + 39}>
        {truncate(base, 28)}
      </text>
      <text className="plan-diagram__node-meta" x={x + NODE_WIDTH - 14} y={y + 22}>
        {statusGlyph(node.status)}{node.isEntryPoint ? " start" : node.isTest ? " test" : ""}
      </text>
    </g>
  );
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

    const outgoing = outgoingByNode.get(edge.from) ?? [edge];
    const incoming = incomingByNode.get(edge.to) ?? [edge];
    const outgoingIndex = outgoing.findIndex((candidate) => candidate.id === edge.id);
    const incomingIndex = incoming.findIndex((candidate) => candidate.id === edge.id);
    const label = formatEdgeLabel(edge.labels);

    return [{
      ...edge,
      fromPoint: {
        x: from.x + NODE_WIDTH,
        y: from.y + NODE_HEIGHT / 2 + laneOffset(outgoing.length, outgoingIndex),
      },
      toPoint: {
        x: to.x,
        y: to.y + NODE_HEIGHT / 2 + laneOffset(incoming.length, incomingIndex),
      },
      tone: edgeTone(edge),
      strokeWidth: edgeStrokeWidth(edge.labels.length),
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

function edgeTone(edge: PlanDiagramEdge): EdgeTone {
  const key = `${edge.from}>${edge.to}:${edge.labels.join(",")}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return EDGE_TONES[hash % EDGE_TONES.length];
}

function edgeStrokeWidth(labelCount: number): number {
  if (labelCount >= 3) return 3.2;
  if (labelCount === 2) return 2.6;
  return 2.1;
}
