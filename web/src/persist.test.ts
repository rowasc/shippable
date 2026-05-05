// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSession, peekSession } from "./persist";

const STORAGE_KEY = "shippable:review:v1";

afterEach(() => {
  localStorage.clear();
});

// Bug class: an older client encountering a snapshot written by a newer
// version of the app must not pretend to load it. The migration table is
// forward-only, so a v: 999 blob has no path back to the head we know about.
// Failing closed = same behavior as a malformed blob: peek → null,
// load → empty hydration. Anything else risks corrupt state on disk.
describe("persist — unknown future version fails closed", () => {
  it("peekSession returns null for v greater than CURRENT_VERSION", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 999,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        ackedNotes: [],
        replies: {},
        drafts: {},
      }),
    );
    expect(peekSession()).toBeNull();
  });

  it("loadSession returns empty hydration for v greater than CURRENT_VERSION", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 999,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        ackedNotes: [],
        replies: {},
        drafts: {},
      }),
    );
    expect(loadSession([])).toEqual({ state: null, drafts: {} });
  });
});
