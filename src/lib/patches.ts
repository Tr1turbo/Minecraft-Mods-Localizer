import { convertChineseLocale } from "./convert";
import { makeEntryId } from "./entryId";
import { sha256Text } from "./hash";
import { normalizePhraseMappingOverrides } from "./phraseMappings";
import type {
  CandidateValue,
  ConvertSourceSettings,
  CatalogRow,
  EntryId,
  LangpackProjectPatch,
  LocaleFallbacks,
  PatchValue,
  PhraseMapping,
  ResolvedEntry,
  SourceKind,
  SourcePackScanResult,
  TargetLocale,
  TranslationMap,
} from "./types";
import { DEFAULT_CONVERT_SOURCE_SETTINGS, DEFAULT_LOCALE_FALLBACKS, TARGET_LOCALES } from "./types";

export function createEmptyProjectPatch(): LangpackProjectPatch {
  return {
    schemaVersion: 1,
    locales: ["zh_cn", "zh_tw", "zh_hk"],
    modFingerprints: [],
    sourcePackOrder: [],
    llmCandidates: {},
    patches: {},
    phraseMappings: {},
  };
}

export function normalizeProjectPatch(raw: unknown): LangpackProjectPatch {
  if (!raw || typeof raw !== "object") {
    throw new Error("Project patch must be a JSON object.");
  }
  const input = raw as Partial<LangpackProjectPatch>;
  if (input.schemaVersion !== 1) {
    throw new Error("Unsupported project patch schema version.");
  }
  return {
    schemaVersion: 1,
    locales: ["zh_cn", "zh_tw", "zh_hk"],
    modFingerprints: Array.isArray(input.modFingerprints) ? input.modFingerprints : [],
    sourcePackOrder: Array.isArray(input.sourcePackOrder) ? input.sourcePackOrder : [],
    llmCandidates: validPatchArrayRecord(input.llmCandidates),
    patches: validPatchRecord(input.patches),
    phraseMappings: normalizePhraseMappingOverrides(input.phraseMappings),
  };
}

export function buildCatalog(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
  fallbackChains: LocaleFallbacks = DEFAULT_LOCALE_FALLBACKS,
  phraseMappings: readonly PhraseMapping[] = [],
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
  locales: readonly TargetLocale[] = TARGET_LOCALES,
): CatalogRow[] {
  const rows: CatalogRow[] = [];
  const namespaces = Object.keys(modTranslations).sort();

  for (const namespace of namespaces) {
    const keys = collectNamespaceKeys(modTranslations, namespace, locales);
    for (const key of keys) {
      const english = englishValueOrKey(modTranslations, namespace, key);
      const entries = Object.fromEntries(
        locales.map((locale) => {
          const resolved = resolveEntry(modTranslations, sourcePacks, project, namespace, locale, key, fallbackChains, phraseMappings, convertSources);
          return [locale, resolved];
        }),
      ) as CatalogRow["entries"];
      rows.push({ namespace, key, english: english.value, hasEnglish: english.hasEnglish, entries });
    }
  }

  return rows;
}

export function resolveEntry(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
  namespace: string,
  locale: TargetLocale,
  key: string,
  fallbackChains: LocaleFallbacks = DEFAULT_LOCALE_FALLBACKS,
  phraseMappings: readonly PhraseMapping[] = [],
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
): ResolvedEntry {
  const id = makeEntryId(namespace, locale, key);
  const english = englishValueOrKey(modTranslations, namespace, key);
  const base = resolveBaseValue(modTranslations, sourcePacks, namespace, locale, key, fallbackChains, phraseMappings, project, convertSources);
  const patch = project.patches?.[id];

  let final: CandidateValue = base;
  if (patch) {
    const generatedBy = patch.meta?.generatedBy;
    final = {
      source: patchSourceFromMeta(patch),
      value: patch.value,
      sourceLabel:
        generatedBy === "llm" || Boolean(patch.meta?.model)
          ? (patch.meta?.model ?? "LLM")
          : generatedBy === "converted"
            ? `Converted${patch.meta?.convertedFromLocale ? ` from ${patch.meta.convertedFromLocale}` : ""}`
            : "Manual edit",
    };
  }

  return { id, namespace, locale, key, english: english.value, hasEnglish: english.hasEnglish, base, patch, final };
}

