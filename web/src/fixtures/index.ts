import type { ChangeSet, Reply } from "../types";
import { CS_09, REPLIES_09 } from "./cs-09-php-helpers";
import { CS_21, REPLIES_21 } from "./cs-21-number-helpers";
import { CS_31, REPLIES_31 } from "./cs-31-text-helpers";
import { CS_42, REPLIES_42 } from "./cs-42-preferences";
import { CS_57, REPLIES_57 } from "./cs-57-session-race";
import { CS_72, REPLIES_72 } from "./cs-72-docs-preview";

/**
 * Sample changesets the app boots with. Add a new changeset by creating a new
 * file in this folder and appending it here; reply threads merge the same way.
 */
export const CHANGESETS: ChangeSet[] = [CS_42, CS_57, CS_09, CS_21, CS_31, CS_72];

export const SEED_REPLIES: Record<string, Reply[]> = {
  ...REPLIES_09,
  ...REPLIES_21,
  ...REPLIES_31,
  ...REPLIES_42,
  ...REPLIES_57,
  ...REPLIES_72,
};
