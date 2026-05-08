import { classifyFileRole } from "./fileRole";
import type {
  CodeGraph,
  EdgeKind,
  FileRole,
  FileStatus,
  ReviewPlan,
  SymbolShape,
  SymbolSummary,
} from "./types";

export interface PlanDiagramNode {
  id: string;
  fileId?: string;
  path: string;
  status?: FileStatus;
  isTest: boolean;
  isEntryPoint: boolean;
  /**
   * `"changed"` for nodes the diff/repo asked about; `"context"` for
   * unchanged repo neighbours pulled in to show blast radius. Mirrors
   * `CodeGraphNode.role`. Falls back to `"changed"` for legacy inputs
   * that don't carry the role.
   */
  role: "changed" | "context";
  /** Path-floor classifier output; carried through for the hover. */
  pathRole: FileRole;
  /** Final classifier output (after LSP-shape upgrade). The renderer
   *  drives accent + role chip from this; the hover surfaces
   *  `pathRole !== fileRole` as classifier disagreement. */
  fileRole: FileRole;
  shape?: SymbolShape;
  symbols?: SymbolSummary[];
  fanIn?: number;
  column: number;
  row: number;
}

export interface PlanDiagramEdge {
  id: string;
  from: string;
  to: string;
  labels: string[];
  kind: EdgeKind;
}

export interface PlanDiagram {
  scope: "diff" | "repo";
  mermaid: string;
  nodes: PlanDiagramNode[];
  edges: PlanDiagramEdge[];
  /** Count of markdown files present in the source graph. Lets the UI decide
   *  whether to surface a "show docs" toggle even when they're filtered out. */
  markdownCount: number;
}

export interface BuildPlanDiagramOptions {
  /** Markdown files (`.md` / `.mdx`) are excluded by default — they crowd
   *  the code map and rarely have meaningful symbol edges. Pass `true` to
   *  fold them back in. */
  includeMarkdown?: boolean;
}

interface DependencyBucket {
  fromPath: string;
  toPath: string;
  labels: Set<string>;
}

export function isMarkdownPath(path: string): boolean {
  return /\.mdx?$/i.test(path);
}

export function buildPlanDiagram(
  plan: ReviewPlan,
  graph?: CodeGraph,
  options: BuildPlanDiagramOptions = {},
): PlanDiagram {
  const planFiles = plan.map.files;
  const filesByPath = new Map(planFiles.map((file) => [file.path, file]));
  const entryPointFileIds = new Set(plan.entryPoints.map((entry) => entry.fileId));
  const fullGraph = graph ?? buildFallbackGraph(plan);
  const markdownCount = fullGraph.nodes.filter((node) => isMarkdownPath(node.path)).length;
  const graphSource = options.includeMarkdown
    ? fullGraph
    : filterMarkdown(fullGraph);
  const fileIdByPath = new Map(planFiles.map((file) => [file.path, file.fileId]));

  const edgeBuckets = graphSource.edges
    .map((edge) => ({
      fromPath: edge.fromPath,
      toPath: edge.toPath,
      labels: new Set(edge.labels),
      kind: edge.kind,
    }))
    .sort((a, b) =>
    a.fromPath === b.fromPath
      ? a.toPath.localeCompare(b.toPath)
      : a.fromPath.localeCompare(b.fromPath),
  );

  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const node of graphSource.nodes) {
    outgoing.set(node.path, new Set());
    indegree.set(node.path, 0);
  }
  for (const bucket of edgeBuckets) {
    const neighbors = outgoing.get(bucket.fromPath);
    if (!neighbors || neighbors.has(bucket.toPath)) continue;
    neighbors.add(bucket.toPath);
    indegree.set(bucket.toPath, (indegree.get(bucket.toPath) ?? 0) + 1);
  }

  const columnByPath = assignColumns(graphSource.nodes.map((node) => node.path), outgoing, indegree);
  const filesByColumn = new Map<number, typeof graphSource.nodes>();
  for (const node of graphSource.nodes) {
    const column = columnByPath.get(node.path) ?? 0;
    const bucket = filesByColumn.get(column) ?? [];
    bucket.push(node);
    filesByColumn.set(column, bucket);
  }

  const nodes: PlanDiagramNode[] = [];
  let nodeCounter = 0;
  for (const [column, files] of [...filesByColumn.entries()].sort((a, b) => a[0] - b[0])) {
    files.sort((a, b) =>
      compareFiles(
        a.path,
        b.path,
        entryPointFileIds,
        fileIdByPath.get(a.path),
        fileIdByPath.get(b.path),
      ),
    );
    files.forEach((file, row) => {
      const nodeId = `f${nodeCounter++}`;
      // Re-run the path-floor classifier when the source graph predates the
      // server enrichment (legacy persisted graphs). Server-built graphs
      // already carry pathRole/fileRole; trust those.
      const fallback = classifyFileRole(file.path, file.shape, file.symbols);
      nodes.push({
        id: nodeId,
        fileId: fileIdByPath.get(file.path),
        path: file.path,
        status: filesByPath.get(file.path)?.status,
        isTest: file.isTest,
        isEntryPoint: fileIdByPath.has(file.path)
          ? entryPointFileIds.has(fileIdByPath.get(file.path)!)
          : false,
        role: file.role ?? "changed",
        pathRole: file.pathRole ?? fallback.pathRole,
        fileRole: file.fileRole ?? fallback.fileRole,
        shape: file.shape,
        symbols: file.symbols,
        fanIn: file.fanIn,
        column,
        row,
      });
    });
  }

  const filePathToNodeId = new Map(
    nodes.map((node) => [node.path, node.id] as const),
  );
  const edges: PlanDiagramEdge[] = edgeBuckets.flatMap((bucket, index) => {
    const from = filePathToNodeId.get(bucket.fromPath);
    const to = filePathToNodeId.get(bucket.toPath);
    if (!from || !to) return [];
    return [{
      id: `e${index}`,
      from,
      to,
      labels: [...bucket.labels].sort(),
      kind: bucket.kind,
    }];
  });

  return {
    scope: graphSource.scope,
    mermaid: buildMermaid(nodes, edges),
    nodes,
    edges,
    markdownCount,
  };
}

