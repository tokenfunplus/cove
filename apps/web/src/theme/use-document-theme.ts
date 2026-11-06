import { useEffect, useState } from "react";
import { type ThemePreference } from "@cove/api-contract";
import { applyDocumentTheme, resolvedThemePreference } from "@/theme/theme";

export function useDocumentTheme(
  preference: ThemePreference,
): "light" | "dark" {
  const [appearance, setAppearance] = useState(() =>
    resolvedThemePreference(preference),
  );
  useEffect(() => {
    const update = () => {
      applyDocumentTheme(preference);
      setAppearance(resolvedThemePreference(preference));
    };
    update();
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);
  return appearance;
}
