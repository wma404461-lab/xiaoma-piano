import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "../lib/theme";
export function ThemeToggle() {
  const { t } = useI18n();
  const dark = useTheme() === "dark";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={t("Dark mode")}
      aria-pressed={dark}
      title={dark ? t("Switch to light mode") : t("Switch to dark mode")}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
