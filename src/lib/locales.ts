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
