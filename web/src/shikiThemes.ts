import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import dracula from "@shikijs/themes/dracula";
import tokyoNight from "@shikijs/themes/tokyo-night";
import type { ThemeDefinition } from "./tokens";

type ShikiTheme = {
  name?: string;
  displayName?: string;
  type?: "dark" | "light" | string;
  colors?: Record<string, string>;
  tokenColors?: Array<{
    scope?: string | string[];
    settings?: { foreground?: string };
  }>;
};

const monoFont =
  '"JetBrains Mono", "Fira Code", "SF Mono", "Menlo", "Consolas", monospace';

interface AdapterEntry {
  id: string;
  label: string;
  theme: ShikiTheme;
}

const SHIKI_ENTRIES: AdapterEntry[] = [
  { id: "catppuccinMocha", label: "Catppuccin Mocha", theme: catppuccinMocha as ShikiTheme },
  { id: "catppuccinLatte", label: "Catppuccin Latte", theme: catppuccinLatte as ShikiTheme },
  { id: "tokyoNight", label: "Tokyo Night", theme: tokyoNight as ShikiTheme },
  { id: "dracula", label: "Dracula", theme: dracula as ShikiTheme },
];

export const SHIKI_THEME_MODULES: Record<string, ShikiTheme> = Object.fromEntries(
  SHIKI_ENTRIES.map((e) => [e.id, e.theme]),
);

export const SHIKI_ADAPTED_THEMES: Record<string, ThemeDefinition> = Object.fromEntries(
  SHIKI_ENTRIES.map((e) => [e.id, adaptShikiTheme(e.theme, e.label)]),
);

export function adaptShikiTheme(theme: ShikiTheme, label: string): ThemeDefinition {
  const c = theme.colors ?? {};
  const colorScheme: "light" | "dark" = theme.type === "light" ? "light" : "dark";

  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = c[k];
      if (v) return v;
    }
    return undefined;
  };

  const bg = pick("editor.background") ?? (colorScheme === "dark" ? "#1e1e1e" : "#ffffff");
  const fg = pick("editor.foreground", "foreground") ?? (colorScheme === "dark" ? "#d4d4d4" : "#1f2328");

  // Border: theme-provided values are inconsistent (Tokyo Night ships #101014,
  // darker than its bg; Dracula ships its accent purple). Always derive from
  // mix so the result reads as a subtle separator in our chrome.
  const border = mix(fg, bg, 0.15);

  // Accent: prefer saturated UI accents, falling back to terminal colors and
  // tokenColor.keyword. Skips low-saturation candidates so themes whose
  // focusBorder is muted (Dracula's gray-blue) don't poison the result.
  const accent = pickSaturated(
    stripAlpha(pick("button.background")),
    stripAlpha(pick("focusBorder")),
    stripAlpha(pick("editorCursor.foreground")),
    stripAlpha(pick("editorLineNumber.activeForeground")),
    stripAlpha(pick("terminal.ansiMagenta")),
    stripAlpha(pick("terminal.ansiBlue")),
  ) ?? stripAlpha(pick("focusBorder", "button.background")) ?? fg;
  const borderActive = accent;

  const bg2 = stripAlpha(pick("sideBar.background", "editorWidget.background")) ?? mix(fg, bg, 0.04);
  const bg3 = stripAlpha(pick("list.activeSelectionBackground", "editor.lineHighlightBackground")) ??
    mix(fg, bg, 0.08);
  const cursorBg = stripAlpha(pick("editor.lineHighlightBackground", "list.hoverBackground")) ?? mix(fg, bg, 0.06);

  // Always derive dim/mute from a mix of fg and bg. Theme-provided candidates
  // are unreliable: Catppuccin sets descriptionForeground = foreground;
  // activeLineNumber is often the accent color; plain lineNumber sometimes
  // matches accent too. Mix gives a guaranteed-muted gray in the right family.
  const fgDim = mix(fg, bg, 0.6);
  const fgMute = mix(fg, bg, 0.4);

  const green = pick("terminal.ansiGreen", "terminal.ansiBrightGreen") ?? "#22c55e";
  const red = pick("terminal.ansiRed", "terminal.ansiBrightRed") ?? "#ef4444";
  const yellow = pick("terminal.ansiYellow", "terminal.ansiBrightYellow") ?? "#eab308";
  const blue = pick("terminal.ansiBlue", "terminal.ansiBrightBlue") ?? "#3b82f6";
  const magenta = pick("terminal.ansiMagenta", "terminal.ansiBrightMagenta") ?? "#a855f7";

  const reviewedMark = pick("editorIndentGuide.background", "editorIndentGuide.activeBackground") ?? border;

  const findScope = (...needles: string[]): string | undefined => {
    for (const needle of needles) {
      for (const tc of theme.tokenColors ?? []) {
        const fg = tc.settings?.foreground;
        if (!fg) continue;
        const scopes = Array.isArray(tc.scope) ? tc.scope : tc.scope ? [tc.scope] : [];
        if (scopes.some((s) => s.split(",").some((p) => p.trim() === needle || p.trim().startsWith(needle + ".")))) {
          return fg;
        }
      }
    }
    return undefined;
  };

  return {
    label,
    colorScheme,
    vars: {
      "bg": bg,
      "bg-2": bg2,
      "bg-3": bg3,
      "fg": fg,
      "fg-dim": fgDim,
      "fg-mute": fgMute,
      "accent": accent,
      "green": green,
      "green-bg": withAlpha(green, 0.1),
      "red": red,
      "red-bg": withAlpha(red, 0.1),
      "yellow": yellow,
      "magenta": magenta,
      "blue": blue,
      "border": stripAlpha(border) ?? border,
      "border-active": stripAlpha(borderActive) ?? borderActive,
      "cursor-bg": cursorBg,
      "reviewed-bg": withAlpha(accent, 0.06),
      "reviewed-mark": stripAlpha(reviewedMark) ?? reviewedMark,
      "font-mono": monoFont,
      "syntax-comment": findScope("comment") ?? fgMute,
      "syntax-keyword": findScope("keyword", "storage") ?? magenta,
      "syntax-string": findScope("string") ?? green,
      "syntax-number": findScope("constant.numeric", "constant") ?? yellow,
      "syntax-function": findScope("entity.name.function", "support.function") ?? blue,
      "syntax-type": findScope("entity.name.type", "support.type", "storage.type") ?? yellow,
      "syntax-property": findScope("support.type.property-name", "variable.other.property", "meta.object-literal.key") ?? blue,
      "syntax-variable": findScope("variable") ?? fg,
      "syntax-tag": findScope("entity.name.tag") ?? magenta,
      "syntax-punctuation": findScope("punctuation") ?? fgDim,
    },
  };
}

function stripAlpha(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color.length === 9 && color.startsWith("#")) return color.slice(0, 7);
  return color;
}

function pickSaturated(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (c && saturation(c) >= 0.3) return c;
  }
  return undefined;
}

function saturation(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function withAlpha(color: string, alpha: number): string {
  const hex = stripAlpha(color);
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return color;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca.r * t + cb.r * (1 - t));
  const g = Math.round(ca.g * t + cb.g * (1 - t));
  const bl = Math.round(ca.b * t + cb.b * (1 - t));
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(color: string): { r: number; g: number; b: number } | undefined {
  const hex = stripAlpha(color);
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return undefined;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
