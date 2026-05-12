// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ServerHealthGate } from "./ServerHealthGate";
import { CredentialsProvider } from "../auth/useCredentials";

vi.mock("../auth/client", () => ({
  authList: vi.fn(),
  authSet: vi.fn().mockResolvedValue(undefined),
  authClear: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../keychain", () => ({
  isTauri: vi.fn(() => false),
  keychainGet: vi.fn().mockResolvedValue(null),
  keychainSet: vi.fn().mockResolvedValue(undefined),
  keychainRemove: vi.fn().mockResolvedValue(undefined),
}));

const waitForSidecarReadyMock = vi.fn();
vi.mock("../apiUrl", () => ({
  apiUrl: async (path: string) => path,
  waitForSidecarReady: () => waitForSidecarReadyMock(),
}));

import * as client from "../auth/client";

const originalFetch = global.fetch;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(client.authList).mockResolvedValue([]);
  waitForSidecarReadyMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response);
}

describe("ServerHealthGate", () => {
  it("renders children when anthropic is configured", async () => {
    stubFetch(200, { ok: true });
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("content")).toBeTruthy());
  });

  it("renders the boot CredentialsPanel when anthropic is missing and not skipped", async () => {
    stubFetch(200, { ok: true });
    vi.mocked(client.authList).mockResolvedValue([]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/sk-ant-/i)).toBeTruthy(),
    );
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("falls through to children when anthropic is missing but skipped", async () => {
    window.localStorage.setItem("shippable:anthropic:skip", "true");
    stubFetch(200, { ok: true });
    vi.mocked(client.authList).mockResolvedValue([]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("content")).toBeTruthy());
  });

  it("renders Server unreachable when /api/health fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({}),
    } as Response);
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/server unreachable/i)).toBeTruthy(),
    );
  });

  it("awaits waitForSidecarReady before probing /api/health", async () => {
    stubFetch(200, { ok: true });
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() => expect(waitForSidecarReadyMock).toHaveBeenCalled());
  });
});
