// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LineContextMenu, type ContextMenuItem } from "./LineContextMenu";

afterEach(cleanup);

function buildItems(overrides: Partial<ContextMenuItem>[] = []): ContextMenuItem[] {
  const base: ContextMenuItem[] = [
    { id: "comment", label: "Comment", shortcut: "c", enabled: true, onSelect: vi.fn() },
    { id: "prompt", label: "Run prompt…", shortcut: "/", enabled: true, onSelect: vi.fn() },
    { id: "reply", label: "Reply to AI", shortcut: "r", enabled: false, onSelect: vi.fn() },
    { id: "read", label: "Mark as read", enabled: true, onSelect: vi.fn() },
  ];
  return base.map((item, idx) => ({ ...item, ...(overrides[idx] ?? {}) }));
}

describe("LineContextMenu", () => {
  it("renders every item with its shortcut as a kbd", () => {
    render(
      <LineContextMenu x={50} y={50} items={buildItems()} onClose={() => undefined} />,
    );
    expect(screen.getByRole("menuitem", { name: /Comment/ })).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("/")).toBeTruthy();
  });

  it("disabled items do not fire onSelect on click", () => {
    const items = buildItems();
    render(
      <LineContextMenu x={50} y={50} items={items} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Reply to AI/ }));
    expect(items[2].onSelect).not.toHaveBeenCalled();
  });

  it("clicking an enabled item fires onSelect then onClose", () => {
    const items = buildItems();
    const onClose = vi.fn();
    render(
      <LineContextMenu x={50} y={50} items={items} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment/ }));
    expect(items[0].onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(
      <LineContextMenu x={50} y={50} items={buildItems()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown + Enter activates the next enabled item, skipping disabled", () => {
    const items = buildItems();
    render(
      <LineContextMenu x={50} y={50} items={items} onClose={() => undefined} />,
    );
    // Initial activeIdx is the first enabled item (Comment, idx 0).
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → prompt (1)
    fireEvent.keyDown(document, { key: "ArrowDown" }); // skip disabled reply → mark-read (3)
    fireEvent.keyDown(document, { key: "Enter" });
    expect(items[3].onSelect).toHaveBeenCalled();
  });

  it("Tab calls onClose so the menu doesn't linger after focus moves", () => {
    const onClose = vi.fn();
    render(
      <LineContextMenu x={50} y={50} items={buildItems()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Tab" });
    expect(onClose).toHaveBeenCalled();
  });

  it("items without a shortcut render no kbd", () => {
    const items: ContextMenuItem[] = [
      { id: "comment", label: "Comment", shortcut: "c", enabled: true, onSelect: vi.fn() },
      { id: "read", label: "Mark as read", enabled: true, onSelect: vi.fn() },
    ];
    const { container } = render(
      <LineContextMenu x={50} y={50} items={items} onClose={() => undefined} />,
    );
    expect(container.querySelectorAll("kbd").length).toBe(1);
  });

  it("the menu has an aria-label so screen readers identify it", () => {
    render(
      <LineContextMenu x={50} y={50} items={buildItems()} onClose={() => undefined} />,
    );
    expect(screen.getByRole("menu", { name: "Line actions" })).toBeTruthy();
  });

  it("clicking outside the menu calls onClose", () => {
    const onClose = vi.fn();
    render(
      <div>
        <LineContextMenu x={50} y={50} items={buildItems()} onClose={onClose} />
        <button data-testid="outside">outside</button>
      </div>,
    );
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
