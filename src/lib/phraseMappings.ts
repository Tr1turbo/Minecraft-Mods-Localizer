import curatedPhraseMappings from "../../data/curatedPhraseMappings.json";
import vanillaEnUs from "../../minecraft/lang/en_us.json";
import vanillaZhCn from "../../minecraft/lang/zh_cn.json";
import vanillaZhHk from "../../minecraft/lang/zh_hk.json";
import vanillaZhTw from "../../minecraft/lang/zh_tw.json";
import type { PhraseMapping, PhraseMappingOverride, TargetLocale } from "./types";
import { TARGET_LOCALES } from "./types";

export interface PhraseGlossaryEntry {
  id: string;
  en_us: string[];
  zh_cn: string[];
  zh_tw: string[];
  zh_hk: string[];
  note?: string;
}

interface PhraseMatchEntry {
  key: string;
  english: string;
}

interface PhraseReferenceEntry {
  key: string;
  value: string;
}

const VANILLA_LOCALES: Record<"en_us" | TargetLocale, Record<string, string>> = {
  en_us: vanillaEnUs,
  zh_cn: vanillaZhCn,
  zh_tw: vanillaZhTw,
  zh_hk: vanillaZhHk,
};

export const INTERNAL_VANILLA_PHRASE_MAPPINGS: readonly PhraseMapping[] = buildInternalVanillaPhraseMappings();

export const BUILTIN_PHRASE_MAPPINGS: readonly PhraseMapping[] = curatedPhraseMappings
  .map(normalizeBuiltinPhraseMapping)
  .sort(comparePhraseMappings);

const builtinById: Map<string, PhraseMapping> = new Map(BUILTIN_PHRASE_MAPPINGS.map((mapping) => [mapping.id, mapping]));
const internalVanillaMappingIds: ReadonlySet<string> = new Set(INTERNAL_VANILLA_PHRASE_MAPPINGS.map((mapping) => mapping.id));
const phraseDictionaryCache = new WeakMap<readonly PhraseMapping[], Map<string, string[][]>>();

export const DEFAULT_RUNTIME_PHRASE_MAPPINGS: readonly PhraseMapping[] = phraseMappingsWithInternalVanilla(BUILTIN_PHRASE_MAPPINGS);

export function effectivePhraseMappings(overrides: Record<string, PhraseMappingOverride> = {}): PhraseMapping[] {
  const result: PhraseMapping[] = [];
  const used = new Set<string>();

  for (const builtin of BUILTIN_PHRASE_MAPPINGS) {
    const override = overrides[builtin.id];
    result.push(normalizePhraseMapping(builtin.id, { ...builtin, ...override, source: builtin.source }, builtin));
    used.add(builtin.id);
  }

  for (const [id, override] of Object.entries(overrides)) {
    if (used.has(id) || isInternalVanillaPhraseMapping(id)) {
      continue;
    }
    result.push(normalizePhraseMapping(id, { ...override, source: "custom" }));
  }

  return result.sort(comparePhraseMappings);
}

export function phraseMappingsWithInternalVanilla(mappings: readonly PhraseMapping[]): PhraseMapping[] {
  return [...mappings, ...INTERNAL_VANILLA_PHRASE_MAPPINGS].sort(comparePhraseMappings);
}

export function normalizePhraseMappingOverrides(value: unknown): Record<string, PhraseMappingOverride> {
  const raw = phraseMappingRecordFromUnknown(value);
  const result: Record<string, PhraseMappingOverride> = {};
  for (const [id, override] of Object.entries(raw)) {
    if (!id.trim() || isInternalVanillaPhraseMapping(id)) {
      continue;
    }
    const normalized = normalizePhraseMappingOverride(override);
    if (normalized) {
      result[id] = normalized;
    }
  }
  return result;
}

export function phraseMappingOverrideFromMapping(mapping: PhraseMapping): PhraseMappingOverride {
  return {
    enabled: mapping.enabled,
    source: mapping.source,
    en_us: [...mapping.en_us],
    zh_cn: [...mapping.zh_cn],
    zh_tw: [...mapping.zh_tw],
    zh_hk: [...mapping.zh_hk],
    ...(mapping.note ? { note: mapping.note } : {}),
  };
}

