// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GitHubTokenModal } from "./GitHubTokenModal";

afterEach(cleanup);

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

  it("renders the rejection copy when reason is rejected", () => {
    render(
      <GitHubTokenModal
        host="github.com"
        reason="rejected"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/was rejected/i)).toBeTruthy();
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

  it("renders a PAT help link pointing to the GHE host for non-github.com hosts", () => {
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
  });
});
