export const colors = {
  bg: "#0b0e14",
  bg2: "#11151c",
  bg3: "#161b24",
  fg: "#c7cbd1",
  fgDim: "#7f8896",
  fgMute: "#555b66",
  accent: "#89ddff",
  green: "#a6e3a1",
  greenBg: "rgba(166, 227, 161, 0.08)",
  red: "#f38ba8",
  redBg: "rgba(243, 139, 168, 0.08)",
  yellow: "#f9e2af",
  magenta: "#cba6f7",
  blue: "#74c7ec",
  border: "#232a36",
  borderActive: "#4a5467",
  cursorBg: "#1e2532",
  reviewedBg: "rgba(137, 221, 255, 0.05)",
  reviewedMark: "#3c4656",
} as const;

export const fonts = {
  mono: '"JetBrains Mono", "Fira Code", "SF Mono", "Menlo", "Consolas", monospace',
} as const;

export function applyTokensToRoot(el: HTMLElement): void {
  el.style.setProperty("--bg", colors.bg);
  el.style.setProperty("--bg-2", colors.bg2);
  el.style.setProperty("--bg-3", colors.bg3);
  el.style.setProperty("--fg", colors.fg);
  el.style.setProperty("--fg-dim", colors.fgDim);
  el.style.setProperty("--fg-mute", colors.fgMute);
  el.style.setProperty("--accent", colors.accent);
  el.style.setProperty("--green", colors.green);
  el.style.setProperty("--green-bg", colors.greenBg);
  el.style.setProperty("--red", colors.red);
  el.style.setProperty("--red-bg", colors.redBg);
  el.style.setProperty("--yellow", colors.yellow);
  el.style.setProperty("--magenta", colors.magenta);
  el.style.setProperty("--blue", colors.blue);
  el.style.setProperty("--border", colors.border);
  el.style.setProperty("--border-active", colors.borderActive);
  el.style.setProperty("--cursor-bg", colors.cursorBg);
  el.style.setProperty("--reviewed-bg", colors.reviewedBg);
  el.style.setProperty("--reviewed-mark", colors.reviewedMark);
  el.style.setProperty("--font-mono", fonts.mono);
}
