import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

export const THEME_KEY = "xssd-theme";
const THEMES = ["system", "light", "dark"];
const ThemeContext = createContext(null);

function readStored() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return THEMES.includes(stored) ? stored : "system";
  } catch (_) {
    return "system"; // storage blocked
  }
}

// "system" leaves the attribute off so the OS preference applies; "light"/"dark" force a theme.
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStored);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch (_) { /* keep the choice in memory only */ }
  }, []);

  const cycle = useCallback(() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]), [theme, setTheme]);
  const value = useMemo(() => ({ theme, setTheme, cycle }), [theme, setTheme, cycle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider");
  return value;
}
