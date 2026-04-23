import type { ChangeSet, Reply } from "../types";
import { hunkSummaryReplyKey } from "../types";

export const CS_57: ChangeSet = {
  id: "cs-57",
  title: "Fix race condition in session hydration",
  author: "dan",
  branch: "fix/session-race",
  base: "main",
  createdAt: "2026-04-22T09:10:00Z",
  description:
    "Auth middleware could run before the session store finished hydrating on cold boot. Adds ensureSessionReady().",
  skills: [
    {
      id: "concurrency",
      label: "review concurrency / race conditions",
      reason: "introduces a mutex-style ready promise",
    },
  ],
  files: [
    {
      id: "cs-57/shared/types.ts",
      path: "shared/types.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-57/shared/types.ts#h1",
          header: "@@ -12,3 +12,8 @@ export interface Session",
          oldStart: 12,
          oldCount: 3,
          newStart: 12,
          newCount: 8,
          definesSymbols: ["SessionState"],
          lines: [
            { kind: "context", text: "  userId: string;", oldNo: 12, newNo: 12 },
            { kind: "context", text: "  expiresAt: number;", oldNo: 13, newNo: 13 },
            { kind: "context", text: "}", oldNo: 14, newNo: 14 },
            { kind: "add", text: "", newNo: 15 },
            { kind: "add", text: "export type SessionState =", newNo: 16 },
            { kind: "add", text: "  | { status: \"loading\" }", newNo: 17 },
            { kind: "add", text: "  | { status: \"ready\"; session: Session | null }", newNo: 18 },
            { kind: "add", text: "  | { status: \"error\"; error: Error };", newNo: 19 },
          ],
        },
      ],
    },
    {
      id: "cs-57/server/session.ts",
      path: "server/session.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-57/server/session.ts#h1",
          header: "@@ -3,6 +3,8 @@ import { readStore }",
          oldStart: 3,
          oldCount: 6,
          newStart: 3,
          newCount: 8,
          lines: [
            { kind: "context", text: "import { readStore } from \"./store\";", oldNo: 3, newNo: 3 },
            { kind: "context", text: "import type { Session } from \"../shared/types\";", oldNo: 4, newNo: 4 },
            { kind: "add", text: "import type { SessionState } from \"../shared/types\";", newNo: 5 },
            { kind: "context", text: "", oldNo: 5, newNo: 6 },
            { kind: "context", text: "let state: SessionState = { status: \"loading\" };", oldNo: 6, newNo: 7 },
            { kind: "add", text: "let readyPromise: Promise<void> | null = null;", newNo: 8 },
            { kind: "context", text: "", oldNo: 7, newNo: 9 },
            { kind: "context", text: "export function hydrate() {", oldNo: 8, newNo: 10 },
          ],
        },
        {
          id: "cs-57/server/session.ts#h2",
          header: "@@ -22,0 +26,14 @@ export function hydrate",
          oldStart: 22,
          oldCount: 0,
          newStart: 26,
          newCount: 14,
          definesSymbols: ["ensureSessionReady"],
          aiReviewed: true,
          aiSummary:
            "Memoizes a readiness promise and polls hydrate state. Concern: no timeout or cancel path — if hydrate never resolves the promise (and thus every awaiting request) hangs forever.",
          expandAbove: [
            // block 1 (nearest): the end of hydrate() + blank
            [
              { kind: "context", text: "}", oldNo: 22, newNo: 24 },
              { kind: "context", text: "", oldNo: 23, newNo: 25 },
            ],
            // block 2: hydrate()'s body and signature
            [
              { kind: "context", text: "export function hydrate(session: Session) {", oldNo: 20, newNo: 22 },
              { kind: "context", text: "  state = { status: \"ready\", session };", oldNo: 21, newNo: 23 },
            ],
            // block 3: top-of-file imports and shared state declaration
            [
              { kind: "context", text: "import { readStore } from \"./store\";", oldNo: 3, newNo: 3 },
              { kind: "context", text: "import type { Session } from \"../shared/types\";", oldNo: 4, newNo: 4 },
              { kind: "context", text: "", oldNo: 5, newNo: 6 },
            ],
          ],
          expandBelow: [
            [
              { kind: "context", text: "export function getSession(_req: unknown): Session | null {", oldNo: 22, newNo: 40 },
              { kind: "context", text: "  return state.status === \"ready\" ? state.session : null;", oldNo: 23, newNo: 41 },
              { kind: "context", text: "}", oldNo: 24, newNo: 42 },
            ],
            [
              { kind: "context", text: "", oldNo: 25, newNo: 43 },
              { kind: "context", text: "// EOF", oldNo: 26, newNo: 44 },
            ],
          ],
          lines: [
            { kind: "add", text: "export function ensureSessionReady(): Promise<void> {", newNo: 26 },
            {
              kind: "add",
              text: "  if (state.status !== \"loading\") return Promise.resolve();",
              newNo: 27,
              aiNote: {
                severity: "info",
                summary: "Fast path for already-ready / error",
                detail:
                  "Note this resolves even when state.status is 'error' — callers won't distinguish between 'session ready' and 'session subsystem failed.' Intentional?",
              },
            },
            { kind: "add", text: "  if (readyPromise) return readyPromise;", newNo: 28 },
            { kind: "add", text: "  readyPromise = new Promise((resolve, reject) => {", newNo: 29 },
            { kind: "add", text: "    const check = () => {", newNo: 30 },
            { kind: "add", text: "      if (state.status === \"ready\") resolve();", newNo: 31 },
            { kind: "add", text: "      else if (state.status === \"error\") reject(state.error);", newNo: 32 },
            {
              kind: "add",
              text: "      else setTimeout(check, 10);",
              newNo: 33,
              aiNote: {
                severity: "warning",
                summary: "Unbounded polling",
                detail:
                  "If hydrate() is never called, this polls forever. A timeout (e.g. 5s) with reject would bound the worst case. The test on line 35 `await sleep(20)` implicitly assumes 10ms polling, so any change here will need a test update.",
              },
            },
            { kind: "add", text: "    };", newNo: 34 },
            { kind: "add", text: "    check();", newNo: 35 },
            { kind: "add", text: "  });", newNo: 36 },
            { kind: "add", text: "  return readyPromise;", newNo: 37 },
            { kind: "add", text: "}", newNo: 38 },
            { kind: "add", text: "", newNo: 39 },
          ],
        },
      ],
    },
    {
      id: "cs-57/server/middleware/auth.ts",
      path: "server/middleware/auth.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-57/server/middleware/auth.ts#h1",
          header: "@@ -1,3 +1,4 @@",
          oldStart: 1,
          oldCount: 3,
          newStart: 1,
          newCount: 4,
          lines: [
            { kind: "context", text: "import type { Request, Response, NextFunction } from \"express\";", oldNo: 1, newNo: 1 },
            { kind: "context", text: "import { getSession } from \"../session\";", oldNo: 2, newNo: 2 },
            { kind: "add", text: "import { ensureSessionReady } from \"../session\";", newNo: 3 },
            { kind: "context", text: "", oldNo: 3, newNo: 4 },
          ],
        },
        {
          id: "cs-57/server/middleware/auth.ts#h2",
          header: "@@ -8,3 +9,4 @@ export async function authMiddleware",
          oldStart: 8,
          oldCount: 3,
          newStart: 9,
          newCount: 4,
          referencesSymbols: ["ensureSessionReady"],
          teammateReview: {
            user: "mina",
            verdict: "approve",
            note: "timeout budget looks fine given our boot SLO",
          },
          lines: [
            { kind: "context", text: "export async function authMiddleware(req: Request, res: Response, next: NextFunction) {", oldNo: 8, newNo: 9 },
            {
              kind: "add",
              text: "  await ensureSessionReady();",
              newNo: 10,
              aiNote: {
                severity: "info",
                summary: "Call site for the new helper",
                detail:
                  "If you haven't reviewed ensureSessionReady in server/session.ts yet, the unbounded polling there means this await could hang the first request after boot on a pathological failure. On the happy path this is a few ms.",
              },
            },
            { kind: "context", text: "  const session = getSession(req);", oldNo: 9, newNo: 11 },
            { kind: "context", text: "  if (!session) return res.status(401).end();", oldNo: 10, newNo: 12 },
          ],
        },
      ],
    },
    {
      id: "cs-57/test/session.test.ts",
      path: "test/session.test.ts",
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: "cs-57/test/session.test.ts#h1",
          header: "@@ -30,0 +31,16 @@ describe(\"session\"",
          oldStart: 30,
          oldCount: 0,
          newStart: 31,
          newCount: 16,
          lines: [
            { kind: "add", text: "  it(\"ensureSessionReady waits for hydrate\", async () => {", newNo: 31 },
            { kind: "add", text: "    const p = ensureSessionReady();", newNo: 32 },
            { kind: "add", text: "    let resolved = false;", newNo: 33 },
            { kind: "add", text: "    p.then(() => { resolved = true; });", newNo: 34 },
            { kind: "add", text: "    await sleep(20);", newNo: 35 },
            { kind: "add", text: "    expect(resolved).toBe(false);", newNo: 36 },
            { kind: "add", text: "    hydrate(fakeSession);", newNo: 37 },
            { kind: "add", text: "    await p;", newNo: 38 },
            { kind: "add", text: "    expect(resolved).toBe(true);", newNo: 39 },
            { kind: "add", text: "  });", newNo: 40 },
            { kind: "add", text: "", newNo: 41 },
            { kind: "add", text: "  it(\"resolves immediately if already ready\", async () => {", newNo: 42 },
            { kind: "add", text: "    hydrate(fakeSession);", newNo: 43 },
            { kind: "add", text: "    await ensureSessionReady();", newNo: 44 },
            { kind: "add", text: "    // no timeout = pass", newNo: 45 },
            { kind: "add", text: "  });", newNo: 46 },
          ],
        },
      ],
    },
  ],
};

export const REPLIES_57: Record<string, Reply[]> = {
  // thread on the hunk summary about ensureSessionReady
  [hunkSummaryReplyKey("cs-57/server/session.ts#h2")]: [
    {
      id: "r3",
      author: "mina",
      body: "+1 on adding a timeout. 5s feels right given our boot SLO.",
      createdAt: "2026-04-22T09:55:00Z",
    },
  ],
};
