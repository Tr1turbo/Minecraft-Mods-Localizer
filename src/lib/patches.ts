import { convertChineseLocale } from "./convert";
import { makeEntryId } from "./entryId";
import { sha256Text } from "./hash";
import { DEFAULT_TARGET_LOCALE, effectiveTargetLocales, isChineseLocale, normalizeLocaleCode, uniqueLocaleCodes } from "./locales";
import { normalizeGlossaryOverrides } from "./glossary";
import { compareNamespaceNames, VANILLA_NAMESPACE, VANILLA_TRANSLATIONS } from "./vanilla";
import type {
  CandidateValue,
  CatalogRow,
  ConvertSourceSettings,
  EntryId,
  GlossaryEntry,
  LangpackProjectPatch,
  LocaleCode,
  LocaleFallbacks,
  LlmReferenceMode,
  LlmReferenceValue,
  PatchValue,
  ReferenceValue,
  ResolvedEntry,
  SourceKind,
  SourcePackScanResult,
  TranslationMap,
} from "./types";
import { DEFAULT_CHINESE_LOCALE_FALLBACKS, DEFAULT_CONVERT_SOURCE_SETTINGS } from "./types";

type LocaleCandidate = CandidateValue & { locale: LocaleCode };
const DEFAULT_FALLBACK_LOCALE = DEFAULT_TARGET_LOCALE;

export function createEmptyProjectPatch(): LangpackProjectPatch {
  return {
    schemaVersion: 3,
    locales: [],
    fallbackChains: {},
    sourceLocalePriority: [],
    modFingerprints: [],
    sourcePackOrder: [],
    llmCandidates: {},
    patches: {},
    glossary: {},
  };
}

