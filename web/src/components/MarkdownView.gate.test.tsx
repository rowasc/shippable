// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResolvedImg } from "./MarkdownView";

afterEach(cleanup);

describe("ResolvedImg gate", () => {
  it("renders the image after the user clicks Load image", () => {
    render(
      <ResolvedImg src="https://tracker.example/pixel.png" alt="Tracker" baseDir="docs" imageAssets={{}} />,
    );

    expect(screen.queryByRole("img", { name: "Tracker" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load image" }));

    const img = screen.getByRole("img", { name: "Tracker" });
    expect(img.getAttribute("src")).toBe("https://tracker.example/pixel.png");
    expect(screen.queryByRole("button", { name: "Load image" })).toBeNull();
  });

  it("resets the gate when src changes on the same component instance", () => {
    // We render ResolvedImg directly — same component identity across
    // rerenders, so React reconciles instead of remounting. The reset has to
    // come from the explicit key={resolved.src} on ResolvedImgGate, not from
    // any remount-driven side effect.
    const { rerender } = render(
      <ResolvedImg src="https://a.example/pixel.png" alt="A" baseDir="docs" imageAssets={{}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load image" }));
    expect(screen.getByRole("img", { name: "A" }).getAttribute("src")).toBe("https://a.example/pixel.png");

    rerender(
      <ResolvedImg src="https://b.example/pixel.png" alt="B" baseDir="docs" imageAssets={{}} />,
    );

    expect(screen.queryByRole("img", { name: "B" })).toBeNull();
    expect(screen.queryByRole("img", { name: "A" })).toBeNull();
    expect(screen.getByRole("button", { name: "Load image" })).toBeTruthy();
    expect(screen.getByText("https://b.example/pixel.png")).toBeTruthy();
  });
});
