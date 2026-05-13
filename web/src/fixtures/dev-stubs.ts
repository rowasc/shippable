/**
 * dev-stubs.ts — sample changesets bundled into dev/showcase builds only.
 * Imported lazily via `fixtures/index.ts` behind an `import.meta.env.DEV`
 * guard so production bundles drop this whole chunk.
 */

import type { ChangeSet, Interaction } from "../types";
import { CS_09, INTERACTIONS_09 } from "./cs-09-php-helpers";
import { CS_21, INTERACTIONS_21 } from "./cs-21-number-helpers";
import { CS_31, INTERACTIONS_31 } from "./cs-31-text-helpers";
import { CS_42, INTERACTIONS_42 } from "./cs-42-preferences";
import { CS_57, INTERACTIONS_57 } from "./cs-57-session-race";
import { CS_72, INTERACTIONS_72 } from "./cs-72-docs-preview";
import { CS_99, INTERACTIONS_99 } from "./cs-99-verify-features";

export interface Stub {
  code: string;
  changeset: ChangeSet;
  /**
   * Seeded thread state for this changeset — AI annotations, teammate
   * reviews, and user-authored reviewer replies, all flat in one map.
   */
  interactions: Record<string, Interaction[]>;
}

export const ALL_STUBS: Stub[] = [
  { code: "42", changeset: CS_42, interactions: INTERACTIONS_42 },
  { code: "57", changeset: CS_57, interactions: INTERACTIONS_57 },
  { code: "09", changeset: CS_09, interactions: INTERACTIONS_09 },
  { code: "21", changeset: CS_21, interactions: INTERACTIONS_21 },
  { code: "31", changeset: CS_31, interactions: INTERACTIONS_31 },
  { code: "72", changeset: CS_72, interactions: INTERACTIONS_72 },
  { code: "99", changeset: CS_99, interactions: INTERACTIONS_99 },
];
