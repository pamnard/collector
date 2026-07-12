import { useEffect } from "react";
import { useAppSettings } from "../context/AppSettingsContext";

export type Theme = "light" | "dark";

export function useTheme() {
  const { settings, setTheme } = useAppSettings();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  const toggleTheme = () => {
    void setTheme(settings.theme === "dark" ? "light" : "dark");
  };

  return { theme: settings.theme, toggleTheme };
}
