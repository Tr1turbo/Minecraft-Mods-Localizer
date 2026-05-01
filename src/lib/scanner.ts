import JSZip from "jszip";

import { fingerprintFile } from "./hash";
import type {
  FileFingerprint,
  LocaleCode,
  ModScanResult,
  ScanWarning,
  SourcePackScanResult,
  TranslationMap,
} from "./types";

const LANG_PATH_RE = /^assets\/([^/]+)\/lang\/([^/]+)\.json$/i;
const JAR_IN_JAR_RE = /^META-INF\/jarjar\/.+\.jar$/i;

type MergeMode = "keepFirst" | "replace";

export async function scanModJars(files: File[], locales?: readonly LocaleCode[]): Promise<ModScanResult> {
  const translations: TranslationMap = {};
  const warnings: ScanWarning[] = [];
  const fingerprints: FileFingerprint[] = [];
  const wantedLocales = locales ? new Set<string>(locales.map((locale) => locale.trim().toLowerCase()).filter(Boolean)) : undefined;

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    fingerprints.push(await fingerprintFile(file, buffer));
    await scanZipBuffer(buffer, file.name, wantedLocales, translations, warnings, "keepFirst", true);
  }

  return { fingerprints, translations, warnings };
}

export async function scanResourcePack(file: File, locales?: readonly LocaleCode[]): Promise<SourcePackScanResult> {
  const translations: TranslationMap = {};
  const warnings: ScanWarning[] = [];
  const wantedLocales = locales ? new Set<string>(locales.map((locale) => locale.trim().toLowerCase()).filter(Boolean)) : undefined;
  const buffer = await file.arrayBuffer();
  const fingerprint = await fingerprintFile(file, buffer);

  await scanZipBuffer(buffer, file.name, wantedLocales, translations, warnings, "replace", false);
  return { fingerprint, translations, warnings };
}

async function scanZipBuffer(
  buffer: ArrayBuffer | Uint8Array,
  label: string,
  wantedLocales: Set<string> | undefined,
  translations: TranslationMap,
  warnings: ScanWarning[],
  mergeMode: MergeMode,
  scanNestedJars: boolean,
): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    warnings.push({ file: label, message: `Invalid zip/jar: ${errorMessage(error)}` });
    return;
  }

  const entries = Object.values(zip.files).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.dir) {
      continue;
    }

    if (scanNestedJars && JAR_IN_JAR_RE.test(entry.name)) {
      const nested = await entry.async("uint8array");
      await scanZipBuffer(nested, `${label}!${entry.name}`, wantedLocales, translations, warnings, mergeMode, false);
      continue;
    }

    const match = LANG_PATH_RE.exec(entry.name);
    if (!match) {
      continue;
    }

    const [, namespace, rawLocale] = match;
    const locale = rawLocale.toLowerCase();
    if (wantedLocales && !wantedLocales.has(locale)) {
      continue;
    }

    try {
      const payload = await entry.async("uint8array");
      const data = parseLangJson(payload, `${label}!${entry.name}`);
      mergeLocale(translations, namespace, locale, data, mergeMode);
    } catch (error) {
      warnings.push({ file: label, path: entry.name, message: errorMessage(error) });
    }
  }
}

function parseLangJson(payload: Uint8Array, label: string): Record<string, string> {
  const raw = new TextDecoder("utf-8").decode(payload).replace(/^\uFEFF/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${errorMessage(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}: expected a JSON object`);
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      output[key] = value;
    } else if (value != null) {
      output[key] = String(value);
    }
  }
  return output;
}

function mergeLocale(
  translations: TranslationMap,
  namespace: string,
  locale: string,
  data: Record<string, string>,
  mode: MergeMode,
): void {
  const localeMap = (translations[namespace] ??= {})[locale] ?? {};
  for (const [key, value] of Object.entries(data)) {
    if (mode === "replace" || !(key in localeMap)) {
      localeMap[key] = value;
    }
  }
  translations[namespace][locale] = localeMap;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
