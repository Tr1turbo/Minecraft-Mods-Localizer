import curatedGlossary from "../../data/curatedGlossary.json";
import { BUNDLED_LOCALE_CODES, normalizeLocaleCode } from "./locales";
import { VANILLA_LOCALES } from "./vanilla";
import type { ChineseLocale, GlossaryEntry, GlossaryOverride, LocaleCode } from "./types";

export interface SelectedGlossaryEntry {
  id: string;
  terms: Record<LocaleCode, string[]>;
  note?: string;
}

interface GlossaryMatchEntry {
  key: string;
  locale: LocaleCode;
  value: string;
}

interface GlossaryReferenceEntry {
  key: string;
  locale: LocaleCode;
  value: string;
}

export const INTERNAL_VANILLA_GLOSSARY: readonly GlossaryEntry[] = buildInternalVanillaGlossary();

export const BUILTIN_GLOSSARY: readonly GlossaryEntry[] = curatedGlossary
  .map(normalizeBuiltinGlossaryEntry)
  .sort(compareGlossaryEntries);

const builtinById: Map<string, GlossaryEntry> = new Map(BUILTIN_GLOSSARY.map((entry) => [entry.id, entry]));
const internalVanillaEntryIds: ReadonlySet<string> = new Set(INTERNAL_VANILLA_GLOSSARY.map((entry) => entry.id));
const glossaryDictionaryCache = new WeakMap<readonly GlossaryEntry[], Map<string, string[][]>>();

export const DEFAULT_RUNTIME_GLOSSARY: readonly GlossaryEntry[] = glossaryWithInternalVanilla(BUILTIN_GLOSSARY);

export function effectiveGlossaryEntries(overrides: Record<string, GlossaryOverride> = {}): GlossaryEntry[] {
  const result: GlossaryEntry[] = [];
  const used = new Set<string>();

  for (const builtin of BUILTIN_GLOSSARY) {
    const override = overrides[builtin.id];
    result.push(normalizeGlossaryEntry(builtin.id, { ...builtin, ...override, source: builtin.source }, builtin));
    used.add(builtin.id);
  }

  for (const [id, override] of Object.entries(overrides)) {
    if (used.has(id) || isInternalVanillaGlossaryEntry(id)) {
      continue;
    }
    result.push(normalizeGlossaryEntry(id, { ...override, source: "custom" }));
  }

  return result.sort(compareGlossaryEntries);
}

export function glossaryWithInternalVanilla(entries: readonly GlossaryEntry[]): GlossaryEntry[] {
  return [...entries, ...INTERNAL_VANILLA_GLOSSARY].sort(compareGlossaryEntries);
}

export function normalizeGlossaryOverrides(value: unknown): Record<string, GlossaryOverride> {
  const raw = glossaryRecordFromUnknown(value);
  const result: Record<string, GlossaryOverride> = {};
  for (const [id, override] of Object.entries(raw)) {
    if (!id.trim() || isInternalVanillaGlossaryEntry(id)) {
      continue;
    }
    const normalized = normalizeGlossaryOverride(override);
    if (normalized) {
      result[id] = normalized;
    }
  }
  return result;
}

