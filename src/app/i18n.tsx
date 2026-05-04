import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppLocale } from "../lib/deploymentConfig";
import enUs from "./locales/en_us.json";
import zhTw from "./locales/zh_tw.json";

type I18nValues = Record<string, string | number>;

interface I18nContextValue {
  locale: AppLocale;
  t: (key: string, values?: I18nValues) => string;
}

const dictionaries: Record<AppLocale, Record<string, string>> = {
  en_us: enUs,
  zh_tw: zhTw,
};

const I18nContext = createContext<I18nContextValue>({
  locale: "en_us",
  t: (key, values) => interpolate(key, values),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function translate(locale: AppLocale, key: string, values?: I18nValues): string {
  return interpolate(dictionaries[locale]?.[key] ?? key, values);
}

function interpolate(template: string, values: I18nValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}