export function phraseDictionaryForConversion(
  mappings: readonly PhraseMapping[],
  from: TargetLocale,
  to: TargetLocale,
): string[][] {
  const cacheKey = `${from}->${to}`;
  const cached = phraseDictionaryCache.get(mappings)?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pairs = new Map<string, string>();
  for (const mapping of mappings) {
    if (!mapping.enabled) {
      continue;
    }
    const toValue = preferredPhraseTerm(mapping[to]);
    if (!toValue) {
      continue;
    }
    for (const fromValue of mapping[from]) {
      const sourceValue = fromValue.trim();
      if (!sourceValue || sourceValue === toValue || pairs.has(sourceValue)) {
        continue;
      }
      pairs.set(sourceValue, toValue);
    }
  }
  const dictionary = [...pairs.entries()].sort((first, second) => second[0].length - first[0].length || first[0].localeCompare(second[0]));
  let mappingCache = phraseDictionaryCache.get(mappings);
  if (!mappingCache) {
    mappingCache = new Map<string, string[][]>();
    phraseDictionaryCache.set(mappings, mappingCache);
  }
  mappingCache.set(cacheKey, dictionary);
  return dictionary;
}

export function selectPhraseGlossary(
  entries: readonly PhraseMatchEntry[],
  mappings: readonly PhraseMapping[],
): PhraseGlossaryEntry[] {
  const selected = new Map<string, PhraseGlossaryEntry>();
  for (const mapping of mappings) {
    if (!mapping.enabled || mapping.en_us.length === 0) {
      continue;
    }
    if (!entries.some((entry) => phraseMappingMatches(entry, mapping))) {
      continue;
    }
    selected.set(mapping.id, {
      id: mapping.id,
      en_us: [...mapping.en_us],
      zh_cn: [...mapping.zh_cn],
      zh_tw: [...mapping.zh_tw],
      zh_hk: [...mapping.zh_hk],
      ...(mapping.note ? { note: mapping.note } : {}),
    });
  }
  return [...selected.values()].sort((first, second) => first.id.localeCompare(second.id));
}

export function selectPhraseMappingsForReference(
  reference: PhraseReferenceEntry,
  mappings: readonly PhraseMapping[],
  limit = 12,
): PhraseMapping[] {
  const matches = mappings.filter((mapping) => mapping.enabled && phraseMappingMatchesReference(reference, mapping));
  return matches
    .sort((first, second) => sourceRank(first.source) - sourceRank(second.source) || secondLongestTerm(second) - secondLongestTerm(first) || first.id.localeCompare(second.id))
    .slice(0, limit);
}

export function splitPhraseTerms(value: string): string[] {
  return uniqueStrings(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function joinPhraseTerms(terms: readonly string[]): string {
  return terms.join(", ");
}

export function isBuiltinPhraseMapping(id: string): boolean {
  return builtinById.has(id);
}

export function isInternalVanillaPhraseMapping(id: string): boolean {
  return id.startsWith("vanilla.full.") || internalVanillaMappingIds.has(id);
}

function buildInternalVanillaPhraseMappings(): PhraseMapping[] {
  return Object.entries(VANILLA_LOCALES.en_us)
    .filter(([key, value]) => typeof value === "string" && value.trim() && !key.startsWith("advancements."))
    .filter(([key]) => TARGET_LOCALES.every((locale) => typeof VANILLA_LOCALES[locale][key] === "string"))
    .map(([key, value]) => ({
      id: key,
      enabled: true,
      source: "vanilla" as const,
      en_us: [value],
      zh_cn: [VANILLA_LOCALES.zh_cn[key]],
      zh_tw: [VANILLA_LOCALES.zh_tw[key]],
      zh_hk: [VANILLA_LOCALES.zh_hk[key]],
      note: "Internal vanilla locale value.",
    }))
    .sort(comparePhraseMappings);
}

function phraseMappingRecordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((item): item is PhraseMapping => Boolean(item && typeof item === "object" && "id" in item))
        .map((item) => [String(item.id), item]),
    );
  }
  const maybePhraseFile = value as { phraseMappings?: unknown };
  if (maybePhraseFile.phraseMappings && typeof maybePhraseFile.phraseMappings === "object") {
    return phraseMappingRecordFromUnknown(maybePhraseFile.phraseMappings);
  }
  return value as Record<string, unknown>;
}