export function glossaryOverrideFromEntry(entry: GlossaryEntry): GlossaryOverride {
  return {
    enabled: entry.enabled,
    source: entry.source,
    terms: cloneGlossaryTerms(entry.terms),
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export function glossaryDictionaryForConversion(
  entries: readonly GlossaryEntry[],
  from: ChineseLocale,
  to: ChineseLocale,
): string[][] {
  const cacheKey = `${from}->${to}`;
  const cached = glossaryDictionaryCache.get(entries)?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pairs = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    const toValue = preferredGlossaryTerm(entry.terms[to] ?? []);
    if (!toValue) {
      continue;
    }
    for (const fromValue of entry.terms[from] ?? []) {
      const sourceValue = fromValue.trim();
      // Keep identity pairs: OpenCC's longest-match trie can use them to protect
      // longer vanilla terms from shorter substitutions inside the phrase.
      if (!sourceValue || pairs.has(sourceValue)) {
        continue;
      }
      pairs.set(sourceValue, toValue);
    }
  }
  const dictionary = [...pairs.entries()].sort((first, second) => second[0].length - first[0].length || first[0].localeCompare(second[0]));
  let entryCache = glossaryDictionaryCache.get(entries);
  if (!entryCache) {
    entryCache = new Map<string, string[][]>();
    glossaryDictionaryCache.set(entries, entryCache);
  }
  entryCache.set(cacheKey, dictionary);
  return dictionary;
}

export function selectGlossaryEntries(
  matches: readonly GlossaryMatchEntry[],
  entries: readonly GlossaryEntry[],
): SelectedGlossaryEntry[] {
  const selected = new Map<string, SelectedGlossaryEntry>();
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    if (!matches.some((match) => glossaryEntryMatches(match, entry))) {
      continue;
    }
    selected.set(entry.id, {
      id: entry.id,
      terms: cloneGlossaryTerms(entry.terms),
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  return [...selected.values()].sort((first, second) => first.id.localeCompare(second.id));
}

export function selectGlossaryEntriesForReference(
  reference: GlossaryReferenceEntry,
  entries: readonly GlossaryEntry[],
  limit = 12,
): GlossaryEntry[] {
  const matches = entries.filter((entry) => entry.enabled && glossaryEntryMatchesReference(reference, entry));
  return matches
    .sort((first, second) => sourceRank(first.source) - sourceRank(second.source) || secondLongestTerm(second) - secondLongestTerm(first) || first.id.localeCompare(second.id))
    .slice(0, limit);
}

export function splitGlossaryTerms(value: string): string[] {
  return uniqueStrings(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function joinGlossaryTerms(terms: readonly string[]): string {
  return terms.join(", ");
}

export function isBuiltinGlossaryEntry(id: string): boolean {
  return builtinById.has(id);
}

export function isInternalVanillaGlossaryEntry(id: string): boolean {
  return id.startsWith("vanilla.full.") || internalVanillaEntryIds.has(id);
}

function buildInternalVanillaGlossary(): GlossaryEntry[] {
  return Object.entries(VANILLA_LOCALES.en_us)
    .filter(([key, value]) => typeof value === "string" && value.trim() && !key.startsWith("advancements."))
    .map(([key, value]) => ({
      id: key,
      enabled: true,
      source: "vanilla" as const,
      terms: {
        en_us: [value],
        ...vanillaTermsForKey(key),
      },
      note: "Internal vanilla locale value.",
    }))
    .sort(compareGlossaryEntries);
}

function vanillaTermsForKey(key: string): Record<LocaleCode, string[]> {
  const terms: Record<LocaleCode, string[]> = {};
  for (const locale of BUNDLED_LOCALE_CODES) {
    if (locale === "en_us") {
      continue;
    }
    const value = VANILLA_LOCALES[locale]?.[key];
    if (typeof value === "string" && value.trim()) {
      terms[locale] = [value];
    }
  }
  return terms;
}

function glossaryRecordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((item): item is GlossaryEntry => Boolean(item && typeof item === "object" && "id" in item))
        .map((item) => [String(item.id), item]),
    );
  }
  const file = value as { glossary?: unknown; phraseMappings?: unknown };
  if (file.glossary && typeof file.glossary === "object") {
    return glossaryRecordFromUnknown(file.glossary);
  }
  if (file.phraseMappings && typeof file.phraseMappings === "object") {
    return glossaryRecordFromUnknown(file.phraseMappings);
  }
  return value as Record<string, unknown>;
}

function normalizeGlossaryOverride(value: unknown): GlossaryOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as GlossaryOverride;
  const output: GlossaryOverride = {};
  if (typeof input.enabled === "boolean") {
    output.enabled = input.enabled;
  }
  if (input.source === "vanilla" || input.source === "curated" || input.source === "custom") {
    output.source = input.source;
  }
  const terms = normalizeGlossaryTerms(input);
  if (Object.keys(terms).length > 0) {
    output.terms = terms;
  }
  if (typeof input.note === "string" && input.note.trim()) {
    output.note = input.note;
  }
  return output;
}

function normalizeGlossaryEntry(id: string, input: GlossaryOverride, fallback?: GlossaryEntry): GlossaryEntry {
  return {
    id,
    enabled: typeof input.enabled === "boolean" ? input.enabled : (fallback?.enabled ?? true),
    source: input.source ?? fallback?.source ?? "custom",
    terms: mergeGlossaryTerms(fallback?.terms ?? {}, normalizeGlossaryTerms(input)),
    ...(input.note ?? fallback?.note ? { note: input.note ?? fallback?.note } : {}),
  };
}

function normalizeBuiltinGlossaryEntry(value: unknown): GlossaryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Built-in Glossary entry must be an object.");
  }
  const input = value as Partial<GlossaryEntry> & Record<string, unknown>;
  if (!input.id || typeof input.id !== "string") {
    throw new Error("Built-in Glossary entry is missing an id.");
  }
  return normalizeGlossaryEntry(input.id, {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    source: input.source === "vanilla" || input.source === "curated" ? input.source : "curated",
    terms: normalizeGlossaryTerms(input),
    ...(typeof input.note === "string" && input.note ? { note: input.note } : {}),
  });
}