function filterMarkdown(graph: CodeGraph): CodeGraph {
  return {
    scope: graph.scope,
    nodes: graph.nodes.filter((node) => !isMarkdownPath(node.path)),
    edges: graph.edges.filter(
      (edge) => !isMarkdownPath(edge.fromPath) && !isMarkdownPath(edge.toPath),
    ),
  };
}

function buildFallbackGraph(plan: ReviewPlan): CodeGraph {
  const buckets = new Map<string, DependencyBucket>();
  for (const symbol of plan.map.symbols) {
    for (const referencedPath of symbol.referencedIn) {
      if (referencedPath === symbol.definedIn) continue;
      const key = `${symbol.definedIn}\u0000${referencedPath}`;
      const bucket = buckets.get(key) ?? {
        fromPath: symbol.definedIn,
        toPath: referencedPath,
        labels: new Set<string>(),
      };
      bucket.labels.add(symbol.name);
      buckets.set(key, bucket);
    }
  }
  return {
    scope: "diff",
    nodes: plan.map.files.map((file) => {
      const { pathRole, fileRole } = classifyFileRole(file.path);
      return {
        path: file.path,
        isTest: file.isTest,
        pathRole,
        fileRole,
      };
    }),
    edges: [...buckets.values()].map((bucket) => ({
      fromPath: bucket.fromPath,
      toPath: bucket.toPath,
      labels: [...bucket.labels].sort(),
      kind: "references" as const,
    })),
  };
}

function assignColumns(
  paths: string[],
  outgoing: Map<string, Set<string>>,
  indegree: Map<string, number>,
): Map<string, number> {
  const pending = new Map(indegree);
  const columnByPath = new Map<string, number>();
  const queue = [...paths].filter((path) => (pending.get(path) ?? 0) === 0).sort();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentColumn = columnByPath.get(current) ?? 0;
    for (const next of [...(outgoing.get(current) ?? [])].sort()) {
      columnByPath.set(next, Math.max(columnByPath.get(next) ?? 0, currentColumn + 1));
      const remaining = (pending.get(next) ?? 0) - 1;
      pending.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
    queue.sort();
  }

  for (const path of [...paths].sort()) {
    if (columnByPath.has(path)) continue;
    const parents = [...paths]
      .filter((candidate) => outgoing.get(candidate)?.has(path))
      .map((candidate) => columnByPath.get(candidate) ?? 0);
    columnByPath.set(path, parents.length > 0 ? Math.max(...parents) + 1 : 0);
  }

  return columnByPath;
}

function compareFiles(
  pathA: string,
  pathB: string,
  entryPointFileIds: Set<string>,
  fileIdA?: string,
  fileIdB?: string,
): number {
  const entryDelta =
    Number(fileIdB ? entryPointFileIds.has(fileIdB) : false) -
    Number(fileIdA ? entryPointFileIds.has(fileIdA) : false);
  if (entryDelta !== 0) return entryDelta;
  return pathA.localeCompare(pathB);
}

