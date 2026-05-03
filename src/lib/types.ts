import { CHINESE_LOCALES } from "./locales";

export type LocaleCode = string;
export type ChineseLocale = (typeof CHINESE_LOCALES)[number];
export type LocaleFallbacks = Record<LocaleCode, string[]>;

export const DEFAULT_CHINESE_LOCALE_FALLBACKS: Record<ChineseLocale, string[]> = {
  zh_tw: ["zh_hk", "zh_cn", "en_us"],
  zh_cn: ["zh_hk", "zh_tw", "en_us"],
  zh_hk: ["zh_tw", "zh_cn", "en_us"],
};

export type SourceKind = "jar" | "resourcePack" | "llm" | "manual" | "converted" | "fallback" | "missing";
export type ConvertSourceKind = "manual" | "llm" | "resourcePack" | "jar";
export type ConvertSourceSettings = Record<ConvertSourceKind, boolean>;
export type ExportSkipSourceSettings = Record<SourceKind, boolean>;
export type LlmReferenceMode = "en_us" | "fallback" | "all";

export const DEFAULT_CONVERT_SOURCE_SETTINGS: ConvertSourceSettings = {
  manual: true,
  llm: true,
  resourcePack: true,
  jar: true,
};

export const DEFAULT_EXPORT_SKIP_SOURCES: ExportSkipSourceSettings = {
  jar: true,
  resourcePack: false,
  converted: false,
  llm: false,
  manual: false,
  fallback: true,
  missing: false,
};

export type EntryId = `${string}/${string}/${string}`;
export type GlossarySource = "vanilla" | "curated" | "custom";

export interface LangpackProjectPatch {
  schemaVersion: 3;
  locales: LocaleCode[];
  fallbackChains: LocaleFallbacks;
  sourceLocalePriority: LocaleCode[];
  modFingerprints: FileFingerprint[];
  sourcePackOrder: FileFingerprint[];
  llmCandidates: Record<EntryId, PatchValue[]>;
  patches: Record<EntryId, PatchValue>;
  glossary: Record<string, GlossaryOverride>;
}

export interface PatchValue {
  value: string;
  parentSource: SourceKind;
  parentHash: string;
  updatedAt: string;
  meta?: {
    generatedBy?: "llm" | "manual" | "converted";
    convertedFromLocale?: LocaleCode;
    llmCandidateId?: string;
    model?: string;
    promptVersion?: string;
  };
}

export interface FileFingerprint {
  name: string;
  size: number;
  sha256: string;
}

export interface GlossaryEntry {
  id: string;
  enabled: boolean;
  source: GlossarySource;
  terms: Record<LocaleCode, string[]>;
  note?: string;
}

export type GlossaryOverride = Partial<Omit<GlossaryEntry, "id">> & {
  id?: string;
  en_us?: string[];
  zh_cn?: string[];
  zh_tw?: string[];
  zh_hk?: string[];
};

export type TranslationMap = Record<string, Record<string, Record<string, string>>>;

export interface ScanWarning {
  file: string;
  path?: string;
  message: string;
}

export interface ModScanResult {
  fingerprints: FileFingerprint[];
  translations: TranslationMap;
  warnings: ScanWarning[];
}

export interface SourcePackScanResult {
  fingerprint: FileFingerprint;
  translations: TranslationMap;
  warnings: ScanWarning[];
}

export interface CandidateValue {
  source: SourceKind;
  value: string;
  sourceLabel: string;
  locale?: LocaleCode;
}

export interface ReferenceValue {
  locale: LocaleCode;
  source: SourceKind;
  sourceLabel: string;
  value: string;
}

export interface LlmReferenceValue extends ReferenceValue {}

export interface ResolvedEntry {
  id: EntryId;
  namespace: string;
  locale: LocaleCode;
  key: string;
  sourceLocale: LocaleCode;
  sourceValue: string;
  hasSource: boolean;
  base: CandidateValue;
  patch?: PatchValue;
  final: CandidateValue;
}

export interface CatalogRow {
  namespace: string;
  key: string;
  sourceLocale: LocaleCode;
  sourceValue: string;
  hasSource: boolean;
  entries: Record<LocaleCode, ResolvedEntry>;
}