function normalizeGlossaryTerms(value: unknown): Record<LocaleCode, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as { terms?: unknown } & Record<string, unknown>;
  const terms: Record<LocaleCode, string[]> = {};
  if (input.terms && typeof input.terms === "object" && !Array.isArray(input.terms)) {
    for (const [locale, localeTerms] of Object.entries(input.terms as Record<string, unknown>)) {
      const normalizedLocale = normalizeLocaleCode(locale);
      if (Array.isArray(localeTerms) && normalizedLocale) {
        terms[normalizedLocale] = uniqueStrings(localeTerms.map((term) => String(term).trim()).filter(Boolean));
      }
    }
  }
  for (const [locale, localeTerms] of Object.entries(input)) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (Array.isArray(localeTerms) && normalizedLocale) {
      terms[normalizedLocale] = uniqueStrings(localeTerms.map((term) => String(term).trim()).filter(Boolean));
    }
  }
  return terms;
}

function mergeGlossaryTerms(
  fallbackTerms: Record<LocaleCode, string[]>,
  overrideTerms: Record<LocaleCode, string[]>,
): Record<LocaleCode, string[]> {
  const locales = new Set([...Object.keys(fallbackTerms), ...Object.keys(overrideTerms)]);
  return Object.fromEntries(
    [...locales]
      .map((locale) => [locale, uniqueStrings(overrideTerms[locale] ?? fallbackTerms[locale] ?? [])] as const),
  );
}

function cloneGlossaryTerms(terms: Record<LocaleCode, string[]>): Record<LocaleCode, string[]> {
  return Object.fromEntries(Object.entries(terms).map(([locale, localeTerms]) => [locale, [...localeTerms]]));
}

function glossaryEntryMatches(match: GlossaryMatchEntry, entry: GlossaryEntry): boolean {
  return glossaryEntryMatchesValue(match.value, entry, [match.locale]);
}

function glossaryEntryMatchesReference(reference: GlossaryReferenceEntry, entry: GlossaryEntry): boolean {
  return glossaryEntryMatchesValue(reference.value, entry, [reference.locale]);
}

function glossaryEntryMatchesValue(value: string, entry: GlossaryEntry, locales: readonly LocaleCode[]): boolean {
  const haystack = normalizeMatchText(value);
  return glossaryTermsForLocales(entry, locales).some((term) => matchNormalizedTerm(haystack, term));
}

function allGlossaryTerms(entry: GlossaryEntry): string[] {
  return Object.values(entry.terms).flat();
}

function glossaryTermsForLocales(entry: GlossaryEntry, locales: readonly LocaleCode[]): string[] {
  return locales.flatMap((locale) => entry.terms[locale] ?? []);
}

function secondLongestTerm(entry: GlossaryEntry): number {
  return allGlossaryTerms(entry).reduce((longest, term) => Math.max(longest, term.length), 0);
}

function preferredGlossaryTerm(terms: readonly string[]): string {
  return terms[0]?.trim() ?? "";
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchNormalizedTerm(normalizedHaystack: string, term: string): boolean {
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) {
    return false;
  }
  if (usesSeparatedWords(normalizedTerm)) {
    return ` ${normalizedHaystack} `.includes(` ${normalizedTerm} `);
  }
  if (Array.from(normalizedTerm).length === 1) {
    return normalizedHaystack === normalizedTerm;
  }
  return normalizedHaystack.includes(normalizedTerm);
}

function usesSeparatedWords(value: string): boolean {
  return /^[a-z0-9]+(?: [a-z0-9]+)*$/.test(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compareGlossaryEntries(first: GlossaryEntry, second: GlossaryEntry): number {
  const sourceOrder = sourceRank(first.source) - sourceRank(second.source);
  return sourceOrder || first.id.localeCompare(second.id);
}

function sourceRank(source: GlossaryEntry["source"]): number {
  switch (source) {
    case "custom":
      return 0;
    case "curated":
      return 1;
    case "vanilla":
      return 2;
  }
}
