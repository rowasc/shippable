// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { CredentialsProvider } from "../auth/useCredentials";

vi.mock("../auth/client", () => ({
  authList: vi.fn().mockResolvedValue([]),
  authSet: vi.fn().mockResolvedValue(undefined),
  authClear: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../keychain", () => ({
  isTauri: vi.fn(() => false),
  keychainGet: vi.fn().mockResolvedValue(null),
  keychainSet: vi.fn().mockResolvedValue(undefined),
  keychainRemove: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("SettingsModal", () => {
  it("portals into document.body and contains the settings CredentialsPanel", async () => {
    render(
      <CredentialsProvider>
        <SettingsModal onClose={vi.fn()} />
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add github host/i }),
      ).toBeTruthy(),
    );
  });

  it("invokes onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <CredentialsProvider>
        <SettingsModal onClose={onClose} />
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add github host/i }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("settings-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("invokes onClose when Esc is pressed", async () => {
    const onClose = vi.fn();
    render(
      <CredentialsProvider>
        <SettingsModal onClose={onClose} />
      </CredentialsProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add github host/i }),
      ).toBeTruthy(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
