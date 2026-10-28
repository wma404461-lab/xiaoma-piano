import { useSyncExternalStore } from "react";
export type Theme = "light" | "dark";
let theme: Theme = "light";
try {
  if (localStorage.getItem("qinban-theme") === "dark") theme = "dark";
} catch {
  /* Optional preference. */
}
const listeners = new Set<() => void>();
export function initializeTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export function setTheme(next: Theme) {
  theme = next;
  initializeTheme();
  try {
    localStorage.setItem("qinban-theme", theme);
  } catch {
    /* Optional preference. */
  }
  listeners.forEach((listener) => listener());
}
export function useTheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => theme,
  );
}
