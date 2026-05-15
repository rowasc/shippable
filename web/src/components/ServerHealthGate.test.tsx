// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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

  it("falls through to children when /api/health returns db.status ok", async () => {
    stubFetch(200, { ok: true, db: { status: "ok" } });
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

  it("renders database error screen when /api/health returns db.status error", async () => {
    stubFetch(200, {
      ok: true,
      db: { status: "error", error: "no app-data directory available: set HOME" },
    });
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);
    render(
      <CredentialsProvider>
        <ServerHealthGate>
          <span data-testid="content">app</span>
        </ServerHealthGate>
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/database unavailable/i)).toBeTruthy(),
    );
    expect(
      screen.getByText(/no app-data directory available: set HOME/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("falls through when /api/health body has no db field (old server)", async () => {
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

  it("re-engages the unreachable panel after two consecutive heartbeat failures", async () => {
    // First call is the boot probe. After that, the 30s heartbeat fires; a
    // single failure isn't enough to flip state (transient blips happen),
    // but two consecutive failures should surface the unreachable panel
    // even though the gate had previously fallen through.
    const okResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ ok: true }),
    } as Response;
    const failResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({}),
    } as Response;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse) // boot probe
      .mockResolvedValueOnce(failResponse) // 1st heartbeat: fails (no flip)
      .mockResolvedValueOnce(failResponse); // 2nd heartbeat: flips state
    global.fetch = fetchMock;
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <CredentialsProvider>
          <ServerHealthGate>
            <span data-testid="content">app</span>
          </ServerHealthGate>
        </CredentialsProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("content")).toBeTruthy());

      // First heartbeat: still healthy from the gate's perspective.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByTestId("content")).toBeTruthy();

      // Second heartbeat (consecutive failure): gate re-engages.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await waitFor(() =>
        expect(screen.getByText(/server unreachable/i)).toBeTruthy(),
      );
      expect(screen.queryByTestId("content")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers across a transient heartbeat blip without flipping state", async () => {
    // One failure followed by a success: counter resets, gate stays on
    // children. Otherwise a single TCP RST from a sleeping laptop would
    // unmount the workspace.
    const okResponse = () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ ok: true }),
      }) as Response;
    const failResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({}),
    } as Response;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse()) // boot
      .mockResolvedValueOnce(failResponse) // 1st heartbeat: fail
      .mockResolvedValueOnce(okResponse()); // 2nd heartbeat: recover
    global.fetch = fetchMock;
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <CredentialsProvider>
          <ServerHealthGate>
            <span data-testid="content">app</span>
          </ServerHealthGate>
        </CredentialsProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("content")).toBeTruthy());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      // Both heartbeats fired (3 total fetches: boot + 2 heartbeats), and
      // the gate is still on children — the lone failure didn't flip.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("content")).toBeTruthy();
      expect(screen.queryByText(/server unreachable/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-show the boot panel if the anthropic credential is cleared mid-session", async () => {
    // First render: anthropic present → gate renders children.
    stubFetch(200, { ok: true });
    vi.mocked(client.authList).mockResolvedValue([{ kind: "anthropic" }]);

    function Harness() {
      return (
        <CredentialsProvider>
          <ServerHealthGate>
            <span data-testid="content">app</span>
          </ServerHealthGate>
        </CredentialsProvider>
      );
    }
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("content")).toBeTruthy());

    // Now mock authList returning an empty list (simulating a clear) and
    // force a re-render with that fresh state. The gate should stay on
    // children — Settings is the right surface for credential management
    // once we've passed the initial onboarding.
    vi.mocked(client.authList).mockResolvedValue([]);
    rerender(<Harness />);
    // Children stay mounted; no boot panel.
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/sk-ant-/i)).toBeNull();
  });
});
