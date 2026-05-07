import { apiUrl } from "./apiUrl";

interface FileAtResponse {
  content: string;
}
type ErrorResponse = { error: string };

/**
 * Fetch a file's contents at a specific commit, via `git show <sha>:<file>`
 * on the server. Backs the live-reload "view at <sha7>" affordance on
 * detached committed comments. Throws with a readable message on failure.
 */
export async function fetchFileAt(args: {
  worktreePath: string;
  sha: string;
  file: string;
}): Promise<string> {
  const res = await fetch(await apiUrl("/api/worktrees/file-at"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: args.worktreePath,
      sha: args.sha,
      file: args.file,
    }),
  });
  const json = (await res.json()) as FileAtResponse | ErrorResponse;
  if (!res.ok || "error" in json) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  return json.content;
}
