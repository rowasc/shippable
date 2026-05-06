import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import dracula from "@shikijs/themes/dracula";
import nord from "@shikijs/themes/nord";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import rosePine from "@shikijs/themes/rose-pine";
import rosePineDawn from "@shikijs/themes/rose-pine-dawn";
import solarizedDark from "@shikijs/themes/solarized-dark";
import solarizedLight from "@shikijs/themes/solarized-light";
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
  { id: "nord", label: "Nord", theme: nord as ShikiTheme },
  { id: "oneDarkPro", label: "One Dark Pro", theme: oneDarkPro as ShikiTheme },
  { id: "rosePine", label: "Rosé Pine", theme: rosePine as ShikiTheme },
  { id: "rosePineDawn", label: "Rosé Pine Dawn", theme: rosePineDawn as ShikiTheme },
  { id: "solarizedDark", label: "Solarized Dark", theme: solarizedDark as ShikiTheme },
  { id: "solarizedLight", label: "Solarized Light", theme: solarizedLight as ShikiTheme },
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

  // Surface tokens: many themes use alpha on these (Rosé Pine sets
  // list.activeSelectionBackground at 8% alpha). Stripping alpha gives an
  // opaque blob; flattening against bg gives the actually-rendered color.
  const bg2 = flattenAlpha(pick("sideBar.background", "editorWidget.background"), bg) ?? mix(fg, bg, 0.04);
  const bg3 = flattenAlpha(pick("list.activeSelectionBackground", "editor.lineHighlightBackground"), bg) ??
    mix(fg, bg, 0.08);
  const cursorBg = flattenAlpha(pick("editor.lineHighlightBackground", "list.hoverBackground"), bg) ?? mix(fg, bg, 0.06);

  // Always derive dim/mute from a mix of fg and bg. Theme-provided candidates
  // are unreliable: Catppuccin sets descriptionForeground = foreground;
  // activeLineNumber is often the accent color; plain lineNumber sometimes
  // matches accent too. Mix gives a guaranteed-muted gray in the right family.
  const fgDim = mix(fg, bg, 0.6);
  const fgMute = mix(fg, bg, 0.4);

  // Diff-semantic colors: green = success/added, red = error/removed. Hue-check
  // theme candidates so palettes that use teal-as-green (Rosé Pine) or rose-
  // as-red don't poison diff-add/diff-remove backgrounds with the wrong hue.
  const greenDefault = colorScheme === "dark" ? "#22c55e" : "#1a7f37";
  const redDefault = colorScheme === "dark" ? "#ef4444" : "#cf222e";
  const green = pickInHue(60, 170, pick("terminal.ansiGreen"), pick("terminal.ansiBrightGreen")) ?? greenDefault;
  const red = pickInHue(-20, 20, pick("terminal.ansiRed"), pick("terminal.ansiBrightRed")) ?? redDefault;
  const yellow = pick("terminal.ansiYellow", "terminal.ansiBrightYellow") ?? "#eab308";
  const blue = pick("terminal.ansiBlue", "terminal.ansiBrightBlue") ?? "#3b82f6";
  const magenta = pick("terminal.ansiMagenta", "terminal.ansiBrightMagenta") ?? "#a855f7";

  const reviewedMark = flattenAlpha(pick("editorIndentGuide.background", "editorIndentGuide.activeBackground"), bg) ?? border;

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
      "bg-1": bg,
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
      "border": border,
      "border-active": borderActive,
      "cursor-bg": cursorBg,
      "reviewed-bg": withAlpha(accent, 0.06),
      "reviewed-mark": reviewedMark,
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

// Pick the first candidate whose hue falls in [low, high]. `low` may be
// negative to wrap around 0 (e.g. red is -20..20, meaning 340..360 OR 0..20).
function pickInHue(low: number, high: number, ...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (!c) continue;
    const stripped = stripAlpha(c);
    if (!stripped) continue;
    const h = hue(stripped);
    if (h === undefined) continue;
    const inRange = low < 0
      ? h >= 360 + low || h <= high
      : h >= low && h <= high;
    if (inRange) return stripped;
  }
  return undefined;
}

function hue(color: string): number | undefined {
  const rgb = parseHex(color);
  if (!rgb) return undefined;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

// Blend an #rrggbbaa color against bg to recover the actually-rendered color.
// Themes often encode soft tints with alpha; stripping the alpha gives an
// opaque blob that's much darker/saturated than the theme intended.
function flattenAlpha(color: string | undefined, bg: string): string | undefined {
  if (!color) return undefined;
  if (color.length !== 9 || !color.startsWith("#")) return stripAlpha(color);
  const alpha = parseInt(color.slice(7, 9), 16) / 255;
  const fg = parseHex(color);
  const bgRgb = parseHex(bg);
  if (!fg || !bgRgb) return color.slice(0, 7);
  const r = Math.round(fg.r * alpha + bgRgb.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + bgRgb.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + bgRgb.b * (1 - alpha));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
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
