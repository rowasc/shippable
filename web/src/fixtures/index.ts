import type { ChangeSet, Reply } from "../types";
import { CS_42, REPLIES_42 } from "./cs-42-preferences";
import { CS_57, REPLIES_57 } from "./cs-57-session-race";

/**
 * Sample changesets the app boots with. Add a new changeset by creating a new
 * file in this folder and appending it here; reply threads merge the same way.
 */
export const CHANGESETS: ChangeSet[] = [CS_42, CS_57];

export const SEED_REPLIES: Record<string, Reply[]> = {
  ...REPLIES_42,
  ...REPLIES_57,
};
