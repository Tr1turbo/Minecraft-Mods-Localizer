import curatedGlossary from "../../data/curatedGlossary.json";
import { BUNDLED_LOCALE_CODES, normalizeLocaleCode } from "./locales";
import { VANILLA_LOCALES } from "./vanilla";
import type { ChineseLocale, GlossaryEntry, GlossaryOverride, LocaleCode } from "./types";

export interface SelectedGlossaryEntry {
  id: string;
  source: GlossaryEntry["source"];
  terms: Record<LocaleCode, string[]>;
  note?: string;
}

export interface CompactGlossaryDisplayEntry extends SelectedGlossaryEntry {
  displayId: string;
  tags: string[];
  hiddenIds: string[];
  allIds: string[];
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

interface ParsedVanillaGlossaryId {
  tag: string;
  namespace: "minecraft";
  object: string;
  fullId: string;
}

interface GlossaryRangeMatch {
  start: number;
  end: number;
  entries: GlossaryEntry[];
}

type VanillaGlossaryGroupKind = "same-object" | "same-tag";

interface VanillaGlossaryGroup<T extends SelectedGlossaryEntry> {
  kind: VanillaGlossaryGroupKind;
  entries: Array<{ entry: T; parsed: ParsedVanillaGlossaryId; index: number }>;
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
  const selectedIds = selectNonOverlappingGlossaryEntryIds(matches, entries);
  const selected = new Map<string, SelectedGlossaryEntry>();
  for (const entry of entries) {
    if (!selectedIds.has(entry.id)) {
      continue;
    }
    selected.set(entry.id, {
      id: entry.id,
      source: entry.source,
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
  const selectedIds = selectNonOverlappingGlossaryEntryIds([reference], entries);
  const matches = entries.filter((entry) => selectedIds.has(entry.id));
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

export function compactVanillaGlossaryEntriesForDisplay(
  entries: readonly GlossaryEntry[],
  locales: readonly LocaleCode[],
): CompactGlossaryDisplayEntry[] {
  return compactVanillaGlossaryEntries(
    entries.map((entry) => ({
      id: entry.id,
      source: entry.source,
      terms: cloneGlossaryTerms(entry.terms),
      ...(entry.note ? { note: entry.note } : {}),
    })),
    locales,
    "display",
  ).map((entry) => ({
    ...entry,
    displayId: entry.displayId ?? entry.id,
    tags: entry.tags ?? [],
    hiddenIds: entry.hiddenIds ?? [],
    allIds: entry.allIds ?? [entry.id],
  }));
}

export function compactVanillaGlossaryEntriesForPrompt(
  entries: readonly SelectedGlossaryEntry[],
  locales: readonly LocaleCode[],
): SelectedGlossaryEntry[] {
  return compactVanillaGlossaryEntries(entries, locales, "prompt").map((entry) => ({
    id: entry.id,
    source: entry.source,
    terms: cloneGlossaryTerms(entry.terms),
    ...(entry.note ? { note: entry.note } : {}),
  }));
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

function compactVanillaGlossaryEntries<T extends SelectedGlossaryEntry>(
  entries: readonly T[],
  locales: readonly LocaleCode[],
  mode: "display" | "prompt",
): Array<T & Partial<CompactGlossaryDisplayEntry>> {
  const groupsByEntryId = vanillaGlossaryGroupsByEntryId(entries, locales);
  const emittedGroups = new Set<VanillaGlossaryGroup<T>>();
  const output: Array<T & Partial<CompactGlossaryDisplayEntry>> = [];

  for (const entry of entries) {
    const group = groupsByEntryId.get(entry.id);
    if (!group) {
      output.push(displayEntryForSingle(entry));
      continue;
    }
    if (emittedGroups.has(group)) {
      continue;
    }
    emittedGroups.add(group);
    output.push(compactEntryForGroup(group, mode) as T & Partial<CompactGlossaryDisplayEntry>);
  }
  return output;
}

function vanillaGlossaryGroupsByEntryId<T extends SelectedGlossaryEntry>(
  entries: readonly T[],
  locales: readonly LocaleCode[],
): Map<string, VanillaGlossaryGroup<T>> {
  const candidates = entries
    .map((entry, index) => ({ entry, parsed: parseVanillaGlossaryId(entry), index }))
    .filter((item): item is { entry: T; parsed: ParsedVanillaGlossaryId; index: number } => Boolean(item.parsed));
  const consumed = new Set<string>();
  const groups = new Map<string, VanillaGlossaryGroup<T>>();

  for (const groupEntries of groupedCandidates(candidates, (item) => `${item.parsed.namespace}.${item.parsed.object}|${termsSignature(item.entry, locales)}`)) {
    if (new Set(groupEntries.map((item) => item.parsed.tag)).size < 2) {
      continue;
    }
    const group = sortedVanillaGroup("same-object", groupEntries);
    for (const item of group.entries) {
      consumed.add(item.entry.id);
      groups.set(item.entry.id, group);
    }
  }

  for (const groupEntries of groupedCandidates(
    candidates.filter((item) => !consumed.has(item.entry.id)),
    (item) => `${item.parsed.tag}.${item.parsed.namespace}|${termsSignature(item.entry, locales)}`,
  )) {
    if (groupEntries.length < 2) {
      continue;
    }
    const group = sortedVanillaGroup("same-tag", groupEntries);
    for (const item of group.entries) {
      groups.set(item.entry.id, group);
    }
  }

  return groups;
}

function groupedCandidates<T>(
  entries: readonly T[],
  groupKey: (entry: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
}

function sortedVanillaGroup<T extends SelectedGlossaryEntry>(
  kind: VanillaGlossaryGroupKind,
  entries: Array<{ entry: T; parsed: ParsedVanillaGlossaryId; index: number }>,
): VanillaGlossaryGroup<T> {
  return {
    kind,
    entries: [...entries].sort(compareVanillaGroupItems),
  };
}

function compareVanillaGroupItems<T extends SelectedGlossaryEntry>(
  first: { parsed: ParsedVanillaGlossaryId; index: number },
  second: { parsed: ParsedVanillaGlossaryId; index: number },
): number {
  return (
    first.parsed.namespace.localeCompare(second.parsed.namespace) ||
    first.parsed.object.localeCompare(second.parsed.object, undefined, { numeric: true }) ||
    first.parsed.tag.localeCompare(second.parsed.tag) ||
    first.index - second.index
  );
}

function compactEntryForGroup<T extends SelectedGlossaryEntry>(
  group: VanillaGlossaryGroup<T>,
  mode: "display" | "prompt",
): T & Partial<CompactGlossaryDisplayEntry> {
  const first = group.entries[0];
  const firstEntry = first.entry;
  const tags = uniqueStrings(group.entries.map((item) => item.parsed.tag));
  const allIds = group.entries.map((item) => item.parsed.fullId);
  const displayId = `${first.parsed.namespace}.${first.parsed.object}`;
  const promptId =
    group.kind === "same-tag"
      ? `${first.parsed.tag}.${first.parsed.namespace}.${group.entries.map((item) => item.parsed.object).join(", ")}`
      : allIds.join(", ");

  return {
    ...firstEntry,
    id: mode === "prompt" ? promptId : firstEntry.id,
    displayId,
    tags,
    hiddenIds: group.kind === "same-tag" ? allIds.slice(1) : [],
    allIds,
  };
}

function displayEntryForSingle<T extends SelectedGlossaryEntry>(entry: T): T & Partial<CompactGlossaryDisplayEntry> {
  const parsed = parseVanillaGlossaryId(entry);
  if (!parsed) {
    return entry;
  }
  return {
    ...entry,
    displayId: `${parsed.namespace}.${parsed.object}`,
    tags: [parsed.tag],
    hiddenIds: [],
    allIds: [parsed.fullId],
  };
}

function parseVanillaGlossaryId(entry: SelectedGlossaryEntry): ParsedVanillaGlossaryId | undefined {
  if (entry.source !== "vanilla") {
    return undefined;
  }
  const parts = entry.id.split(".");
  if (parts.length < 3 || parts[1] !== "minecraft") {
    return undefined;
  }
  const object = parts.slice(2).join(".");
  if (!parts[0] || !object) {
    return undefined;
  }
  return {
    tag: parts[0],
    namespace: "minecraft",
    object,
    fullId: entry.id,
  };
}

function termsSignature(entry: SelectedGlossaryEntry, locales: readonly LocaleCode[]): string {
  return JSON.stringify(uniqueLocaleCodesForGlossary(locales).map((locale) => [locale, entry.terms[locale] ?? []]));
}

function uniqueLocaleCodesForGlossary(locales: readonly LocaleCode[]): LocaleCode[] {
  return [...new Set(locales.map((locale) => normalizeLocaleCode(locale)).filter(Boolean))];
}

function selectNonOverlappingGlossaryEntryIds(
  matches: readonly GlossaryMatchEntry[],
  entries: readonly GlossaryEntry[],
): Set<string> {
  const selected = new Set<string>();
  const enabledEntries = entries.filter((entry) => entry.enabled);
  const vanillaEntries = enabledEntries.filter((entry) => entry.source === "vanilla");
  const directEntries = enabledEntries.filter((entry) => entry.source !== "vanilla");
  for (const match of matches) {
    for (const entry of directEntries) {
      if (glossaryEntryHasTermMatch(match, entry)) {
        selected.add(entry.id);
      }
    }
    for (const range of selectNonOverlappingGlossaryRanges(match, vanillaEntries)) {
      for (const entry of range.entries) {
        selected.add(entry.id);
      }
    }
  }
  return selected;
}

function glossaryEntryHasTermMatch(match: GlossaryMatchEntry, entry: GlossaryEntry): boolean {
  const haystack = normalizeMatchText(match.value);
  return Boolean(haystack && glossaryTermsForLocales(entry, [match.locale]).some((term) => normalizedTermRanges(haystack, term).length > 0));
}

function selectNonOverlappingGlossaryRanges(
  match: GlossaryMatchEntry,
  entries: readonly GlossaryEntry[],
): GlossaryRangeMatch[] {
  const haystack = normalizeMatchText(match.value);
  if (!haystack) {
    return [];
  }

  const rangeByKey = new Map<string, GlossaryRangeMatch>();
  for (const entry of entries) {
    for (const term of glossaryTermsForLocales(entry, [match.locale])) {
      for (const range of normalizedTermRanges(haystack, term)) {
        const key = `${range.start}:${range.end}`;
        const existing = rangeByKey.get(key);
        if (existing) {
          existing.entries.push(entry);
        } else {
          rangeByKey.set(key, { start: range.start, end: range.end, entries: [entry] });
        }
      }
    }
  }

  const selected: GlossaryRangeMatch[] = [];
  for (const range of [...rangeByKey.values()].sort(compareGlossaryRangesByLength)) {
    if (selected.some((accepted) => rangesOverlap(accepted, range))) {
      continue;
    }
    selected.push({
      ...range,
      entries: uniqueGlossaryEntries(range.entries),
    });
  }
  return selected;
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

function normalizedTermRanges(normalizedHaystack: string, term: string): Array<{ start: number; end: number }> {
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) {
    return [];
  }
  if (usesSeparatedWords(normalizedTerm)) {
    return wordTermRanges(normalizedHaystack, normalizedTerm);
  }
  if (Array.from(normalizedTerm).length === 1) {
    return normalizedHaystack === normalizedTerm ? [{ start: 0, end: normalizedHaystack.length }] : [];
  }
  return substringRanges(normalizedHaystack, normalizedTerm);
}

function wordTermRanges(normalizedHaystack: string, normalizedTerm: string): Array<{ start: number; end: number }> {
  return substringRanges(normalizedHaystack, normalizedTerm).filter((range) => {
    const before = range.start === 0 ? " " : normalizedHaystack[range.start - 1];
    const after = range.end === normalizedHaystack.length ? " " : normalizedHaystack[range.end];
    return before === " " && after === " ";
  });
}

function substringRanges(normalizedHaystack: string, normalizedTerm: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = normalizedHaystack.indexOf(normalizedTerm); start >= 0; start = normalizedHaystack.indexOf(normalizedTerm, start + 1)) {
    ranges.push({ start, end: start + normalizedTerm.length });
  }
  return ranges;
}

function compareGlossaryRangesByLength(first: GlossaryRangeMatch, second: GlossaryRangeMatch): number {
  return second.end - second.start - (first.end - first.start) || first.start - second.start || first.end - second.end;
}

function rangesOverlap(first: GlossaryRangeMatch, second: GlossaryRangeMatch): boolean {
  return first.start < second.end && second.start < first.end;
}

function uniqueGlossaryEntries(entries: readonly GlossaryEntry[]): GlossaryEntry[] {
  const byId = new Map<string, GlossaryEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
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
