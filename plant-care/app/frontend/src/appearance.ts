import { useEffect, useState } from "react";

export type Appearance = "system" | "light" | "dark";
const key = "plantcare.appearance";

function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(key);
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be unavailable in private WebViews. */ }
  return "system";
}

export function applyAppearance(appearance: Appearance) {
  const dark = appearance === "dark" || (appearance === "system" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// Set the theme before React paints, including the login screen.
applyAppearance(savedAppearance());

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    try { localStorage.setItem(key, appearance); } catch { /* Still apply locally. */ }
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => applyAppearance(appearance);
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, [appearance]);
  return [appearance, setAppearance] as const;
}
