// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("./auth/client", () => ({
  authList: vi.fn().mockResolvedValue([]),
  authSet: vi.fn().mockResolvedValue(undefined),
  authClear: vi.fn().mockResolvedValue(undefined),
  AuthClientError: class AuthClientError extends Error {},
}));
vi.mock("./keychain", () => ({
  isTauri: vi.fn(() => false),
  keychainGet: vi.fn().mockResolvedValue(null),
  keychainSet: vi.fn().mockResolvedValue(undefined),
  keychainRemove: vi.fn().mockResolvedValue(undefined),
}));

import * as client from "./auth/client";
import App from "./App";
import { CredentialsProvider } from "./auth/useCredentials";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

// The production tree (main.tsx) is <CredentialsProvider><ServerHealthGate>
// <App/></ServerHealthGate></CredentialsProvider>. Tests mirror that wrapping
// — App must NOT mount its own provider, and the gate must be able to call
// useCredentials() above it without throwing.
describe("App credentials wiring", () => {
  it("renders under a hoisted CredentialsProvider and triggers an initial list fetch", async () => {
    render(
      <CredentialsProvider>
        <App />
      </CredentialsProvider>,
    );
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
  });
});