// Mermaid is *export only*. We hand-roll the SVG renderer for theming
// and click-to-definition. The mermaid emit needs to round-trip through
// mermaid.live without preprocessing, so it stays in vanilla `flowchart`
// dialect — no `defaultRenderer: elk` directive (not always available in
// renderers we don't control).
const ROLE_CLASSDEFS: Record<FileRole, string> = {
  component: "fill:#fbeaff,stroke:#a347c1,stroke-width:1.5px",
  hook: "fill:#fbeaff,stroke:#a347c1,stroke-dasharray:0",
  route: "fill:#fff1cc,stroke:#9a6700,stroke-width:1.5px",
  test: "fill:#eef6ff,stroke:#1f6feb,stroke-dasharray:4 3",
  entity: "fill:#e9f9ee,stroke:#1a7f37",
  "type-def": "fill:#eaf2ff,stroke:#3a6cd6",
  schema: "fill:#e9f9ee,stroke:#1a7f37",
  migration: "fill:#e9f9ee,stroke:#1a7f37,stroke-width:1.5px",
  config: "fill:#fff1cc,stroke:#9a6700",
  fixture: "fill:#f3f3f3,stroke:#cccccc,color:#666666",
  prompt: "fill:#fdf3f8,stroke:#a347c1",
  doc: "fill:#f3f3f3,stroke:#cccccc,color:#666666",
  style: "fill:#f3f3f3,stroke:#cccccc",
  code: "fill:#f7f7f7,stroke:#bbbbbb",
};

function mermaidEdgeFor(edge: PlanDiagramEdge): string {
  const labelParts = [...edge.labels];
  if (edge.kind !== "imports" && edge.kind !== "references") {
    labelParts.push(`(${edge.kind})`);
  }
  const label = formatEdgeLabel(labelParts);
  // tests get a dashed arrow so the typology survives the export.
  // Other kinds keep a regular arrow with the kind in the label.
  if (edge.kind === "tests") {
    return `  ${edge.from} -. "${escapeMermaidText(label)}" .-> ${edge.to}`;
  }
  return `  ${edge.from} -->|"${escapeMermaidText(label)}"| ${edge.to}`;
}

function buildMermaid(
  nodes: PlanDiagramNode[],
  edges: PlanDiagramEdge[],
): string {
  const lines = ["flowchart LR"];

  const groups = groupNodesByDir(nodes);
  let groupCounter = 0;
  for (const [dir, groupNodes] of groups) {
    const groupId = `g${groupCounter++}`;
    lines.push(`  subgraph ${groupId}["${escapeMermaidText(dir)}"]`);
    for (const node of groupNodes) {
      lines.push(`    ${node.id}["${escapeMermaidText(basename(node.path))}"]`);
    }
    lines.push("  end");
  }

  if (edges.length === 0) {
    lines.push("  %% no dependency edges detected inside this changeset");
  }
  for (const edge of edges) {
    lines.push(mermaidEdgeFor(edge));
  }

  // classDef per fileRole. Only emit defs we'll reference, to keep the
  // export tidy enough to re-paste into mermaid.live.
  const rolesPresent = new Set(nodes.map((n) => n.fileRole));
  for (const role of rolesPresent) {
    lines.push(`  classDef role-${role} ${ROLE_CLASSDEFS[role]};`);
  }
  const byRole = new Map<FileRole, string[]>();
  for (const node of nodes) {
    const bucket = byRole.get(node.fileRole) ?? [];
    bucket.push(node.id);
    byRole.set(node.fileRole, bucket);
  }
  for (const [role, ids] of byRole) {
    lines.push(`  class ${ids.join(",")} role-${role};`);
  }

  // Status accents on top of the role styling. Mermaid honors the latter
  // class, so role first then state-overlays land last.
  const entryNodes = nodes.filter((node) => node.isEntryPoint).map((node) => node.id);
  const changedNodes = nodes
    .filter((node) => node.status === "added")
    .map((node) => node.id);
  const contextNodes = nodes
    .filter((node) => node.role === "context")
    .map((node) => node.id);

  if (entryNodes.length > 0) {
    lines.push("  classDef entry stroke-width:2.5px;");
    lines.push(`  class ${entryNodes.join(",")} entry;`);
  }
  if (changedNodes.length > 0) {
    lines.push("  classDef added stroke:#1a7f37,fill:#e9f9ee;");
    lines.push(`  class ${changedNodes.join(",")} added;`);
  }
  if (contextNodes.length > 0) {
    lines.push("  classDef context fill:#f4f4f4,stroke:#bbbbbb,color:#666666;");
    lines.push(`  class ${contextNodes.join(",")} context;`);
  }

  return lines.join("\n");
}

function groupNodesByDir(
  nodes: PlanDiagramNode[],
): Map<string, PlanDiagramNode[]> {
  const groups = new Map<string, PlanDiagramNode[]>();
  for (const node of nodes) {
    const dir = dirname(node.path) || ".";
    const bucket = groups.get(dir) ?? [];
    bucket.push(node);
    groups.set(dir, bucket);
  }
  return new Map(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function formatEdgeLabel(labels: string[]): string {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

function escapeMermaidText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
