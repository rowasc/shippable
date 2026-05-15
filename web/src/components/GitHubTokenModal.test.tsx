// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GitHubTokenModal } from "./GitHubTokenModal";
import { within } from "@testing-library/dom";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("GitHubTokenModal", () => {
  it("calls onSubmit with host and token when the user types a token and clicks save", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <GitHubTokenModal
        host="github.com"
        reason="first-time"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByPlaceholderText("ghp_…");
    fireEvent.change(input, { target: { value: "ghp_abc123" } });

    const button = screen.getByRole("button", { name: /save token for github\.com/i });
    fireEvent.click(button);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("github.com", "ghp_abc123"));
  });

  it("renders the first-time copy when reason is first-time", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/needs a GitHub Personal Access Token/i)).toBeTruthy();
  });

  it("renders the rejection copy with the error class when reason is rejected", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const msg = screen.getByText(/rejected the saved token/i);
    expect(msg).toBeTruthy();
    // Prominent error styling — not the subtle hint style.
    expect(msg.className).toContain("modal__hint--error");
  });

  it("renders rate-limit copy when hint is rate-limit", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        hint="rate-limit"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Rate-limit advice should NOT tell the user to regenerate a token —
    // their token is probably fine.
    expect(screen.getByText(/rate-limited/i)).toBeTruthy();
    expect(screen.getByText(/wait until the limit resets/i)).toBeTruthy();
    expect(screen.queryByText(/repo. \+ .read:org/i)).toBeNull();
  });

  it("renders invalid-token copy when hint is invalid-token", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        hint="invalid-token"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/revoked or expired/i)).toBeTruthy();
    expect(screen.getByText(/generate a new PAT/i)).toBeTruthy();
  });

  it("renders scope copy when hint is scope", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        hint="scope"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/missing required scopes/i)).toBeTruthy();
    expect(screen.getByText(/repo. \+ .read:org. for private repos/i)).toBeTruthy();
  });

  it("renders generic rejection copy when hint is undefined", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // The fallback should mention scopes since that's the most actionable
    // default advice for a 403 we don't have a hint for.
    expect(screen.getByText(/repo. \+ .read:org. scopes/i)).toBeTruthy();
  });

  it("shows the error inline and keeps the modal mounted when onSubmit rejects", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("Token validation failed"));
    const onCancel = vi.fn();

    render(
      <GitHubTokenModal
        host="github.com"
        reason="first-time"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByPlaceholderText("ghp_…");
    fireEvent.change(input, { target: { value: "bad_token" } });

    const button = screen.getByRole("button", { name: /save token for github\.com/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText("Token validation failed")).toBeTruthy(),
    );

    // Modal is still mounted (the cancel button is still present).
    expect(screen.getByRole("button", { name: /× close/i })).toBeTruthy();
  });

  it("renders a PAT help link pointing to github.com/settings/tokens", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /how to create a PAT/i });
    expect(link.getAttribute("href")).toBe("https://github.com/settings/tokens");
  });

  it("requires host trust before showing the token input for non-github.com hosts", () => {
    render(
      <GitHubTokenModal
        host="git.example.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/confirm that git\.example\.com/i)).toBeTruthy();
    expect(screen.getByText(/https:\/\/git\.example\.com\/api\/v3/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText("ghp_…")).toBeNull();
  });

  it("stores GHE host trust and then shows the token form", () => {
    render(
      <GitHubTokenModal
        host="git.example.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /i trust git\.example\.com/i }));

    expect(screen.getByPlaceholderText("ghp_…")).toBeTruthy();
    expect(window.localStorage.getItem("shippable:githubTrustedHosts:v1")).toBe(
      JSON.stringify(["git.example.com"]),
    );
  });

  it("renders a PAT help link pointing to the GHE host after that host is trusted", () => {
    window.localStorage.setItem(
      "shippable:githubTrustedHosts:v1",
      JSON.stringify(["git.example.com"]),
    );

    render(
      <GitHubTokenModal
        host="git.example.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /how to create a PAT/i });
    expect(link.getAttribute("href")).toBe("https://git.example.com/settings/tokens");
    expect(screen.getByText(/Token destination:/i)).toBeTruthy();
  });

  it("renders into document.body via createPortal (not into the provided container)", () => {
    // Set up a wrapper div that would be the "parent modal" container.
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      <GitHubTokenModal
        host="github.com"
        reason="first-time"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { container },
    );

    // The modal content should appear in document.body, not inside `container`.
    // If the portal works correctly, document.body contains the modal box but
    // `container` itself doesn't have it as a child (it only has the React root).
    const modalInContainer = within(container).queryByText(/needs a GitHub Personal Access Token/i);
    // Portal renders elsewhere — the content should NOT be a descendant of container.
    expect(modalInContainer).toBeNull();

    // But it IS in the document (via body portal).
    expect(screen.getByText(/needs a GitHub Personal Access Token/i)).toBeTruthy();

    document.body.removeChild(container);
  });
});
