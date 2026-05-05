import type { FileStatus, ReviewPlan } from "./types";

export interface PlanDiagramNode {
  id: string;
  fileId: string;
  path: string;
  status: FileStatus;
  isTest: boolean;
  isEntryPoint: boolean;
  column: number;
  row: number;
}

export interface PlanDiagramEdge {
  id: string;
  from: string;
  to: string;
  labels: string[];
}

export interface PlanDiagram {
  mermaid: string;
  nodes: PlanDiagramNode[];
  edges: PlanDiagramEdge[];
}

interface DependencyBucket {
  fromPath: string;
  toPath: string;
  labels: Set<string>;
}

export function buildPlanDiagram(plan: ReviewPlan): PlanDiagram {
  const filesByPath = new Map(plan.map.files.map((file) => [file.path, file]));
  const entryPointFileIds = new Set(plan.entryPoints.map((entry) => entry.fileId));
  const fileIdToNodeId = new Map<string, string>();

  const buckets = new Map<string, DependencyBucket>();
  for (const symbol of plan.map.symbols) {
    for (const referencedPath of symbol.referencedIn) {
      if (referencedPath === symbol.definedIn) continue;
      if (!filesByPath.has(symbol.definedIn) || !filesByPath.has(referencedPath)) continue;
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

  const edgeBuckets = [...buckets.values()].sort((a, b) =>
    a.fromPath === b.fromPath
      ? a.toPath.localeCompare(b.toPath)
      : a.fromPath.localeCompare(b.fromPath),
  );

  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const file of plan.map.files) {
    outgoing.set(file.path, new Set());
    indegree.set(file.path, 0);
  }
  for (const bucket of edgeBuckets) {
    const neighbors = outgoing.get(bucket.fromPath);
    if (!neighbors || neighbors.has(bucket.toPath)) continue;
    neighbors.add(bucket.toPath);
    indegree.set(bucket.toPath, (indegree.get(bucket.toPath) ?? 0) + 1);
  }

  const columnByPath = assignColumns(plan.map.files.map((file) => file.path), outgoing, indegree);
  const filesByColumn = new Map<number, typeof plan.map.files>();
  for (const file of plan.map.files) {
    const column = columnByPath.get(file.path) ?? 0;
    const bucket = filesByColumn.get(column) ?? [];
    bucket.push(file);
    filesByColumn.set(column, bucket);
  }

  const nodes: PlanDiagramNode[] = [];
  for (const [column, files] of [...filesByColumn.entries()].sort((a, b) => a[0] - b[0])) {
    files.sort((a, b) => compareFiles(a.path, b.path, entryPointFileIds, a.fileId, b.fileId));
    files.forEach((file, row) => {
      const nodeId = `f${nodes.length}`;
      fileIdToNodeId.set(file.fileId, nodeId);
      nodes.push({
        id: nodeId,
        fileId: file.fileId,
        path: file.path,
        status: file.status,
        isTest: file.isTest,
        isEntryPoint: entryPointFileIds.has(file.fileId),
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
    }];
  });

  return {
    mermaid: buildMermaid(plan, nodes, edges),
    nodes,
    edges,
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
  fileIdA: string,
  fileIdB: string,
): number {
  const entryDelta =
    Number(entryPointFileIds.has(fileIdB)) - Number(entryPointFileIds.has(fileIdA));
  if (entryDelta !== 0) return entryDelta;
  return pathA.localeCompare(pathB);
}

function buildMermaid(
  plan: ReviewPlan,
  nodes: PlanDiagramNode[],
  edges: PlanDiagramEdge[],
): string {
  const lines = ["flowchart LR"];

  for (const node of nodes) {
    lines.push(`  ${node.id}["${escapeMermaidText(node.path)}"]`);
  }
  if (edges.length === 0) {
    lines.push("  %% no dependency edges detected inside this changeset");
  }
  for (const edge of edges) {
    const label = formatEdgeLabel(edge.labels);
    lines.push(
      `  ${edge.from} -->|"${escapeMermaidText(label)}"| ${edge.to}`,
    );
  }

  const entryNodes = nodes.filter((node) => node.isEntryPoint).map((node) => node.id);
  const testNodes = nodes.filter((node) => node.isTest).map((node) => node.id);
  const changedNodes = nodes
    .filter((node) => {
      const file = plan.map.files.find((item) => item.fileId === node.fileId);
      return file?.status === "added";
    })
    .map((node) => node.id);

  lines.push("  classDef entry fill:#fff1cc,stroke:#9a6700,stroke-width:2px;");
  lines.push("  classDef test fill:#eef6ff,stroke:#1f6feb,stroke-dasharray:4 3;");
  lines.push("  classDef added fill:#e9f9ee,stroke:#1a7f37;");
  if (entryNodes.length > 0) lines.push(`  class ${entryNodes.join(",")} entry;`);
  if (testNodes.length > 0) lines.push(`  class ${testNodes.join(",")} test;`);
  if (changedNodes.length > 0) lines.push(`  class ${changedNodes.join(",")} added;`);

  return lines.join("\n");
}

function formatEdgeLabel(labels: string[]): string {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

function escapeMermaidText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
