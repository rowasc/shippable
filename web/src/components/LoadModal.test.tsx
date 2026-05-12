// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoadModal } from "./LoadModal";
import { CredentialsProvider } from "../auth/useCredentials";

afterEach(() => {
  cleanup();
  isTauriMock.mockReturnValue(false);
  keychainGetMock.mockResolvedValue(null);
  window.localStorage.clear();
});

vi.mock("../auth/client", () => ({
  authList: vi.fn().mockResolvedValue([]),
  authSet: vi.fn().mockResolvedValue(undefined),
  authClear: vi.fn().mockResolvedValue(undefined),
  AuthClientError: class AuthClientError extends Error {},
}));

// Mock the github client and the GitHubTokenModal
const { loadGithubPrMock } = vi.hoisted(() => ({
  loadGithubPrMock: vi.fn(),
}));

vi.mock("../githubPrClient", () => ({
  loadGithubPr: loadGithubPrMock,
  GithubFetchError: class GithubFetchError extends Error {
    discriminator: string;
    host?: string;
    hint?: string;
    constructor(discriminator: string, message: string, host?: string, hint?: string) {
      super(message);
      this.name = "GithubFetchError";
      this.discriminator = discriminator;
      this.host = host;
      this.hint = hint;
    }
  },
  GH_ERROR_MESSAGES: {
    github_pr_not_found: "PR not found.",
    github_upstream: "GitHub returned an error. Try again.",
    invalid_pr_url: "That doesn't look like a valid PR URL.",
    unknown: "Something went wrong loading the PR.",
  },
}));

// Keychain helpers — off by default (non-Tauri). Individual tests can
// override isTauri / keychainGet to exercise the rehydrate path.
const { isTauriMock, keychainGetMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  keychainGetMock: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
}));

vi.mock("../keychain", () => ({
  isTauri: isTauriMock,
  keychainGet: keychainGetMock,
  keychainSet: vi.fn().mockResolvedValue(undefined),
  keychainRemove: vi.fn().mockResolvedValue(undefined),
}));

// Worktree loader — disable server-backed section for cleaner tests.
vi.mock("../useWorktreeLoader", () => ({
  useWorktreeLoader: () => ({
    serverAvailable: false,
    wtDir: "",
    setWtDir: vi.fn(),
    wtBusy: false,
    wtPickerBusy: false,
    wtList: null,
    wtLoadingPath: null,
    err: null,
    showManualPath: false,
    setShowManualPath: vi.fn(),
    pickDirectory: vi.fn(),
    scanWorktrees: vi.fn(),
    loadFromWorktree: vi.fn(),
  }),
}));

function renderModal(onLoad = vi.fn(), onClose = vi.fn()) {
  return render(
    <CredentialsProvider>
      <LoadModal onLoad={onLoad} onClose={onClose} />
    </CredentialsProvider>,
  );
}

describe("LoadModal — unified URL field (PR + diff URL)", () => {
  it("renders a single 'From URL' section with a unified URL field", () => {
    renderModal();
    expect(screen.getByText(/from url/i)).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
    ).toBeTruthy();
  });

  it("calls loadGithubPr with the entered URL on submit", async () => {
    const fakeCs = {
      id: "pr:github.com:owner:repo:1",
      title: "Fix bug",
      files: [],
    };
    loadGithubPrMock.mockResolvedValue({
      changeSet: fakeCs,
      prReplies: {},
      prDetached: [],
    });
    const onLoad = vi.fn();

    renderModal(onLoad);

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });

    const button = screen.getByRole("button", { name: /^load$/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(loadGithubPrMock).toHaveBeenCalledWith(
        "https://github.com/owner/repo/pull/1",
      ),
    );
    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        expect.objectContaining({ kind: "pr" }),
        { prReplies: {}, prDetached: [] },
      ),
    );
  });

  it("opens the token modal when loadGithubPr throws github_token_required", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_token_required", "github_token_required", "github.com"),
    );

    renderModal();

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(screen.getByText(/needs a GitHub Personal Access Token/i)).toBeTruthy(),
    );
  });

  it("does not open the token modal when Tauri Keychain has a cached token (rehydrate path)", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    // First call: server has no token → throw github_token_required.
    // Second call (after rehydrate): returns the changeset.
    const fakeCs = { id: "pr:github.com:owner:repo:1", title: "Test", files: [] };
    loadGithubPrMock
      .mockRejectedValueOnce(
        new GithubFetchError("github_token_required", "github_token_required", "github.com"),
      )
      .mockResolvedValueOnce({
        changeSet: fakeCs,
        prReplies: {},
        prDetached: [],
      });
    isTauriMock.mockReturnValue(true);
    keychainGetMock.mockResolvedValue("ghp_cached_token");

    const onLoad = vi.fn();
    renderModal(onLoad);

    const input = screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i);
    fireEvent.change(input, { target: { value: "https://github.com/owner/repo/pull/1" } });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    // Token modal must NOT appear — the rehydrate path should skip it.
    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        expect.objectContaining({ kind: "pr" }),
        { prReplies: {}, prDetached: [] },
      ),
    );
    expect(screen.queryByText(/needs a GitHub Personal Access Token/i)).toBeNull();
    const authClient = await import("../auth/client");
    expect(authClient.authSet).toHaveBeenCalledWith(
      { kind: "github", host: "github.com" },
      "ghp_cached_token",
    );
  });

  it("opens the token modal when Tauri Keychain returns null (no cached token)", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_token_required", "github_token_required", "github.com"),
    );
    isTauriMock.mockReturnValue(true);
    keychainGetMock.mockResolvedValue(null);

    renderModal();

    const input = screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i);
    fireEvent.change(input, { target: { value: "https://github.com/owner/repo/pull/1" } });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(screen.getByText(/needs a GitHub Personal Access Token/i)).toBeTruthy(),
    );
  });

  it("opens the token modal with 'rejected' reason when github_auth_failed", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_auth_failed", "github_auth_failed", "github.com"),
    );

    renderModal();

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(screen.getByText(/was rejected/i)).toBeTruthy(),
    );
  });

  it("renders an inline error for github_pr_not_found", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_pr_not_found", "github_pr_not_found"),
    );

    renderModal();

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(screen.getByText("PR not found.")).toBeTruthy(),
    );
  });
});
