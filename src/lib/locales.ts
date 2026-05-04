export const CHINESE_LOCALES = ["zh_cn", "zh_tw", "zh_hk"] as const;
export const DEFAULT_TARGET_LOCALE = "en_us";

export const BUNDLED_LOCALE_CODES = [
  "de_de",
  "en_us",
  "es_es",
  "fr_fr",
  "it_it",
  "ja_jp",
  "ko_kr",
  "lzh",
  "nl_nl",
  "pt_br",
  "ru_ru",
  "th_th",
  "uk_ua",
  "vi_vn",
  "zh_cn",
  "zh_hk",
  "zh_tw",
] as const;

export const DEFAULT_SOURCE_LOCALE_PRIORITY = [DEFAULT_TARGET_LOCALE] as const;

export function normalizeLocaleCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidLocaleCode(value: unknown): value is string {
  const locale = normalizeLocaleCode(value);
  return /^[a-z]{2,3}(?:_[a-z0-9]{2,4})?$/.test(locale);
}

export function uniqueLocaleCodes(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const locale = normalizeLocaleCode(value);
    if (!locale || !isValidLocaleCode(locale) || seen.has(locale)) {
      continue;
    }
    seen.add(locale);
    output.push(locale);
  }
  return output;
}

export function effectiveTargetLocales(values: readonly unknown[]): string[] {
  const locales = uniqueLocaleCodes(values);
  return locales.length ? locales : [DEFAULT_TARGET_LOCALE];
}

export function isChineseLocale(locale: string): locale is (typeof CHINESE_LOCALES)[number] {
  return (CHINESE_LOCALES as readonly string[]).includes(locale);
}

export function preferredMinecraftLocale(languageTags: readonly string[] = browserLanguageTags()): string {
  for (const tag of languageTags) {
    const locale = localeCodeFromLanguageTag(tag);
    if (locale && (BUNDLED_LOCALE_CODES as readonly string[]).includes(locale)) {
      return locale;
    }
  }
  return "zh_tw";
}

export function preferredAppLocale(languageTags: readonly string[] = browserLanguageTags()): "en_us" | "zh_tw" {
  return languageTags.some((tag) => tag.toLowerCase().startsWith("zh")) ? "zh_tw" : "en_us";
}

function browserLanguageTags(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  return [...languages, navigator.language].filter(Boolean);
}

function localeCodeFromLanguageTag(tag: string): string {
  const normalized = tag.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) {
    return "";
  }
  if (normalized === "zh" || normalized === "zh_hant" || normalized.startsWith("zh_tw") || normalized.startsWith("zh_hk")) {
    return "zh_tw";
  }
  if (normalized === "zh_hans" || normalized.startsWith("zh_cn") || normalized.startsWith("zh_sg")) {
    return "zh_cn";
  }
  const exact = normalizeLocaleCode(normalized);
  if ((BUNDLED_LOCALE_CODES as readonly string[]).includes(exact)) {
    return exact;
  }
  const language = exact.split("_")[0];
  const regionalFallbacks: Record<string, string> = {
    de: "de_de",
    en: "en_us",
    es: "es_es",
    fr: "fr_fr",
    it: "it_it",
    ja: "ja_jp",
    ko: "ko_kr",
    nl: "nl_nl",
    pt: "pt_br",
    ru: "ru_ru",
    th: "th_th",
    uk: "uk_ua",
    vi: "vi_vn",
  };
  return regionalFallbacks[language] ?? "";
}
