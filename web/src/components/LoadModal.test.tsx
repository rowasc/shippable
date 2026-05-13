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
      expect(screen.getByText(/rejected the saved token/i)).toBeTruthy(),
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

  // Cache-hit retry must terminate even when the server keeps returning
  // `github_token_required` (the api-client's pre-fix behavior for a
  // GitHub 401 with a token attached). Without the retry cap this loops
  // forever — push cached → retry → token_required → push cached → … —
  // and no modal ever opens. The bound treats the second token_required
  // as a rejection: the cached token didn't work.
  it("caps the cache-hit retry at one attempt and opens the modal in 'rejected' state if the cached token keeps coming back token_required", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    // Reset the cumulative mock call count from earlier tests so we can
    // assert "exactly two calls" — initial load + a single bounded retry.
    loadGithubPrMock.mockReset();
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError(
        "github_token_required",
        "github_token_required",
        "github.com",
      ),
    );
    isTauriMock.mockReturnValue(true);
    keychainGetMock.mockResolvedValue("ghp_cached_but_wrong");

    renderModal();

    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    // Modal opens in "rejected" state (red rejection copy), not stuck in
    // an infinite retry loop.
    await waitFor(() =>
      expect(screen.getByText(/rejected the saved token/i)).toBeTruthy(),
    );
    // loadGithubPr was called exactly twice — initial + bounded retry.
    expect(loadGithubPrMock).toHaveBeenCalledTimes(2);
  });

  // Reproduces the LoadModal-specific flow the user reported: server has no
  // token yet, first load opens the modal with the first-time copy; the
  // user pastes a wrong PAT; the second loadGithubPr call comes back with
  // github_auth_failed. The token modal MUST stay mounted and surface the
  // rejection inline — the user's report was "no error message at the
  // load modal" after the second submit.
  it("surfaces an inline rejection error in the token modal when the submitted PAT is wrong", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock
      .mockRejectedValueOnce(
        new GithubFetchError(
          "github_token_required",
          "github_token_required",
          "github.com",
        ),
      )
      .mockRejectedValueOnce(
        new GithubFetchError(
          "github_auth_failed",
          "github_auth_failed",
          "github.com",
          "invalid-token",
        ),
      );

    renderModal();

    // First load — server has no token, modal opens with first-time copy.
    const input = screen.getByPlaceholderText(
      /github\.com\/owner\/repo\/pull\/123$/i,
    );
    fireEvent.change(input, {
      target: { value: "https://github.com/owner/repo/pull/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/needs a GitHub Personal Access Token/i),
      ).toBeTruthy(),
    );

    // User pastes a wrong PAT and clicks save.
    const patInput = screen.getByPlaceholderText("ghp_…");
    fireEvent.change(patInput, { target: { value: "ghp_wrong" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save token for github\.com/i }),
    );

    // The modal must stay mounted with the inline rejection error.
    await waitFor(() =>
      expect(screen.getByText(/Token rejected by github\.com/i)).toBeTruthy(),
    );
    // PAT input still there (modal kept mounted for another try).
    expect(screen.queryByPlaceholderText("ghp_…")).toBeTruthy();
  });

  // Defensive coverage of the "stale sidecar" path the user hit: the server
  // binary may not yet carry the api-client fix that maps a GitHub 401
  // (with token attached) to `github_auth_failed`, so it still returns
  // `github_token_required` even after we've just submitted a token. The
  // submit handler must treat that as a rejection — not surface the raw
  // discriminator string in LoadModal's inline error, which is the actual
  // bug the user reported.
  it("surfaces an inline rejection error when the server still returns token_required after submit (stale sidecar)", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock
      .mockRejectedValueOnce(
        new GithubFetchError(
          "github_token_required",
          "github_token_required",
          "github.com",
        ),
      )
      .mockRejectedValueOnce(
        new GithubFetchError(
          "github_token_required",
          "github_token_required",
          "github.com",
        ),
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
      expect(
        screen.getByText(/needs a GitHub Personal Access Token/i),
      ).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText("ghp_…"), {
      target: { value: "ghp_wrong" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /save token for github\.com/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Token rejected by github\.com/i)).toBeTruthy(),
    );
  });
});
