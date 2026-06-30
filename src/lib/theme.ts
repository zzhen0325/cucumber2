export const THEME_STORAGE_KEY = "cucumber:theme";

export const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "future", label: "Future" },
] as const;

export type ThemeName = (typeof THEME_OPTIONS)[number]["value"];

const DEFAULT_THEME: ThemeName = "light";

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_OPTIONS.some((theme) => theme.value === value);
}

export function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(storedTheme) ? storedTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const isDarkSurface = theme !== "light";

  root.dataset.theme = theme;
  root.classList.toggle("dark", isDarkSurface);
  root.style.colorScheme = isDarkSurface ? "dark" : "light";

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is best-effort; the CSS variables still apply.
  }
}

export function initializeTheme() {
  applyTheme(readStoredTheme());
}
