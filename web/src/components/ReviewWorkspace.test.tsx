// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewWorkspace } from "./ReviewWorkspace";
import type { ChangeSet } from "../types";
import { initialState } from "../state";

const {
  fetchDefinitionCapabilitiesMock,
  fetchDefinitionMock,
} = vi.hoisted(() => ({
  fetchDefinitionCapabilitiesMock: vi.fn(),
  fetchDefinitionMock: vi.fn(),
}));

vi.mock("../highlight", () => ({
  highlightLines: vi.fn(
    async (
      lines: string[],
      language?: string,
      _colorMode?: unknown,
      options?: { clickableSymbols?: Iterable<string>; allowAnyIdentifier?: boolean },
    ) => {
      const clickable = new Set(options?.clickableSymbols ?? []);
      return {
        language: language ?? "text",
        lines: lines.map((line) => {
          const candidates = options?.allowAnyIdentifier
            ? line.match(/[A-Za-z_$][\w$]*/g) ?? []
            : [...clickable];
          const symbol = candidates.find((candidate) => line.includes(`${candidate}(`))
            ?? candidates.find((candidate) => line.includes(candidate));
          if (symbol) {
            return line.replace(
              symbol,
              `<span class="shiki-token shiki-token--symbol" data-symbol="${symbol}" data-token-col="7" role="button" tabindex="0">${symbol}</span>`,
            );
          }
          return line;
        }),
      };
    },
  ),
}));

vi.mock("../usePlan", () => ({
  usePlan: () => ({
    plan: { entryPoints: [] },
    status: "idle",
    error: undefined,
    generate: () => undefined,
  }),
}));

vi.mock("../definitionNav", () => ({
  fetchDefinitionCapabilities: fetchDefinitionCapabilitiesMock,
  fetchDefinition: fetchDefinitionMock,
  isProgrammingLanguage: (language: string) =>
    [
      "js", "jsx", "ts", "tsx", "javascript", "typescript",
      "php", "phtml",
    ].includes(language),
  findCapabilityForLanguage: (
    caps: { languages?: Array<{ languageIds: string[] }> } | null,
    language: string,
  ) =>
    caps?.languages?.find((c) => c.languageIds.includes(language)) ?? null,
}));

vi.mock("../useApiKey", () => ({
  useApiKey: () => ({
    status: { kind: "present" },
    save: async () => undefined,
    skip: () => undefined,
  }),
}));

vi.mock("./Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("./StatusBar", () => ({
  StatusBar: () => null,
}));

vi.mock("./GuidePrompt", () => ({
  GuidePrompt: () => null,
}));

vi.mock("./HelpOverlay", () => ({
  HelpOverlay: () => null,
}));

vi.mock("./Inspector", () => ({
  Inspector: () => null,
}));

vi.mock("./KeySetup", () => ({
  KeySetup: () => null,
}));

vi.mock("./LoadModal", () => ({
  LoadModal: () => null,
}));

vi.mock("./ReviewPlanView", () => ({
  ReviewPlanView: () => null,
}));

vi.mock("./CodeRunner", () => ({
  CodeRunner: () => null,
}));

vi.mock("./ThemePicker", () => ({
  ThemePicker: () => null,
}));

vi.mock("./PromptPicker", () => ({
  PromptPicker: () => null,
}));

afterEach(cleanup);
afterEach(() => {
  fetchDefinitionCapabilitiesMock.mockReset();
  fetchDefinitionMock.mockReset();
});

window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe("ReviewWorkspace symbol navigation", () => {
  it("falls through to the server definition endpoint for worktree-backed TS diffs", async () => {
    fetchDefinitionCapabilitiesMock.mockResolvedValue({
      languages: [
        {
          id: "ts",
          languageIds: ["ts", "tsx", "js", "jsx"],
          available: true,
          resolver: "typescript-language-server",
          source: "path",
          recommendedSetup: [],
        },
      ],
      requiresWorktree: true,
      anyAvailable: true,
    });
    fetchDefinitionMock.mockResolvedValue({
      status: "ok",
      definitions: [
        {
          uri: "file:///repo/src/prefs.ts",
          file: "src/prefs.ts",
          workspaceRelativePath: "src/prefs.ts",
          line: 0,
          col: 16,
          endLine: 0,
          endCol: 25,
          preview: "1: export function loadPrefs() {}",
          resolver: "typescript-language-server",
        },
      ],
    });
    const changeset = fixtureServerDefinitionChangeset();
    const state = initialState([changeset]);
    const dispatch = vi.fn();

    render(
      <ReviewWorkspace
        state={state}
        dispatch={dispatch}
        drafts={{}}
        setDrafts={() => ({})}
        themeId="light"
        setThemeId={() => undefined}
        onLoadChangeset={() => undefined}
        onReloadChangeset={() => undefined}
        currentSource={{ kind: "worktree", path: "/repo", branch: "feat/nav" }}
      />,
    );

    await waitFor(() =>
      expect(fetchDefinitionCapabilitiesMock).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(await screen.findByRole("button", { name: "loadPrefs" }));

    await waitFor(() =>
      expect(fetchDefinitionMock).toHaveBeenCalledWith({
        file: "src/caller.ts",
        language: "ts",
        line: 0,
        col: 7,
        workspaceRoot: "/repo",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_CURSOR",
      cursor: {
        changesetId: "cs-server-nav",
        fileId: "defs",
        hunkId: "defs-hunk",
        lineIdx: 0,
      },
    });
  });
});

function fixtureServerDefinitionChangeset(): ChangeSet {
  return {
    id: "cs-server-nav",
    title: "Server definition navigation test",
    author: "test",
    branch: "feature/server-nav",
    base: "main",
    createdAt: "2026-05-05T00:00:00.000Z",
    description: "Exercise server-backed go-to-definition.",
    files: [
      {
        id: "caller",
        path: "src/caller.ts",
        language: "ts",
        status: "modified",
        hunks: [
          {
            id: "caller-hunk",
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldCount: 0,
            newStart: 1,
            newCount: 1,
            lines: [{ kind: "add", text: "return loadPrefs();", newNo: 1 }],
          },
        ],
      },
      {
        id: "defs",
        path: "src/prefs.ts",
        language: "ts",
        status: "modified",
        hunks: [
          {
            id: "defs-hunk",
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldCount: 0,
            newStart: 1,
            newCount: 1,
            lines: [
              { kind: "add", text: "export function loadPrefs() {}", newNo: 1 },
            ],
          },
        ],
      },
    ],
  };
}
