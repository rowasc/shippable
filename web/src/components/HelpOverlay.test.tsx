// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HelpOverlay } from "./HelpOverlay";

afterEach(cleanup);

describe("HelpOverlay", () => {
  it("renders a contextual section ahead of the full shortcut table", () => {
    render(
      <HelpOverlay
        context={{
          title: "right now: selection active",
          rows: [
            { chord: "c", label: "start a comment on this selection" },
            { chord: "Esc", label: "collapse the selection" },
          ],
          hint: "Selection commands are local to the diff.",
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("right now: selection active")).toBeTruthy();
    expect(screen.getByText("start a comment on this selection")).toBeTruthy();
    expect(screen.getByText("collapse the selection")).toBeTruthy();
    expect(screen.getByText("Selection commands are local to the diff.")).toBeTruthy();
    expect(screen.getByText("all shortcuts")).toBeTruthy();
  });
});
