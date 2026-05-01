import { SHIKI_ADAPTED_THEMES } from "./shikiThemes";

export interface ThemeDefinition {
  label: string;
  colorScheme: "light" | "dark";
  vars: Record<string, string>;
}

const monoFont =
  '"JetBrains Mono", "Fira Code", "SF Mono", "Menlo", "Consolas", monospace';

const HAND_TUNED_THEMES = {
  dark: {
    label: "Dark",
    colorScheme: "dark",
    vars: {
      "bg": "#0b0e14",
      "bg-2": "#11151c",
      "bg-3": "#161b24",
      "fg": "#c7cbd1",
      "fg-dim": "#7f8896",
      "fg-mute": "#555b66",
      "accent": "#89ddff",
      "green": "#a6e3a1",
      "green-bg": "rgba(166, 227, 161, 0.08)",
      "red": "#f38ba8",
      "red-bg": "rgba(243, 139, 168, 0.08)",
      "yellow": "#f9e2af",
      "magenta": "#cba6f7",
      "blue": "#74c7ec",
      "border": "#232a36",
      "border-active": "#4a5467",
      "cursor-bg": "#1e2532",
      "reviewed-bg": "rgba(137, 221, 255, 0.05)",
      "reviewed-mark": "#3c4656",
      "font-mono": monoFont,
      "syntax-comment": "#6a7487",
      "syntax-keyword": "#ff8f40",
      "syntax-string": "#bbe67e",
      "syntax-number": "#ffcc66",
      "syntax-function": "#82aaff",
      "syntax-type": "#ffd580",
      "syntax-property": "#c3e88d",
      "syntax-variable": "#f78c6c",
      "syntax-tag": "#ffad66",
      "syntax-punctuation": "#8f9bb3",
    },
  },
  dollhouseNoir: {
    label: "Dollhouse Noir",
    colorScheme: "dark",
    vars: {
      "bg": "#1b0a18",
      "bg-2": "#260f25",
      "bg-3": "#321432",
      "fg": "#ffd6ec",
      "fg-dim": "#c490b0",
      "fg-mute": "#8b6584",
      "accent": "#ff4dca",
      "green": "#5eead4",
      "green-bg": "rgba(94, 234, 212, 0.10)",
      "red": "#ff2e6e",
      "red-bg": "rgba(255, 46, 110, 0.10)",
      "yellow": "#ffd166",
      "magenta": "#ff7ad9",
      "blue": "#b894ff",
      "border": "#4a1f44",
      "border-active": "#c41e8e",
      "cursor-bg": "#3a1736",
      "reviewed-bg": "rgba(255, 77, 202, 0.06)",
      "reviewed-mark": "#6a3360",
      "font-mono": monoFont,
      "syntax-comment": "#a06a8c",
      "syntax-keyword": "#ff4dca",
      "syntax-string": "#ffb6dc",
      "syntax-number": "#ffd166",
      "syntax-function": "#b894ff",
      "syntax-type": "#ff7ad9",
      "syntax-property": "#5eead4",
      "syntax-variable": "#ffa07a",
      "syntax-tag": "#ff89b8",
      "syntax-punctuation": "#c490b0",
    },
  },
  dollhouse: {
    label: "Dollhouse",
    colorScheme: "light",
    vars: {
      "bg": "#fff5f9",
      "bg-2": "#ffe9f2",
      "bg-3": "#ffd9e8",
      "fg": "#4a1530",
      "fg-dim": "#7a3358",
      "fg-mute": "#b07590",
      "accent": "#d4127a",
      "green": "#0d9488",
      "green-bg": "rgba(13, 148, 136, 0.12)",
      "red": "#d61d6e",
      "red-bg": "rgba(214, 29, 110, 0.10)",
      "yellow": "#b87d00",
      "magenta": "#c41e8e",
      "blue": "#7c3aed",
      "border": "#f0bfd5",
      "border-active": "#d4127a",
      "cursor-bg": "#ffd0e3",
      "reviewed-bg": "rgba(212, 18, 122, 0.05)",
      "reviewed-mark": "#e6a3c0",
      "font-mono": monoFont,
      "syntax-comment": "#a06a8c",
      "syntax-keyword": "#c41e8e",
      "syntax-string": "#0d6e64",
      "syntax-number": "#b87d00",
      "syntax-function": "#7c3aed",
      "syntax-type": "#be1958",
      "syntax-property": "#0d9488",
      "syntax-variable": "#d4651c",
      "syntax-tag": "#be1958",
      "syntax-punctuation": "#8b5870",
    },
  },
  light: {
    label: "Light",
    colorScheme: "light",
    vars: {
      "bg": "#f5f7fb",
      "bg-2": "#ebeff5",
      "bg-3": "#dde5ef",
      "fg": "#233142",
      "fg-dim": "#506176",
      "fg-mute": "#7b8798",
      "accent": "#005cc5",
      "green": "#1a7f37",
      "green-bg": "rgba(26, 127, 55, 0.12)",
      "red": "#cf222e",
      "red-bg": "rgba(207, 34, 46, 0.1)",
      "yellow": "#9a6700",
      "magenta": "#8250df",
      "blue": "#0969da",
      "border": "#c8d1dc",
      "border-active": "#8aa3c2",
      "cursor-bg": "#d7e6ff",
      "reviewed-bg": "rgba(9, 105, 218, 0.06)",
      "reviewed-mark": "#90a9c9",
      "font-mono": monoFont,
      "syntax-comment": "#6e7781",
      "syntax-keyword": "#8250df",
      "syntax-string": "#0a7c3b",
      "syntax-number": "#b35900",
      "syntax-function": "#0550ae",
      "syntax-type": "#953800",
      "syntax-property": "#0f766e",
      "syntax-variable": "#bc4c00",
      "syntax-tag": "#b31d28",
      "syntax-punctuation": "#57606a",
    },
  },
} as const satisfies Record<string, ThemeDefinition>;

export const THEMES: Record<string, ThemeDefinition> = {
  ...HAND_TUNED_THEMES,
  ...SHIKI_ADAPTED_THEMES,
};

export type ThemeId = string;

export const DEFAULT_THEME_ID: ThemeId = "dark";
export const THEME_STORAGE_KEY = "shippable:theme";

export const THEME_OPTIONS = Object.entries(THEMES).map(([id, theme]) => ({
  id,
  label: theme.label,
  colorScheme: theme.colorScheme,
}));

export function isThemeId(value: string | null): value is ThemeId {
  return value !== null && Object.prototype.hasOwnProperty.call(THEMES, value);
}

export function getStoredThemeId(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function persistThemeId(themeId: ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Storage can fail in private browsing or embedded contexts.
  }
}

export function applyThemeToRoot(el: HTMLElement, themeId: ThemeId): void {
  const theme = THEMES[themeId];
  for (const [name, value] of Object.entries(theme.vars)) {
    el.style.setProperty(`--${name}`, value);
  }
  el.style.setProperty("color-scheme", theme.colorScheme);
  el.dataset.theme = themeId;
  el.dataset.colorScheme = theme.colorScheme;
}