export function resolveBaseValue(
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  namespace: string,
  locale: TargetLocale,
  key: string,
  fallbackChains: LocaleFallbacks = DEFAULT_LOCALE_FALLBACKS,
  phraseMappings: readonly PhraseMapping[] = [],
  project: LangpackProjectPatch | undefined = undefined,
  convertSources: ConvertSourceSettings = DEFAULT_CONVERT_SOURCE_SETTINGS,
): CandidateValue {
  for (const pack of sourcePacks) {
    const value = pack.translations[namespace]?.[locale]?.[key];
    if (value !== undefined) {
      return { source: "resourcePack", value, sourceLabel: pack.fingerprint.name };
    }
  }

  const jarLocaleValue = modTranslations[namespace]?.[locale]?.[key];
  if (jarLocaleValue !== undefined) {
    return { source: "jar", value: jarLocaleValue, sourceLabel: "Mod jar locale" };
  }

  for (const fallbackLocale of normalizedFallbackChain(locale, fallbackChains)) {
    if (fallbackLocale === locale) {
      continue;
    }
    if (fallbackLocale === "en_us") {
      const englishFallback = englishFallbackValue(modTranslations, namespace, key);
      if (englishFallback) {
        return englishFallback;
      }
      continue;
    }
    if (!isTargetLocale(fallbackLocale)) {
      continue;
    }

    const patch = project?.patches?.[makeEntryId(namespace, fallbackLocale, key)];
    const patchSource = patch ? patchSourceFromMeta(patch) : undefined;

    if (convertSources.manual && patch && patchSource === "manual") {
      return convertedFallbackValue(patch.value, fallbackLocale, locale, `Converted from ${fallbackLocale} manual`, phraseMappings);
    }

    if (convertSources.llm) {
      if (patch && patchSource === "llm") {
        return convertedFallbackValue(patch.value, fallbackLocale, locale, `Converted from ${fallbackLocale} LLM`, phraseMappings);
      }
    }

    if (convertSources.resourcePack) {
      for (const pack of sourcePacks) {
        const value = pack.translations[namespace]?.[fallbackLocale]?.[key];
        if (value !== undefined) {
          return convertedFallbackValue(value, fallbackLocale, locale, `Converted from ${fallbackLocale} in ${pack.fingerprint.name}`, phraseMappings);
        }
      }
    }

    if (convertSources.jar) {
      const jarValue = modTranslations[namespace]?.[fallbackLocale]?.[key];
      if (jarValue !== undefined) {
        return convertedFallbackValue(jarValue, fallbackLocale, locale, `Converted from ${fallbackLocale} jar`, phraseMappings);
      }
    }
  }

  return {
    source: "missing",
    value: key,
    sourceLabel: "missing source",
  };
}

function englishValueOrKey(
  modTranslations: TranslationMap,
  namespace: string,
  key: string,
): { value: string; hasEnglish: boolean } {
  const englishValue = modTranslations[namespace]?.en_us?.[key];
  return englishValue !== undefined ? { value: englishValue, hasEnglish: true } : { value: key, hasEnglish: false };
}

function englishFallbackValue(modTranslations: TranslationMap, namespace: string, key: string): CandidateValue | undefined {
  const englishValue = modTranslations[namespace]?.en_us?.[key];
  if (englishValue === undefined) {
    return undefined;
  }
  return {
    source: "fallback",
    value: englishValue,
    sourceLabel: "en_us fallback",
  };
}

function normalizedFallbackChain(locale: TargetLocale, fallbackChains: LocaleFallbacks): string[] {
  const seen = new Set<string>();
  const chain = [...(fallbackChains[locale] ?? [])]
    .map((fallbackLocale) => fallbackLocale.trim().toLowerCase())
    .filter((fallbackLocale) => fallbackLocale && fallbackLocale !== locale)
    .filter((fallbackLocale) => {
      if (seen.has(fallbackLocale)) {
        return false;
      }
      seen.add(fallbackLocale);
      return true;
    });
  if (!seen.has("en_us")) {
    chain.push("en_us");
  }
  return chain;
}

function convertedFallbackValue(
  value: string,
  fallbackLocale: string,
  locale: TargetLocale,
  sourceLabel: string,
  phraseMappings: readonly PhraseMapping[],
): CandidateValue {
  if (!isTargetLocale(fallbackLocale)) {
    return {
      source: "fallback",
      value,
      sourceLabel: `${fallbackLocale} fallback`,
    };
  }
  return {
    source: "converted",
    value: convertChineseLocale(value, fallbackLocale, locale, phraseMappings),
    sourceLabel,
  };
}

function isTargetLocale(locale: string): locale is TargetLocale {
  return (TARGET_LOCALES as readonly string[]).includes(locale);
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
  namespace: string,
  locales: readonly TargetLocale[],
): string[] {
  const keys = new Set<string>();
  for (const locale of ["en_us", ...locales]) {
    for (const key of Object.keys(modTranslations[namespace]?.[locale] ?? {})) {
      keys.add(key);
    }
  }
  return [...keys].sort();
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
