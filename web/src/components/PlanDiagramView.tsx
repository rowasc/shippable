import "./PlanDiagramView.css";
import type { PlanDiagram, PlanDiagramEdge, PlanDiagramNode } from "../planDiagram";
import { CopyButton } from "./CopyButton";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 96;
const ROW_GAP = 28;
const PADDING_X = 20;
const PADDING_Y = 18;

interface Props {
  diagram: PlanDiagram;
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

  return (
    <section className="plan-diagram">
      <div className="plan-diagram__head">
        <div>
          <div className="plan-diagram__title">Diagram</div>
          <div className="plan-diagram__hint">
            Generated from the current plan map. Copy the Mermaid source if you want to refine it elsewhere.
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
            <marker
              id="plan-diagram-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="plan-diagram__arrowhead" />
            </marker>
          </defs>

          {diagram.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            return (
              <DiagramEdgeView
                key={edge.id}
                edge={edge}
                from={from}
                to={to}
              />
            );
          })}

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

function DiagramEdgeView({
  edge,
  from,
  to,
}: {
  edge: PlanDiagramEdge;
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + NODE_HEIGHT / 2;
  const bend = Math.max(48, Math.abs(endX - startX) / 2);
  const labelX = startX + (endX - startX) / 2;
  const labelY = startY + (endY - startY) / 2 - 8;

  return (
    <g className="plan-diagram__edge">
      <path
        d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
        className="plan-diagram__edge-path"
        markerEnd="url(#plan-diagram-arrow)"
      />
      <text className="plan-diagram__edge-label" x={labelX} y={labelY}>
        {formatEdgeLabel(edge.labels)}
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
    >
      <title>{node.path}</title>
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
    default:
      return "~";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
