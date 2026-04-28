import { useEffect, useState } from "react";
import {
  applyThemeToRoot,
  getStoredThemeId,
  persistThemeId,
  type ThemeId,
} from "./tokens";

export function useTheme() {
  const [themeId, setThemeId] = useState<ThemeId>(() => getStoredThemeId());

  useEffect(() => {
    applyThemeToRoot(document.documentElement, themeId);
    persistThemeId(themeId);
  }, [themeId]);

  return [themeId, setThemeId] as const;
}
