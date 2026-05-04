import { Check, Languages } from "lucide-react";
import { useMemo, useState } from "react";

import { translate } from "../../app/i18n";
import { TargetLocalePicker } from "../../components/TargetLocalePicker";
import { ThemeModeSwitcher } from "../../components/ThemeModeSwitcher";
import type { AppLocale, ThemeMode } from "../../lib/deploymentConfig";
import { APP_LOCALES } from "../../lib/deploymentConfig";
import { preferredAppLocale, preferredMinecraftLocale, uniqueLocaleCodes } from "../../lib/locales";
import type { LocaleCode } from "../../lib/types";

export function SetupPage({
  initialAppLocale,
  initialTargetLocales,
  initialThemeMode,
  onComplete,
  onThemeModeChange,
}: {
  initialAppLocale: AppLocale;
  initialTargetLocales: readonly LocaleCode[];
  initialThemeMode: ThemeMode;
  onComplete: (options: { appLocale: AppLocale; targetLocales: LocaleCode[]; themeMode: ThemeMode }) => void;
  onThemeModeChange?: (themeMode: ThemeMode) => void;
}) {
  const browserAppLocale = useMemo(() => preferredAppLocale(), []);
  const browserTargetLocale = useMemo(() => preferredMinecraftLocale(), []);
  const [appLocale, setAppLocale] = useState<AppLocale>(initialAppLocale || browserAppLocale);
  const [targetLocales, setTargetLocales] = useState<LocaleCode[]>(() => uniqueLocaleCodes(initialTargetLocales.length ? initialTargetLocales : [browserTargetLocale]));
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const t = (key: string) => translate(appLocale, key);

  function updateThemeMode(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    onThemeModeChange?.(nextThemeMode);
  }

  return (
    <main className="setupShell">
      <section className="setupPanel" aria-labelledby="setup-title">
        <div className="setupBrand">
          <img src="./assets/icon.svg" alt="" aria-hidden="true" />
          <div>
            <h1 id="setup-title">{t("Minecraft Mods Localizer")}</h1>
            <p>{t("Localize Minecraft mod language files with patches, glossary hints, and LLM-assisted translation.")}</p>
          </div>
        </div>

        <div className="setupCard">
          <div className="setupCardTop">
            <div className="setupCardHeader">
              <Languages size={20} />
              <div>
                <h2>{t("Choose your workspace defaults")}</h2>
                <p>{t("These choices can be changed later in Settings.")}</p>
              </div>
            </div>
            <ThemeModeSwitcher value={themeMode} onChange={updateThemeMode} t={t} />
          </div>

          <label>
            {t("App language")}
            <div className="segmentedControl wide">
              {APP_LOCALES.map((locale) => (
                <button
                  type="button"
                  key={locale}
                  className={locale === appLocale ? "active" : ""}
                  onClick={() => setAppLocale(locale)}
                >
                  {locale === "zh_tw" ? t("Traditional Chinese") : t("English")}
                </button>
              ))}
            </div>
          </label>

          <section className="setupFieldGroup" aria-label={t("Target languages")}>
            <div className="setupFieldLabel">{t("Target languages")}</div>
            <TargetLocalePicker selectedLocales={targetLocales} onChange={setTargetLocales} />
          </section>

          <button
            type="button"
            className="primary setupContinue"
            disabled={targetLocales.length === 0}
            onClick={() => onComplete({ appLocale, targetLocales, themeMode })}
          >
            <Check size={16} />
            {t("Continue")}
          </button>
        </div>
      </section>
    </main>
  );
}
