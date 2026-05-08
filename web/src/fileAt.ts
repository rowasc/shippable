import { postJson } from "./apiClient";

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
  const { content } = await postJson<{ content: string }>(
    "/api/worktrees/file-at",
    {
      path: args.worktreePath,
      sha: args.sha,
      file: args.file,
    },
  );
  return content;
}
