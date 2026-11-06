import { type ThemePreference } from "@cove/api-contract";

export function resolvedThemePreference(
  theme: ThemePreference,
): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyDocumentTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedThemePreference(theme);
}
