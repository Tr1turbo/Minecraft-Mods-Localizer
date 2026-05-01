export const TARGET_LOCALES = ["zh_cn", "zh_tw", "zh_hk"] as const;

export type TargetLocale = (typeof TARGET_LOCALES)[number];
export type LocaleFallbacks = Record<TargetLocale, string[]>;

export const DEFAULT_LOCALE_FALLBACKS: LocaleFallbacks = {
  zh_cn: ["zh_hk", "zh_tw", "en_us"],
  zh_tw: ["zh_hk", "zh_cn", "en_us"],
  zh_hk: ["zh_tw", "zh_cn", "en_us"],
};

export type SourceKind = "jar" | "resourcePack" | "llm" | "manual" | "converted" | "fallback" | "missing";
export type ConvertSourceKind = "manual" | "llm" | "resourcePack" | "jar";
export type ConvertSourceSettings = Record<ConvertSourceKind, boolean>;
export type ExportSkipSourceSettings = Record<SourceKind, boolean>;

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
export type PhraseMappingSource = "vanilla" | "curated" | "custom";

export interface LangpackProjectPatch {
  schemaVersion: 1;
  locales: ["zh_cn", "zh_tw", "zh_hk"];
  modFingerprints: FileFingerprint[];
  sourcePackOrder: FileFingerprint[];
  llmCandidates: Record<EntryId, PatchValue[]>;
  patches: Record<EntryId, PatchValue>;
  phraseMappings: Record<string, PhraseMappingOverride>;
}

export interface PatchValue {
  value: string;
  parentSource: SourceKind;
  parentHash: string;
  updatedAt: string;
  meta?: {
    generatedBy?: "llm" | "manual" | "converted";
    convertedFromLocale?: TargetLocale;
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

export interface PhraseMapping {
  id: string;
  enabled: boolean;
  source: PhraseMappingSource;
  en_us: string[];
  zh_cn: string[];
  zh_tw: string[];
  zh_hk: string[];
  note?: string;
}

export type PhraseMappingOverride = Partial<Omit<PhraseMapping, "id">> & {
  id?: string;
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
}

export interface ResolvedEntry {
  id: EntryId;
  namespace: string;
  locale: TargetLocale;
  key: string;
  english: string;
  hasEnglish: boolean;
  base: CandidateValue;
  patch?: PatchValue;
  final: CandidateValue;
}

export interface CatalogRow {
  namespace: string;
  key: string;
  english: string;
  hasEnglish: boolean;
  entries: Record<TargetLocale, ResolvedEntry>;
}