export function normalizeProjectPatch(raw: unknown): LangpackProjectPatch {
  if (!raw || typeof raw !== "object") {
    throw new Error("Project patch must be a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  if (input.schemaVersion === 1 || input.schemaVersion === 2) {
    const legacyLocales = uniqueLocaleCodes(Array.isArray(input.locales) ? input.locales : Object.keys(DEFAULT_CHINESE_LOCALE_FALLBACKS));
    return {
      schemaVersion: 3,
      locales: legacyLocales,
      fallbackChains: normalizeFallbackChains(input.fallbackChains, legacyLocales, DEFAULT_CHINESE_LOCALE_FALLBACKS),
      sourceLocalePriority: uniqueLocaleCodes(Array.isArray(input.sourceLocalePriority) ? input.sourceLocalePriority : []),
      modFingerprints: Array.isArray(input.modFingerprints) ? input.modFingerprints : [],
      sourcePackOrder: Array.isArray(input.sourcePackOrder) ? input.sourcePackOrder : [],
      llmCandidates: validPatchArrayRecord(input.llmCandidates),
      patches: validPatchRecord(input.patches),
      glossary: normalizeGlossaryOverrides(input.glossary ?? input.phraseMappings),
    };
  }
  if (input.schemaVersion !== 3) {
    throw new Error("Unsupported project patch schema version.");
  }
  const locales = uniqueLocaleCodes(Array.isArray(input.locales) ? input.locales : []);
  return {
    schemaVersion: 3,
    locales,
    fallbackChains: normalizeFallbackChains(input.fallbackChains, locales),
    sourceLocalePriority: uniqueLocaleCodes(Array.isArray(input.sourceLocalePriority) ? input.sourceLocalePriority : []),
    modFingerprints: Array.isArray(input.modFingerprints) ? input.modFingerprints : [],
    sourcePackOrder: Array.isArray(input.sourcePackOrder) ? input.sourcePackOrder : [],
    llmCandidates: validPatchArrayRecord(input.llmCandidates),
    patches: validPatchRecord(input.patches),
    glossary: normalizeGlossaryOverrides(input.glossary ?? input.phraseMappings),
  };
}

export function buildCatalog(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
  fallbackChains: LocaleFallbacks = project.fallbackChains ?? {},
  glossary: readonly GlossaryEntry[] = [],
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
  locales: readonly LocaleCode[] = project.locales ?? [],
): CatalogRow[] {
  const targetLocales = effectiveTargetLocales(locales);

  const rows: CatalogRow[] = [];
  const namespaces = collectCatalogNamespaces(modTranslations);

  for (const namespace of namespaces) {
    const keys = collectNamespaceKeys(modTranslations, sourcePacks, namespace);
    for (const key of keys) {
      const entries = Object.fromEntries(
        targetLocales.map((locale) => {
          const resolved = resolveEntry(
            modTranslations,
            sourcePacks,
            project,
            namespace,
            locale,
            key,
            fallbackChains,
            glossary,
            convertSources,
          );
          return [locale, resolved];
        }),
      ) as CatalogRow["entries"];
      const firstEntry = entries[targetLocales[0]];
      rows.push({
        namespace,
        key,
        sourceLocale: firstEntry?.sourceLocale ?? "",
        sourceValue: firstEntry?.sourceValue ?? key,
        hasSource: firstEntry?.hasSource ?? false,
        entries,
      });
    }
  }

  return rows;
}

export function resolveEntry(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
  namespace: string,
  locale: LocaleCode,
  key: string,
  fallbackChains: LocaleFallbacks = project.fallbackChains ?? {},
  glossary: readonly GlossaryEntry[] = [],
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
): ResolvedEntry {
  const targetLocale = normalizeLocaleCode(locale);
  const id = makeEntryId(namespace, targetLocale, key);
  const source = resolveSourceValue(modTranslations, sourcePacks, namespace, targetLocale, key, fallbackChains, project, convertSources);
  const base = resolveBaseValue(
    modTranslations,
    sourcePacks,
    namespace,
    targetLocale,
    key,
    fallbackChains,
    glossary,
    project,
    convertSources,
  );
  const patch = project.patches?.[id];

  let final: CandidateValue = base;
  if (patch) {
    const generatedBy = patch.meta?.generatedBy;
    final = {
      source: patchSourceFromMeta(patch),
      value: patch.value,
      locale: targetLocale,
      sourceLabel:
        generatedBy === "llm" || Boolean(patch.meta?.model)
          ? (patch.meta?.model ?? "LLM")
          : generatedBy === "converted"
            ? `Converted${patch.meta?.convertedFromLocale ? ` from ${patch.meta.convertedFromLocale}` : ""}`
            : "Manual edit",
    };
  }

  return {
    id,
    namespace,
    locale: targetLocale,
    key,
    sourceLocale: source.locale ?? "",
    sourceValue: source.value,
    hasSource: source.source !== "missing",
    base,
    patch,
    final,
  };
}

export function resolveBaseValue(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  namespace: string,
  locale: LocaleCode,
  key: string,
  fallbackChains: LocaleFallbacks = {},
  glossary: readonly GlossaryEntry[] = [],
  project: LangpackProjectPatch | undefined = undefined,
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
): CandidateValue {
  const targetLocale = normalizeLocaleCode(locale);
  for (const pack of sourcePacks) {
    const value = pack.translations[namespace]?.[targetLocale]?.[key];
    if (value !== undefined) {
      return { source: "resourcePack", value, locale: targetLocale, sourceLabel: pack.fingerprint.name };
    }
  }

  const jarLocaleValue = modTranslations[namespace]?.[targetLocale]?.[key];
  if (jarLocaleValue !== undefined) {
    return { source: "jar", value: jarLocaleValue, locale: targetLocale, sourceLabel: "Mod jar locale" };
  }

  const vanillaLocaleValue = vanillaValue(namespace, targetLocale, key);
  if (vanillaLocaleValue !== undefined) {
    return { source: "vanilla", value: vanillaLocaleValue, locale: targetLocale, sourceLabel: "Vanilla locale" };
  }

  for (const fallbackLocale of fallbackCandidateLocales(targetLocale, fallbackChains)) {
    const candidate = resolveLocaleCandidate(modTranslations, sourcePacks, project, namespace, fallbackLocale, key, convertSources);
    if (candidate) {
      return fallbackCandidateValue(candidate, targetLocale, glossary);
    }
  }

  return {
    source: "missing",
    value: key,
    locale: "",
    sourceLabel: "missing source",
  };
}

export function resolveSourceValue(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  namespace: string,
  locale: LocaleCode,
  key: string,
  fallbackChains: LocaleFallbacks = {},
  project: LangpackProjectPatch | undefined = undefined,
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
): CandidateValue {
  const targetLocale = normalizeLocaleCode(locale);
  const sourceLocales = fallbackCandidateLocales(targetLocale, fallbackChains);
  if (sourceLocales.length === 0) {
    sourceLocales.push(targetLocale);
  }
  for (const sourceLocale of sourceLocales) {
    const candidate = resolveLocaleCandidate(modTranslations, sourcePacks, project, namespace, sourceLocale, key, convertSources);
    if (candidate) {
      return candidate;
    }
  }
  return {
    source: "missing",
    value: key,
    locale: "",
    sourceLabel: "missing source",
  };
}

export function resolveLlmReferenceValues(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  targetLocale: LocaleCode,
  key: string,
  fallbackChains: LocaleFallbacks = {},
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
  mode: LlmReferenceMode = "en_us",
): LlmReferenceValue[] {
  const normalizedTarget = normalizeLocaleCode(targetLocale);
  const fallbackLocales = fallbackCandidateLocales(normalizedTarget, fallbackChains);
  const enUsReference = referenceFromCandidate(resolveLocaleCandidate(modTranslations, sourcePacks, project, namespace, DEFAULT_FALLBACK_LOCALE, key, convertSources));
  const fallbackReference = firstReferenceForLocales(modTranslations, sourcePacks, project, namespace, key, fallbackLocales, convertSources);
  const allReferences = resolveReferenceValuesForKey(modTranslations, sourcePacks, project, namespace, key, convertSources, [DEFAULT_FALLBACK_LOCALE, ...fallbackLocales]).filter(
    (reference) => reference.locale !== normalizedTarget,
  );

  if (mode === "all") {
    return allReferences;
  }
  if (mode === "fallback") {
    return fallbackReference ? [fallbackReference] : allReferences;
  }
  return enUsReference ? [enUsReference] : fallbackReference ? [fallbackReference] : allReferences;
}

export function resolveReferenceValuesForKey(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  key: string,
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
  priorityLocales: readonly LocaleCode[] = [],
): ReferenceValue[] {
  return referencesForLocales(
    modTranslations,
    sourcePacks,
    project,
    namespace,
    key,
    uniqueLocaleCodes([...priorityLocales, ...collectLocalesWithKey(modTranslations, sourcePacks, project, namespace, key).sort((left, right) => left.localeCompare(right))]),
    convertSources,
  );
}

function fallbackCandidateLocales(targetLocale: LocaleCode, fallbackChains: LocaleFallbacks): LocaleCode[] {
  return normalizeFallbackChain(targetLocale, fallbackChains[targetLocale] ?? []);
}

function resolveLocaleCandidate(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  locale: LocaleCode,
  key: string,
  convertSources: ConvertSourceSettings,
): LocaleCandidate | undefined {
  const id = makeEntryId(namespace, locale, key);
  const patch = project?.patches?.[id];
  const patchSource = patch ? patchSourceFromMeta(patch) : undefined;

  if (convertSources.manual && patch && patchSource === "manual") {
    return { source: "manual", value: patch.value, locale, sourceLabel: `${locale} manual` };
  }

  if (convertSources.llm && patch && patchSource === "llm") {
    return { source: "llm", value: patch.value, locale, sourceLabel: `${locale} LLM` };
  }

  if (convertSources.resourcePack) {
    for (const pack of sourcePacks) {
      const value = pack.translations[namespace]?.[locale]?.[key];
      if (value !== undefined) {
        return { source: "resourcePack", value, locale, sourceLabel: `${locale} in ${pack.fingerprint.name}` };
      }
    }
  }

  if (convertSources.jar) {
    const value = modTranslations[namespace]?.[locale]?.[key];
    if (value !== undefined) {
      return { source: "jar", value, locale, sourceLabel: `${locale} jar` };
    }
  }

  if (convertSources.vanilla) {
    const value = vanillaValue(namespace, locale, key);
    if (value !== undefined) {
      return { source: "vanilla", value, locale, sourceLabel: `${locale} vanilla` };
    }
  }

  return undefined;
}

function firstReferenceForLocales(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  key: string,
  locales: readonly LocaleCode[],
  convertSources: ConvertSourceSettings,
): ReferenceValue | undefined {
  for (const locale of locales) {
    const reference = referenceFromCandidate(resolveLocaleCandidate(modTranslations, sourcePacks, project, namespace, locale, key, convertSources));
    if (reference) {
      return reference;
    }
  }
  return undefined;
}

function referencesForLocales(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  key: string,
  locales: readonly LocaleCode[],
  convertSources: ConvertSourceSettings,
): ReferenceValue[] {
  const references: ReferenceValue[] = [];
  for (const locale of locales) {
    const reference = referenceFromCandidate(resolveLocaleCandidate(modTranslations, sourcePacks, project, namespace, locale, key, convertSources));
    if (reference) {
      references.push(reference);
    }
  }
  return references;
}

function referenceFromCandidate(candidate: LocaleCandidate | undefined): ReferenceValue | undefined {
  if (!candidate) {
    return undefined;
  }
  return {
    locale: candidate.locale,
    source: candidate.source,
    sourceLabel: candidate.sourceLabel,
    value: candidate.value,
  };
}

function fallbackCandidateValue(candidate: LocaleCandidate, targetLocale: LocaleCode, glossary: readonly GlossaryEntry[]): CandidateValue {
  if (isChineseLocale(candidate.locale) && isChineseLocale(targetLocale)) {
    return {
      source: "converted",
      value: convertChineseLocale(candidate.value, candidate.locale, targetLocale, glossary),
      locale: candidate.locale,
      sourceLabel: `Converted from ${candidate.sourceLabel}`,
    };
  }
  return {
    source: "fallback",
    value: candidate.value,
    locale: candidate.locale,
    sourceLabel: `${candidate.sourceLabel} fallback`,
  };
}

export async function createPatchValue(
  value: string,
  parent: CandidateValue,
  meta?: PatchValue["meta"],
): Promise<PatchValue> {
  return {
    value,
    parentSource: parent.source,
    parentHash: await sha256Text(parent.value),
    updatedAt: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  };
}

export function revertManualKey(project: LangpackProjectPatch, id: EntryId): LangpackProjectPatch {
  const patches = { ...(project.patches ?? {}) };
  delete patches[id];
  return { ...project, patches };
}

export function revertManualNamespace(project: LangpackProjectPatch, namespace: string): LangpackProjectPatch {
  const patches = { ...(project.patches ?? {}) };
  for (const id of Object.keys(patches) as EntryId[]) {
    if (id.startsWith(`${namespace}/`)) {
      delete patches[id];
    }
  }
  return { ...project, patches };
}

export function patchSourceLabel(source: SourceKind): string {
  switch (source) {
    case "resourcePack":
      return "Resource pack";
    case "vanilla":
      return "Vanilla";
    case "llm":
      return "LLM";
    case "manual":
      return "Manual";
    case "converted":
      return "Converted";
    case "fallback":
      return "Fallback";
    case "missing":
      return "Missing";
    case "jar":
      return "Jar";
  }
}

function patchSourceFromMeta(patch: PatchValue): SourceKind {
  if (patch.meta?.generatedBy === "llm" || patch.meta?.model) {
    return "llm";
  }
  if (patch.meta?.generatedBy === "converted") {
    return "converted";
  }
  return "manual";
}

function collectNamespaceKeys(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  namespace: string,
): string[] {
  const keys = new Set<string>();
  for (const namespaceLocales of [
    modTranslations[namespace],
    vanillaNamespaceTranslations(namespace),
    ...sourcePacks.map((pack) => pack.translations[namespace]),
  ]) {
    for (const localeData of Object.values(namespaceLocales ?? {})) {
      for (const key of Object.keys(localeData ?? {})) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

function collectLocalesWithKey(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch | undefined,
  namespace: string,
  key: string,
): string[] {
  const locales = new Set<string>();
  for (const [locale, data] of Object.entries(modTranslations[namespace] ?? {})) {
    if (data[key] !== undefined) {
      locales.add(locale);
    }
  }
  for (const pack of sourcePacks) {
    for (const [locale, data] of Object.entries(pack.translations[namespace] ?? {})) {
      if (data[key] !== undefined) {
        locales.add(locale);
      }
    }
  }
  const vanillaLocales = vanillaNamespaceTranslations(namespace);
  for (const [locale, data] of Object.entries(vanillaLocales ?? {})) {
    if (data[key] !== undefined) {
      locales.add(locale);
    }
  }
  for (const id of Object.keys(project?.patches ?? {})) {
    const prefix = `${namespace}/`;
    if (!id.startsWith(prefix)) {
      continue;
    }
    const rest = id.slice(prefix.length);
    const separatorIndex = rest.indexOf("/");
    if (separatorIndex < 0) {
      continue;
    }
    const locale = rest.slice(0, separatorIndex);
    const patchKey = rest.slice(separatorIndex + 1);
    if (patchKey === key) {
      locales.add(locale);
    }
  }
  return [...locales];
}

function collectCatalogNamespaces(modTranslations: TranslationMap): string[] {
  return uniqueStrings([...Object.keys(modTranslations), VANILLA_NAMESPACE]).sort(compareNamespaceNames);
}

function vanillaNamespaceTranslations(namespace: string): TranslationMap[string] | undefined {
  return namespace === VANILLA_NAMESPACE ? VANILLA_TRANSLATIONS[VANILLA_NAMESPACE] : undefined;
}

function vanillaValue(namespace: string, locale: LocaleCode, key: string): string | undefined {
  return vanillaNamespaceTranslations(namespace)?.[locale]?.[key];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeFallbackChains(raw: unknown, locales: readonly LocaleCode[], legacyFallbacks: LocaleFallbacks = {}): LocaleFallbacks {
  const fallbackInput = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: LocaleFallbacks = {};
  for (const locale of locales) {
    const defaultChain = isChineseLocale(locale) ? DEFAULT_CHINESE_LOCALE_FALLBACKS[locale] : [];
    const rawChain = Array.isArray(fallbackInput[locale])
      ? fallbackInput[locale]
      : Array.isArray(legacyFallbacks[locale])
        ? legacyFallbacks[locale]
        : defaultChain;
    result[locale] = normalizeFallbackChain(locale, rawChain);
  }
  return result;
}

function normalizeFallbackChain(locale: LocaleCode, chain: readonly unknown[]): string[] {
  return uniqueLocaleCodes([...chain, DEFAULT_FALLBACK_LOCALE]).filter((fallbackLocale) => fallbackLocale !== locale);
}

function validPatchRecord(value: unknown): Record<EntryId, PatchValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<EntryId, PatchValue> = {};
  for (const [key, patch] of Object.entries(value)) {
    const normalized = normalizePatchValue(patch);
    if (!normalized) {
      continue;
    }
    result[key as EntryId] = normalized;
  }
  return result;
}

function validPatchArrayRecord(value: unknown): Record<EntryId, PatchValue[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<EntryId, PatchValue[]> = {};
  for (const [key, patches] of Object.entries(value)) {
    if (!Array.isArray(patches)) {
      continue;
    }
    const validPatches = patches.map(normalizePatchValue).filter((patch): patch is PatchValue => Boolean(patch));
    if (validPatches.length) {
      result[key as EntryId] = validPatches;
    }
  }
  return result;
}

function normalizePatchValue(value: unknown): PatchValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const maybePatch = value as PatchValue;
  if (typeof maybePatch.value !== "string") {
    return undefined;
  }
  return {
    value: maybePatch.value,
    parentSource: maybePatch.parentSource,
    parentHash: String(maybePatch.parentHash ?? ""),
    updatedAt: String(maybePatch.updatedAt ?? ""),
    ...(maybePatch.meta ? { meta: maybePatch.meta } : {}),
  };
}
