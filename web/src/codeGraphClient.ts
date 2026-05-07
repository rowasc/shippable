import { apiUrl } from "./apiUrl";
import type { CodeGraph, DiffFile } from "./types";

interface CodeGraphResponse {
  graph: CodeGraph;
  sources: Array<{ language: string; resolver: "lsp" | "regex" }>;
}

interface ErrorResponse {
  error: string;
}

/**
 * Fetch the LSP-resolved diff-scoped graph for a worktree-attached
 * changeset. Best-effort: a network or server failure resolves to `null`
 * so the caller can fall back to the regex graph parseDiff already
 * produced. Demo / paste-load callers don't have a worktree and don't
 * call this — they keep the regex graph as-is.
 */
export async function fetchDiffCodeGraph(
  workspacePath: string,
  ref: string,
  files: DiffFile[],
): Promise<CodeGraph | null> {
  const payload = {
    workspaceRoot: workspacePath,
    ref,
    scope: "diff" as const,
    files: files
      .filter((file) => file.status !== "deleted")
      .map((file) => ({
        path: file.path,
        text: file.postChangeText,
      })),
  };
  try {
    const res = await fetch(await apiUrl("/api/code-graph"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as CodeGraphResponse | ErrorResponse;
    if (!res.ok || "error" in json) return null;
    return json.graph;
  } catch {
    return null;
  }
}

/**
 * Warm the LSP for a worktree by issuing an empty repo-scope request.
 * intelephense's `initialize` indexes the workspace before answering
 * `references`; doing it on worktree mount keeps the wait off the
 * first-render path for the diagram.
 */
export async function warmCodeGraph(workspacePath: string, ref: string): Promise<void> {
  try {
    await fetch(await apiUrl("/api/code-graph"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceRoot: workspacePath,
        ref,
        scope: "repo",
        files: [],
      }),
    });
  } catch {
    // Warm-up is best-effort. Real graph requests will retry.
  }
}
