import type { ChangeSet, Reply } from "./types";
import {
  lineNoteReplyKey,
  hunkSummaryReplyKey,
  teammateReplyKey,
  userCommentKey,
} from "./types";

export const CHANGESETS: ChangeSet[] = [
  {
    id: "cs-42",
    title: "Add user preferences panel",
    author: "romina",
    branch: "feat/user-preferences",
    base: "main",
    createdAt: "2026-04-21T14:22:00Z",
    description:
      "Adds a preferences panel backed by localStorage. New loadPrefs/savePrefs helpers live in utils/storage.",
    skills: [
      {
        id: "react-accessibility",
        label: "review React accessibility",
        reason: "touches new form controls in PreferencesPanel",
      },
      {
        id: "browser-storage",
        label: "review browser storage usage",
        reason: "introduces localStorage read/write in utils/storage",
      },
    ],
    files: [
      {
        id: "cs-42/src/types/user.ts",
        path: "src/types/user.ts",
        language: "ts",
        status: "modified",
        hunks: [
          {
            id: "cs-42/src/types/user.ts#h1",
            header: "@@ -4,6 +4,14 @@ export interface User",
            oldStart: 4,
            oldCount: 6,
            newStart: 4,
            newCount: 14,
            definesSymbols: ["Preferences"],
            expandAbove: [
              // nearest: blank separator above User interface
              [{ kind: "context", text: "", oldNo: 3, newNo: 3 }],
              // next: imports at the top of the file
              [
                { kind: "context", text: "// shared user-facing types", oldNo: 1, newNo: 1 },
                { kind: "context", text: "import type { Locale } from \"../i18n\";", oldNo: 2, newNo: 2 },
              ],
            ],
            expandBelow: [
              // nearest: blank + first declaration below Preferences
              [
                { kind: "context", text: "", oldNo: 11, newNo: 16 },
                { kind: "context", text: "export type UserId = User[\"id\"];", oldNo: 12, newNo: 17 },
              ],
              // further: second declaration
              [{ kind: "context", text: "export type LocaleCode = Locale[\"code\"];", oldNo: 13, newNo: 18 }],
            ],
            lines: [
              { kind: "context", text: "export interface User {", oldNo: 4, newNo: 4 },
              { kind: "context", text: "  id: string;", oldNo: 5, newNo: 5 },
              { kind: "context", text: "  email: string;", oldNo: 6, newNo: 6 },
              { kind: "context", text: "  name: string;", oldNo: 7, newNo: 7 },
              { kind: "add", text: "  preferences?: Preferences;", newNo: 8 },
              { kind: "context", text: "}", oldNo: 8, newNo: 9 },
              { kind: "context", text: "", oldNo: 9, newNo: 10 },
              { kind: "add", text: "export interface Preferences {" , newNo: 11 },
              { kind: "add", text: "  theme: \"light\" | \"dark\" | \"system\";", newNo: 12 },
              { kind: "add", text: "  compactMode: boolean;", newNo: 13 },
              { kind: "add", text: "  notifyOnMention: boolean;", newNo: 14 },
              { kind: "add", text: "}", newNo: 15 },
            ],
          },
        ],
        fullContent: [
          { kind: "context", text: "// shared user-facing types", newNo: 1 },
          { kind: "context", text: "import type { Locale } from \"../i18n\";", newNo: 2 },
          { kind: "context", text: "", newNo: 3 },
          { kind: "context", text: "export interface User {", newNo: 4 },
          { kind: "context", text: "  id: string;", newNo: 5 },
          { kind: "context", text: "  email: string;", newNo: 6 },
          { kind: "context", text: "  name: string;", newNo: 7 },
          { kind: "add", text: "  preferences?: Preferences;", newNo: 8 },
          { kind: "context", text: "}", newNo: 9 },
          { kind: "context", text: "", newNo: 10 },
          { kind: "add", text: "export interface Preferences {", newNo: 11 },
          { kind: "add", text: "  theme: \"light\" | \"dark\" | \"system\";", newNo: 12 },
          { kind: "add", text: "  compactMode: boolean;", newNo: 13 },
          { kind: "add", text: "  notifyOnMention: boolean;", newNo: 14 },
          { kind: "add", text: "}", newNo: 15 },
          { kind: "context", text: "", newNo: 16 },
          { kind: "context", text: "export type UserId = User[\"id\"];", newNo: 17 },
          { kind: "context", text: "export type LocaleCode = Locale[\"code\"];", newNo: 18 },
        ],
      },
      {
        id: "cs-42/src/utils/storage.ts",
        path: "src/utils/storage.ts",
        language: "ts",
        status: "modified",
        hunks: [
          {
            id: "cs-42/src/utils/storage.ts#h1",
            header: "@@ -1,3 +1,5 @@",
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 5,
            lines: [
              { kind: "context", text: "import type { User } from \"../types/user\";", oldNo: 1, newNo: 1 },
              { kind: "add", text: "import type { Preferences } from \"../types/user\";", newNo: 2 },
              { kind: "context", text: "", oldNo: 2, newNo: 3 },
              { kind: "context", text: "const USER_KEY = \"critica:user\";", oldNo: 3, newNo: 4 },
              { kind: "add", text: "const PREFS_KEY = \"critica:prefs\";", newNo: 5 },
            ],
          },
          {
            id: "cs-42/src/utils/storage.ts#h2",
            header: "@@ -20,4 +22,24 @@ export function saveUser",
            oldStart: 20,
            oldCount: 4,
            newStart: 22,
            newCount: 24,
            definesSymbols: ["loadPrefs", "savePrefs"],
            aiReviewed: true,
            aiSummary:
              "Straightforward localStorage wrapper. Two worth-a-look items: the try/catch in loadPrefs swallows parse errors silently, and savePrefs has no quota-exceeded handling.",
            expandAbove: [
              // block 1 (nearest): remaining body of saveUser above the hunk
              [{ kind: "context", text: "  u = normalize(u);", oldNo: 19, newNo: 21 }],
              // block 2: saveUser's signature + its leading comment
              [
                { kind: "context", text: "// called on every auth transition", oldNo: 17, newNo: 19 },
                { kind: "context", text: "export function saveUser(u: User): void {", oldNo: 18, newNo: 20 },
              ],
              // block 3: file-top constants and imports
              [
                { kind: "context", text: "import type { User } from \"../types/user\";", oldNo: 1, newNo: 1 },
                { kind: "context", text: "", oldNo: 2, newNo: 3 },
                { kind: "context", text: "const USER_KEY = \"critica:user\";", oldNo: 3, newNo: 4 },
                { kind: "context", text: "", oldNo: 4, newNo: 6 },
              ],
            ],
            expandBelow: [
              [{ kind: "context", text: "", oldNo: 24, newNo: 39 }],
              [{ kind: "context", text: "// EOF", oldNo: 25, newNo: 40 }],
            ],
            lines: [
              { kind: "context", text: "  localStorage.setItem(USER_KEY, JSON.stringify(u));", oldNo: 20, newNo: 22 },
              { kind: "context", text: "}", oldNo: 21, newNo: 23 },
              { kind: "context", text: "", oldNo: 22, newNo: 24 },
              { kind: "add", text: "export function loadPrefs(): Preferences | null {", newNo: 25 },
              { kind: "add", text: "  const raw = localStorage.getItem(PREFS_KEY);", newNo: 26 },
              { kind: "add", text: "  if (!raw) return null;", newNo: 27 },
              {
                kind: "add",
                text: "  try {",
                newNo: 28,
                aiNote: {
                  severity: "warning",
                  summary: "Silent swallow on parse failure",
                  detail:
                    "If the stored JSON is corrupt, loadPrefs returns null and the app silently resets to defaults — the user loses their settings with no warning. Consider logging, or clearing the corrupted key so a subsequent load doesn't retry parsing the same garbage.",
                },
              },
              { kind: "add", text: "    return JSON.parse(raw) as Preferences;", newNo: 29 },
              {
                kind: "add",
                text: "  } catch {",
                newNo: 30,
                aiNote: {
                  severity: "question",
                  summary: "Cast is unchecked",
                  detail:
                    "`as Preferences` trusts whatever was in storage. A stale older-schema value will type-check at parse but blow up when a new field is read. If schema changes, consider a validator (zod / manual shape check).",
                },
              },
              { kind: "add", text: "    return null;", newNo: 31 },
              { kind: "add", text: "  }", newNo: 32 },
              { kind: "add", text: "}", newNo: 33 },
              { kind: "add", text: "", newNo: 34 },
              { kind: "add", text: "export function savePrefs(p: Preferences): void {", newNo: 35 },
              {
                kind: "add",
                text: "  localStorage.setItem(PREFS_KEY, JSON.stringify(p));",
                newNo: 36,
                aiNote: {
                  severity: "warning",
                  summary: "No quota-exceeded handling",
                  detail:
                    "localStorage.setItem throws DOMException('QuotaExceededError') on some browsers/private modes. This will bubble up through the React handler and likely crash the form. Wrap in try/catch or feature-detect.",
                },
              },
              { kind: "add", text: "}", newNo: 37 },
              { kind: "context", text: "", oldNo: 23, newNo: 38 },
            ],
          },
        ],
      },
      {
        id: "cs-42/src/components/PreferencesPanel.tsx",
        path: "src/components/PreferencesPanel.tsx",
        language: "tsx",
        status: "added",
        hunks: [
          {
            id: "cs-42/src/components/PreferencesPanel.tsx#h1",
            header: "@@ -0,0 +1,36 @@",
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 36,
            referencesSymbols: ["loadPrefs", "savePrefs"],
            aiSummary:
              "Small component, reasonable shape. Two gaps worth flagging: only `theme` is actually rendered (compactMode / notifyOnMention are declared but never surfaced), and `update` writes synchronously on every keystroke.",
            teammateReview: {
              user: "dan",
              verdict: "comment",
              note: "a11y labels on the toggles look good to me",
            },
            lines: [
              { kind: "add", text: "import { useEffect, useState } from \"react\";", newNo: 1 },
              { kind: "add", text: "import { loadPrefs, savePrefs } from \"../utils/storage\";", newNo: 2 },
              { kind: "add", text: "import type { Preferences } from \"../types/user\";", newNo: 3 },
              { kind: "add", text: "", newNo: 4 },
              { kind: "add", text: "const DEFAULTS: Preferences = {", newNo: 5 },
              { kind: "add", text: "  theme: \"system\",", newNo: 6 },
              { kind: "add", text: "  compactMode: false,", newNo: 7 },
              { kind: "add", text: "  notifyOnMention: true,", newNo: 8 },
              { kind: "add", text: "};", newNo: 9 },
              { kind: "add", text: "", newNo: 10 },
              { kind: "add", text: "export function PreferencesPanel() {", newNo: 11 },
              { kind: "add", text: "  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);", newNo: 12 },
              { kind: "add", text: "", newNo: 13 },
              { kind: "add", text: "  useEffect(() => {", newNo: 14 },
              {
                kind: "add",
                text: "    const stored = loadPrefs();",
                newNo: 15,
                aiNote: {
                  severity: "info",
                  summary: "Reads from storage on mount",
                  detail:
                    "Call site for loadPrefs. If you haven't already, review the definition in src/utils/storage.ts — its parse error handling is the main thing that governs what you get back here.",
                },
              },
              { kind: "add", text: "    if (stored) setPrefs(stored);", newNo: 16 },
              { kind: "add", text: "  }, []);", newNo: 17 },
              { kind: "add", text: "", newNo: 18 },
              { kind: "add", text: "  function update<K extends keyof Preferences>(k: K, v: Preferences[K]) {", newNo: 19 },
              { kind: "add", text: "    const next = { ...prefs, [k]: v };", newNo: 20 },
              { kind: "add", text: "    setPrefs(next);", newNo: 21 },
              {
                kind: "add",
                text: "    savePrefs(next);",
                newNo: 22,
                aiNote: {
                  severity: "question",
                  summary: "Synchronous write on every keystroke",
                  detail:
                    "For the current fields (select + booleans) this is fine — one write per user action. If text inputs are added later, you'll want to debounce. Not blocking for this PR.",
                },
              },
              { kind: "add", text: "  }", newNo: 23 },
              { kind: "add", text: "", newNo: 24 },
              { kind: "add", text: "  return (", newNo: 25 },
              { kind: "add", text: "    <form aria-label=\"Preferences\">", newNo: 26 },
              {
                kind: "add",
                text: "      <label>Theme",
                newNo: 27,
                aiNote: {
                  severity: "warning",
                  summary: "Only `theme` is rendered",
                  detail:
                    "DEFAULTS declares `compactMode` and `notifyOnMention`, but the returned JSX only exposes the theme selector. Either add controls for the other two or trim DEFAULTS to match what's shipped.",
                },
              },
              { kind: "add", text: "        <select value={prefs.theme} onChange={e => update(\"theme\", e.target.value as Preferences[\"theme\"])}>", newNo: 28 },
              { kind: "add", text: "          <option value=\"system\">System</option>", newNo: 29 },
              { kind: "add", text: "          <option value=\"light\">Light</option>", newNo: 30 },
              { kind: "add", text: "          <option value=\"dark\">Dark</option>", newNo: 31 },
              { kind: "add", text: "        </select>", newNo: 32 },
              { kind: "add", text: "      </label>", newNo: 33 },
              { kind: "add", text: "    </form>", newNo: 34 },
              { kind: "add", text: "  );", newNo: 35 },
              { kind: "add", text: "}", newNo: 36 },
            ],
          },
        ],
      },
      {
        id: "cs-42/src/components/__tests__/PreferencesPanel.test.tsx",
        path: "src/components/__tests__/PreferencesPanel.test.tsx",
        language: "tsx",
        status: "added",
        hunks: [
          {
            id: "cs-42/src/components/__tests__/PreferencesPanel.test.tsx#h1",
            header: "@@ -0,0 +1,18 @@",
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 18,
            aiReviewed: true,
            lines: [
              { kind: "add", text: "import { render, screen } from \"@testing-library/react\";", newNo: 1 },
              { kind: "add", text: "import { PreferencesPanel } from \"../PreferencesPanel\";", newNo: 2 },
              { kind: "add", text: "", newNo: 3 },
              { kind: "add", text: "describe(\"PreferencesPanel\", () => {", newNo: 4 },
              { kind: "add", text: "  beforeEach(() => localStorage.clear());", newNo: 5 },
              { kind: "add", text: "", newNo: 6 },
              { kind: "add", text: "  it(\"renders with defaults when nothing stored\", () => {", newNo: 7 },
              { kind: "add", text: "    render(<PreferencesPanel />);", newNo: 8 },
              { kind: "add", text: "    expect(screen.getByLabelText(\"Theme\")).toHaveValue(\"system\");", newNo: 9 },
              { kind: "add", text: "  });", newNo: 10 },
              { kind: "add", text: "", newNo: 11 },
              { kind: "add", text: "  it(\"persists changes via savePrefs\", async () => {", newNo: 12 },
              { kind: "add", text: "    render(<PreferencesPanel />);", newNo: 13 },
              { kind: "add", text: "    // …", newNo: 14 },
              { kind: "add", text: "  });", newNo: 15 },
              { kind: "add", text: "});", newNo: 16 },
              { kind: "add", text: "", newNo: 17 },
              {
                kind: "add",
                text: "// TODO: add a test for dark-mode toggle",
                newNo: 18,
                aiNote: {
                  severity: "question",
                  summary: "Unaddressed TODO in a test file",
                  detail:
                    "Tracking TODOs in tests tends to rot. If this is acceptable to merge, consider filing an issue with the TODO number instead.",
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
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
  },
];

export const SEED_REPLIES: Record<string, Reply[]> = {
  // cs-42: thread on the "silent swallow" warning at storage.ts:28
  [lineNoteReplyKey("cs-42/src/utils/storage.ts#h2", 6)]: [
    {
      id: "r1",
      author: "dan",
      body: "Agree. Clearing the key on parse failure is probably safer — a stale v1 blob would otherwise keep re-crashing every mount.",
      createdAt: "2026-04-22T10:14:00Z",
    },
  ],
  // cs-42: thread on the teammate note in PreferencesPanel.tsx
  [teammateReplyKey("cs-42/src/components/PreferencesPanel.tsx#h1")]: [
    {
      id: "r2",
      author: "romina",
      body: "Thanks for checking! Still need to wire the other two fields, noted.",
      createdAt: "2026-04-22T10:30:00Z",
    },
  ],
  // cs-57: thread on the hunk summary about ensureSessionReady
  [hunkSummaryReplyKey("cs-57/server/session.ts#h2")]: [
    {
      id: "r3",
      author: "mina",
      body: "+1 on adding a timeout. 5s feels right given our boot SLO.",
      createdAt: "2026-04-22T09:55:00Z",
    },
  ],
  // cs-42: reviewer-started comment on notifyOnMention default (no AI note here)
  [userCommentKey("cs-42/src/components/PreferencesPanel.tsx#h1", 7)]: [
    {
      id: "u1",
      author: "dan",
      body: "Is `true` really the right default here? Some users find mention pings noisy out-of-the-box.",
      createdAt: "2026-04-22T11:05:00Z",
    },
    {
      id: "u2",
      author: "romina",
      body: "Fair — happy to flip it to false. @product said either way is fine.",
      createdAt: "2026-04-22T11:20:00Z",
    },
  ],
};
