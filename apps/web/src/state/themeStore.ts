/**
 * Viewport theme store (issue #38): persists the oscilloscope viewport theme
 * (Dark OLED / Light-Lab) across browser sessions in local storage. The
 * default is the Dark OLED theme; an unreadable or unknown stored value
 * falls back to the default.
 */

import { create } from "zustand";
import type { ViewportTheme } from "../components/canvas/themePalette";
import { readString, writeString } from "./storage";

export const VIEWPORT_THEME_STORAGE_KEY = "fvf.viewport-theme";

function isViewportTheme(value: unknown): value is ViewportTheme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): ViewportTheme {
  const stored = readString(VIEWPORT_THEME_STORAGE_KEY);
  return isViewportTheme(stored) ? stored : "dark";
}

function writeStoredTheme(theme: ViewportTheme): void {
  writeString(VIEWPORT_THEME_STORAGE_KEY, theme);
}

export interface ThemeStoreState {
  theme: ViewportTheme;
  setTheme: (theme: ViewportTheme) => void;
  toggleTheme: () => void;
}

function createThemeStore() {
  return create<ThemeStoreState>((set) => ({
    theme: readStoredTheme(),
    setTheme: (theme) =>
      set(() => {
        writeStoredTheme(theme);
        return { theme };
      }),
    toggleTheme: () =>
      set((state) => {
        const theme: ViewportTheme = state.theme === "dark" ? "light" : "dark";
        writeStoredTheme(theme);
        return { theme };
      }),
  }));
}

export const useThemeStore = createThemeStore();
