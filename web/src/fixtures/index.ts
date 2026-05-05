import type { Stub } from "./dev-stubs";

export type { Stub };

/**
 * Sample changesets shipped for development. The boot list is empty in
 * production: stubs ship through a separate chunk (`dev-stubs.ts`) that
 * is only imported behind `import.meta.env.DEV`. Vite folds DEV at build
 * time and drops the chunk for prod bundles.
 *
 * Top-level await loads the stubs at module-init in dev. This keeps the
 * call-side API synchronous (`STUBS`, `findStub`) so boot can resolve
 * `?c=09` immediately, no async dance.
 */
const STUBS_IMPL: Stub[] = import.meta.env.DEV
  ? (await import("./dev-stubs")).ALL_STUBS
  : [];

export const STUBS: Stub[] = STUBS_IMPL;

/** Look up a stub by its short code (e.g. `09`) or full id (e.g. `cs-09`). */
export function findStub(codeOrId: string): Stub | undefined {
  for (const s of STUBS) {
    if (s.code === codeOrId) return s;
    if (s.changeset.id === codeOrId) return s;
    if (s.changeset.id === `cs-${codeOrId}`) return s;
    if (s.changeset.id.replace(/^cs-/, "") === codeOrId) return s;
  }
  return undefined;
}
