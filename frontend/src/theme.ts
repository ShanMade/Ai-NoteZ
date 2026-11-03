import { useEffect, useState } from "react";
import type { DesignDirection, ThemeChoice } from "./store/ui";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

/** Turns the saved preference ("system" | "light" | "dark") into the theme actually shown. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

/**
 * Keeps <html> in step with the user's appearance setting.
 *
 * The design-direction tokens are keyed on `data-direction` and `data-theme` attributes. Setting
 * them on the document root (not only on the workspace wrapper) lets the page background, body
 * text and any overlay outside the wrapper use the same palette as the app.
 */
export function useDocumentTheme(choice: ThemeChoice, direction: DesignDirection): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(choice));

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(choice);
      const root = document.documentElement;
      root.dataset.direction = direction;
      root.dataset.theme = next;
      root.style.colorScheme = next;
      setResolved(next);
    };
    apply();
    if (choice !== "system" || !window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice, direction]);

  return resolved;
}
