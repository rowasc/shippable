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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("App credentials wiring", () => {
  it("mounts a CredentialsProvider that fetches the list on first render", async () => {
    render(<App />);
    await waitFor(() => expect(client.authList).toHaveBeenCalled());
  });
});
