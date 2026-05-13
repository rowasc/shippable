// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { CredentialsPanel } from "./CredentialsPanel";
import { CredentialsProvider } from "../auth/useCredentials";

vi.mock("../auth/client", async () => {
  const actual = await vi.importActual<typeof import("../auth/client")>(
    "../auth/client",
  );
  return {
    ...actual,
    authList: vi.fn(),
    authSet: vi.fn(),
    authClear: vi.fn(),
  };
});
vi.mock("../keychain", () => ({
  isTauri: vi.fn(() => false),
  keychainGet: vi.fn().mockResolvedValue(null),
  keychainSet: vi.fn().mockResolvedValue(undefined),
  keychainRemove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../githubHostTrust", async () => {
  const actual = await vi.importActual<typeof import("../githubHostTrust")>(
    "../githubHostTrust",
  );
  return {
    ...actual,
    readTrustedGithubHosts: vi.fn(() => []),
    trustGithubHost: vi.fn(),
  };
});

import * as client from "../auth/client";
import * as hostTrust from "../githubHostTrust";

function Wrap({ children }: { children: ReactNode }) {
  return <CredentialsProvider>{children}</CredentialsProvider>;
}

beforeEach(() => {
  vi.mocked(client.authList).mockResolvedValue([]);
  vi.mocked(client.authSet).mockResolvedValue();
  vi.mocked(client.authClear).mockResolvedValue();
  vi.mocked(hostTrust.readTrustedGithubHosts).mockReturnValue([]);
  vi.mocked(hostTrust.trustGithubHost).mockReset();
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("CredentialsPanel mode=boot", () => {
  it("renders an anthropic input + a Skip button", async () => {
    render(
      <Wrap>
        <CredentialsPanel mode="boot" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(/sk-ant-/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /skip/i }),
    ).toBeTruthy();
    // No "Add GitHub host" in boot mode.
    expect(screen.queryByRole("button", { name: /add github host/i })).toBeNull();
  });

  it("calls skipAnthropic when the Skip button is clicked", async () => {
    render(
      <Wrap>
        <CredentialsPanel mode="boot" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(window.localStorage.getItem("shippable:anthropic:skip")).toBe(
      "true",
    );
  });

  it("submits the anthropic credential via set()", async () => {
    render(
      <Wrap>
        <CredentialsPanel mode="boot" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/sk-ant-/i), {
      target: { value: "sk-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await waitFor(() =>
      expect(client.authSet).toHaveBeenCalledWith(
        { kind: "anthropic" },
        "sk-new",
      ),
    );
  });
});

describe("CredentialsPanel mode=settings", () => {
  it("renders an anthropic row, each configured github host, and the Add button", async () => {
    vi.mocked(client.authList).mockResolvedValue([
      { kind: "anthropic" },
      { kind: "github", host: "github.com" },
      { kind: "github", host: "ghe.example.com" },
    ]);
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    expect(screen.getByText("anthropic")).toBeTruthy();
    expect(screen.getByText("github.com")).toBeTruthy();
    expect(screen.getByText("ghe.example.com")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /add github host/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
  });

  it("calls clear() when the user clicks Clear on a row", async () => {
    vi.mocked(client.authList).mockResolvedValue([
      { kind: "github", host: "github.com" },
    ]);
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    const clearBtn = screen.getByRole("button", {
      name: /clear github.com/i,
    });
    fireEvent.click(clearBtn);
    await waitFor(() =>
      expect(client.authClear).toHaveBeenCalledWith({
        kind: "github",
        host: "github.com",
      }),
    );
  });

  it("shows a panel-level Keychain warning when the keychain delete fails but the row still disappears", async () => {
    // Tauri mode with a failing keychainRemove — server clear succeeds,
    // list refreshes (row disappears, taking any row-level state with
    // it), and the panel-level alert surfaces the failure so the user
    // knows the Keychain entry is still there.
    vi.mocked(client.authList)
      .mockResolvedValueOnce([{ kind: "github", host: "github.com" }])
      .mockResolvedValue([]);
    const keychain = await import("../keychain");
    vi.mocked(keychain.isTauri).mockReturnValue(true);
    vi.mocked(keychain.keychainRemove).mockRejectedValueOnce(
      new Error("user denied keychain access"),
    );

    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() =>
      expect(screen.getByText("github.com")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /clear github.com/i }),
    );
    // Panel-level alert (role="alert") survives the row unmount.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/keychain delete didn't go through/i);
    // The github.com row is gone — server-side state wins the UI.
    expect(screen.queryByText("github.com")).toBeNull();
    expect(client.authClear).toHaveBeenCalledWith({
      kind: "github",
      host: "github.com",
    });
  });

  it("rotate opens an inline editor; submit calls set()", async () => {
    vi.mocked(client.authList).mockResolvedValue([
      { kind: "github", host: "github.com" },
    ]);
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /rotate github.com/i }));
    const input = screen.getByPlaceholderText(/ghp_/);
    fireEvent.change(input, { target: { value: "ghp_new" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(client.authSet).toHaveBeenCalledWith(
        { kind: "github", host: "github.com" },
        "ghp_new",
      ),
    );
  });

  it("Add GitHub host triggers host-trust interstitial for a non-github.com host", async () => {
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: /add github host/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/host/i), {
      target: { value: "ghe.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    // The trust interstitial should appear, not the token input.
    expect(screen.getByText(/i trust ghe\.example\.com/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /i trust/i }));
    expect(hostTrust.trustGithubHost).toHaveBeenCalledWith("ghe.example.com");
  });

  it("resets the Add GitHub host form when the user cancels mid-flow", async () => {
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    // Open → host stage. Type a host, hit continue → trust stage.
    fireEvent.click(
      screen.getByRole("button", { name: /add github host/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/host/i), {
      target: { value: "ghe.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByText(/i trust ghe\.example\.com/i)).toBeTruthy();

    // Cancel from the trust stage.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Re-open: form must come up fresh on the host stage, not still on
    // the trust interstitial for the previously typed host.
    fireEvent.click(
      screen.getByRole("button", { name: /add github host/i }),
    );
    expect(screen.queryByText(/i trust ghe\.example\.com/i)).toBeNull();
    expect(
      (screen.getByPlaceholderText(/host/i) as HTMLInputElement).value,
    ).toBe("");
  });

  it("surfaces a friendly error when the server rejects a blocked GHE host", async () => {
    // Pre-trust the host so we can drive the flow straight to the token
    // stage where the actual /auth/set call happens.
    vi.mocked(hostTrust.readTrustedGithubHosts).mockReturnValue([
      "ghe.internal.local",
    ]);
    vi.mocked(client.authSet).mockRejectedValueOnce(
      new client.AuthClientError("host_blocked"),
    );
    render(
      <Wrap>
        <CredentialsPanel mode="settings" />
      </Wrap>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: /add github host/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/host/i), {
      target: { value: "ghe.internal.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByPlaceholderText(/ghp_/), {
      target: { value: "ghp_x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByText(/local-network blocklist/i)).toBeTruthy(),
    );
  });
});
