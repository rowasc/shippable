import "./ThemePicker.css";
import { THEME_OPTIONS, isThemeId, type ThemeId } from "../tokens";

interface Props {
  value: ThemeId;
  onChange: (themeId: ThemeId) => void;
}

export function ThemePicker({ value, onChange }: Props) {
  return (
    <label className="theme-picker">
      <span className="theme-picker__label">theme</span>
      <select
        className="theme-picker__select"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (isThemeId(next)) onChange(next);
        }}
        aria-label="Select UI and code theme"
        title="Select UI and code theme"
      >
        {THEME_OPTIONS.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
    </label>
  );
}
