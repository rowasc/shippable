import type { ChangeSet } from "../types";

// Powers the "agent integration" segment of the demo reel — see the
// trailing frames in `web/src/components/Demo.tsx`. A tight server-side
// change that gives us three sensible reviewer comments to anchor the
// queue → fetch → reply lifecycle: a line comment, a reply-to-AI-note,
// and a block comment over a deletion run. The diff is intentionally
// small so captioned frames have room to breathe.

export const CS_91: ChangeSet = {
  id: "cs-91",
  title: "Validate worktree path on agent enqueue",
  author: "luiz",
  branch: "fix/agent-enqueue-guard",
  base: "main",
  createdAt: "2026-05-06T09:30:00Z",
  description:
    "Lifts assertGitDir into agent-queue so every enqueue path validates the worktree, not just the HTTP route. Drops the now-redundant check from the route handler.",
  worktreeSource: {
    worktreePath: "/Users/you/code/shippable-agent-flow",
    commitSha: "a3c91d7e2b40fa19c8d05b6f7e1a91e7f0d34c12",
    branch: "fix/agent-enqueue-guard",
  },
  files: [
    {
      id: "cs-91/server/src/agent-queue.ts",
      path: "server/src/agent-queue.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-91/server/src/agent-queue.ts#h1",
          header: "@@ -3,9 +3,16 @@ export interface EnqueueArgs",
          oldStart: 3,
          oldCount: 9,
          newStart: 3,
          newCount: 16,
          lines: [
            { kind: "context", text: "import type { Comment, EnqueueArgs } from \"./types\";", oldNo: 3, newNo: 3 },
            { kind: "add", text: "import { assertGitDir } from \"./worktree-validation\";", newNo: 4 },
            { kind: "context", text: "", oldNo: 4, newNo: 5 },
            { kind: "context", text: "const queues = new Map<string, Queue>();", oldNo: 5, newNo: 6 },
            { kind: "context", text: "", oldNo: 6, newNo: 7 },
            { kind: "context", text: "export function enqueueComment(args: EnqueueArgs): { id: string } {", oldNo: 7, newNo: 8 },
            { kind: "context", text: "  const { worktreePath, comment } = args;", oldNo: 8, newNo: 9 },
            { kind: "add", text: "  if (!assertGitDir(worktreePath)) return { id: \"\" };", newNo: 10 },
            { kind: "add", text: "", newNo: 11 },
            { kind: "context", text: "  const queue = queues.get(worktreePath) ?? createQueue();", oldNo: 9, newNo: 12 },
            { kind: "context", text: "  const id = `cmt_${randomId()}`;", oldNo: 10, newNo: 13 },
            { kind: "add", text: "  queue.pending.push({ ...comment, id, enqueuedAt: now() });", newNo: 14 },
            { kind: "context", text: "  queues.set(worktreePath, queue);", oldNo: 11, newNo: 15 },
            { kind: "context", text: "  return { id };", oldNo: 12, newNo: 16 },
          ],
        },
      ],
    },
    {
      id: "cs-91/server/src/index.ts",
      path: "server/src/index.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-91/server/src/index.ts#h1",
          header: "@@ -41,12 +41,7 @@ app.post(\"/api/agent/enqueue\"",
          oldStart: 41,
          oldCount: 12,
          newStart: 41,
          newCount: 7,
          lines: [
            { kind: "context", text: "app.post(\"/api/agent/enqueue\", async (req, res) => {", oldNo: 41, newNo: 41 },
            { kind: "context", text: "  const args = parseEnqueue(req.body);", oldNo: 42, newNo: 42 },
            { kind: "context", text: "  if (!args) return res.status(400).json({ error: \"bad request\" });", oldNo: 43, newNo: 43 },
            { kind: "del", text: "  // belt-and-suspenders: route also rejects non-git dirs", oldNo: 44 },
            { kind: "del", text: "  if (!assertGitDir(args.worktreePath)) {", oldNo: 45 },
            { kind: "del", text: "    return res.status(400).json({ error: \"not a git worktree\" });", oldNo: 46 },
            { kind: "del", text: "  }", oldNo: 47 },
            { kind: "del", text: "", oldNo: 48 },
            { kind: "context", text: "  const result = enqueueComment(args);", oldNo: 49, newNo: 44 },
            { kind: "context", text: "  res.json(result);", oldNo: 50, newNo: 45 },
            { kind: "context", text: "});", oldNo: 51, newNo: 46 },
          ],
        },
      ],
    },
  ],
};

