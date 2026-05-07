// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Welcome } from "./Welcome";

beforeEach(() => {
  cleanup();
  isTauriMock.mockReturnValue(false);
  keychainGetMock.mockResolvedValue(null);
  setGithubTokenMock.mockResolvedValue(undefined);
});

const { loadGithubPrMock, setGithubTokenMock } = vi.hoisted(() => ({
  loadGithubPrMock: vi.fn(),
  setGithubTokenMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../githubPrClient", async () => {
  const actual = await vi.importActual<typeof import("../githubPrClient")>("../githubPrClient");
  return {
    ...actual,
    loadGithubPr: loadGithubPrMock,
    setGithubToken: setGithubTokenMock,
  };
});

const { isTauriMock, keychainGetMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn().mockReturnValue(false),
  keychainGetMock: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
}));

vi.mock("../keychain", () => ({
  isTauri: isTauriMock,
  keychainGet: keychainGetMock,
  keychainSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../useWorktreeLoader", () => ({
  useWorktreeLoader: () => ({
    serverAvailable: false,
    wtDir: "",
    setWtDir: () => {},
    showManualPath: false,
    setShowManualPath: () => {},
    pickDirectory: () => {},
    wtPickerBusy: false,
    scanWorktrees: () => {},
    wtBusy: false,
    wtList: null,
    wtLoadingPath: null,
    loadFromWorktree: () => {},
    err: null,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderWelcome(onLoad: any = vi.fn()) {
  return render(
    <Welcome recents={[]} onLoad={onLoad} onRecentsChange={() => {}} />,
  );
}

describe("Welcome — unified URL field (PR + diff URL)", () => {
  it("renders the 'From a URL' section with a single URL field", () => {
    renderWelcome();
    expect(screen.getByText(/from a url/i)).toBeTruthy();
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

    renderWelcome(onLoad);

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
        {},
        expect.objectContaining({ kind: "pr", prUrl: "https://github.com/owner/repo/pull/1" }),
        { prReplies: {}, prDetached: [] },
      ),
    );
  });

  it("opens the token modal when loadGithubPr throws github_token_required", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_token_required", "github_token_required", "github.com"),
    );

    renderWelcome();

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

  it("calls onLoad with pr source on successful load", async () => {
    const fakeCs = {
      id: "pr:github.com:owner:repo:42",
      title: "My PR",
      files: [{ path: "foo.ts", hunks: [] }],
    };
    loadGithubPrMock.mockResolvedValue({
      changeSet: fakeCs,
      prReplies: {},
      prDetached: [],
    });
    const onLoad = vi.fn();

    renderWelcome(onLoad);

    fireEvent.change(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
      { target: { value: "https://github.com/owner/repo/pull/42" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        {},
        { kind: "pr", prUrl: "https://github.com/owner/repo/pull/42" },
        { prReplies: {}, prDetached: [] },
      ),
    );
  });

  it("does not open the token modal when Tauri Keychain has a cached token (rehydrate path)", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
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
    renderWelcome(onLoad);

    const input = screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i);
    fireEvent.change(input, { target: { value: "https://github.com/owner/repo/pull/1" } });
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(onLoad).toHaveBeenCalledWith(
        fakeCs,
        {},
        expect.objectContaining({ kind: "pr" }),
        { prReplies: {}, prDetached: [] },
      ),
    );
    expect(screen.queryByText(/needs a GitHub Personal Access Token/i)).toBeNull();
    expect(setGithubTokenMock).toHaveBeenCalledWith("github.com", "ghp_cached_token");
  });

  it("renders an inline error for github_pr_not_found", async () => {
    const { GithubFetchError } = await import("../githubPrClient");
    loadGithubPrMock.mockRejectedValue(
      new GithubFetchError("github_pr_not_found", "github_pr_not_found"),
    );

    renderWelcome();

    fireEvent.change(
      screen.getByPlaceholderText(/github\.com\/owner\/repo\/pull\/123$/i),
      { target: { value: "https://github.com/owner/repo/pull/9999" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^load$/i }));

    await waitFor(() =>
      expect(screen.getByText("PR not found.")).toBeTruthy(),
    );
  });
});
