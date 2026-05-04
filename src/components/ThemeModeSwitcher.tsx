import { Monitor, Moon, Sun } from "lucide-react";

import { useI18n } from "../app/i18n";
import { THEME_MODES, type ThemeMode } from "../lib/deploymentConfig";
import { Tooltip } from "./Tooltip";

const THEME_ICON = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} satisfies Record<ThemeMode, typeof Monitor>;

function themeTooltipKey(mode: ThemeMode) {
  if (mode === "system") {
    return "Use system theme";
  }
  if (mode === "light") {
    return "Use light theme";
  }
  return "Use dark theme";
}

export function ThemeModeSwitcher({
  value,
  onChange,
  t,
  className = "",
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  t?: (key: string) => string;
  className?: string;
}) {
  const { t: contextT } = useI18n();
  const label = t ?? contextT;

  return (
    <div className={`themeSwitcher ${className}`.trim()} aria-label={label("Theme mode")}>
      {THEME_MODES.map((mode) => {
        const Icon = THEME_ICON[mode];
        const tooltip = label(themeTooltipKey(mode));
        return (
          <Tooltip content={tooltip} key={mode}>
            <button
              type="button"
              className={mode === value ? "active" : ""}
              onClick={() => onChange(mode)}
              aria-label={tooltip}
              aria-pressed={mode === value}
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