function normalizePhraseMappingOverride(value: unknown): PhraseMappingOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as PhraseMappingOverride;
  const output: PhraseMappingOverride = {};
  if (typeof input.enabled === "boolean") {
    output.enabled = input.enabled;
  }
  if (input.source === "vanilla" || input.source === "curated" || input.source === "custom") {
    output.source = input.source;
  }
  if (Array.isArray(input.en_us)) {
    output.en_us = uniqueStrings(input.en_us.map((term) => String(term).trim()).filter(Boolean));
  }
  for (const locale of TARGET_LOCALES) {
    if (Array.isArray(input[locale])) {
      output[locale] = uniqueStrings(input[locale].map((term) => String(term).trim()).filter(Boolean)) as never;
    }
  }
  if (typeof input.note === "string" && input.note.trim()) {
    output.note = input.note;
  }
  return output;
}

function normalizePhraseMapping(id: string, input: PhraseMappingOverride, fallback?: PhraseMapping): PhraseMapping {
  return {
    id,
    enabled: typeof input.enabled === "boolean" ? input.enabled : (fallback?.enabled ?? true),
    source: input.source ?? fallback?.source ?? "custom",
    en_us: uniqueStrings(input.en_us ?? fallback?.en_us ?? []),
    zh_cn: uniqueStrings(input.zh_cn ?? fallback?.zh_cn ?? []),
    zh_tw: uniqueStrings(input.zh_tw ?? fallback?.zh_tw ?? []),
    zh_hk: uniqueStrings(input.zh_hk ?? fallback?.zh_hk ?? []),
    ...(input.note ?? fallback?.note ? { note: input.note ?? fallback?.note } : {}),
  };
}

function normalizeBuiltinPhraseMapping(value: unknown): PhraseMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Built-in Phrase Mapping must be an object.");
  }
  const input = value as Partial<PhraseMapping>;
  if (!input.id || typeof input.id !== "string") {
    throw new Error("Built-in Phrase Mapping is missing an id.");
  }
  return normalizePhraseMapping(input.id, {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    source: input.source === "vanilla" || input.source === "curated" ? input.source : "curated",
    en_us: Array.isArray(input.en_us) ? input.en_us : [],
    zh_cn: Array.isArray(input.zh_cn) ? input.zh_cn : [],
    zh_tw: Array.isArray(input.zh_tw) ? input.zh_tw : [],
    zh_hk: Array.isArray(input.zh_hk) ? input.zh_hk : [],
    ...(typeof input.note === "string" && input.note ? { note: input.note } : {}),
  });
}

function phraseMappingMatches(entry: PhraseMatchEntry, mapping: PhraseMapping): boolean {
  return phraseMappingMatchesValue(entry.english, mapping);
}

function phraseMappingMatchesReference(reference: PhraseReferenceEntry, mapping: PhraseMapping): boolean {
  return phraseMappingMatchesValue(reference.value, mapping);
}

function phraseMappingMatchesValue(value: string, mapping: PhraseMapping): boolean {
  const haystack = normalizeMatchText(value);
  return allPhraseTerms(mapping).some((term) => matchNormalizedPhrase(haystack, term));
}

function allPhraseTerms(mapping: PhraseMapping): string[] {
  return [...mapping.en_us, ...mapping.zh_cn, ...mapping.zh_tw, ...mapping.zh_hk];
}

function secondLongestTerm(mapping: PhraseMapping): number {
  return allPhraseTerms(mapping).reduce((longest, term) => Math.max(longest, term.length), 0);
}

function preferredPhraseTerm(terms: readonly string[]): string {
  return terms[0]?.trim() ?? "";
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchNormalizedPhrase(normalizedHaystack: string, term: string): boolean {
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) {
    return false;
  }
  if (usesSeparatedWords(normalizedTerm)) {
    return ` ${normalizedHaystack} `.includes(` ${normalizedTerm} `);
  }
  return normalizedHaystack.includes(normalizedTerm);
}

function usesSeparatedWords(value: string): boolean {
  return /^[a-z0-9]+(?: [a-z0-9]+)*$/.test(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function comparePhraseMappings(first: PhraseMapping, second: PhraseMapping): number {
  const sourceOrder = sourceRank(first.source) - sourceRank(second.source);
  return sourceOrder || first.id.localeCompare(second.id);
}

function sourceRank(source: PhraseMapping["source"]): number {
  switch (source) {
    case "custom":
      return 0;
    case "curated":
      return 1;
    case "vanilla":
      return 2;
  }
}
