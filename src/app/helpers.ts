import { createEmptyProjectPatch, normalizeProjectPatch, resolveLlmReferenceValues } from "../lib/patches";
import type { LlmJob, LlmSettings } from "../lib/llm";
import type { AppSettings, PersistedLlmSettings } from "../lib/deploymentConfig";
import { uniqueLocaleCodes, isValidLocaleCode } from "../lib/locales";
import type {
  CandidateValue,
  CatalogRow,
  EntryId,
  LangpackProjectPatch,
  LocaleCode,
  ModScanResult,
  PatchValue,
  ReferenceValue,
  ResolvedEntry,
  SourceKind,
  SourcePackScanResult,
} from "../lib/types";
import type { BrowserDraftState, DiffSegment, LlmLiveOutput, TableItem, PageId, TranslationControl, TranslationProgress } from "./types";

export function rowId(row: CatalogRow): string {
  return `${row.namespace}\u0000${row.key}`;
}

export function rowHasLocaleValue(row: CatalogRow, locale: LocaleCode, modTranslations: ModScanResult["translations"], sourcePacks: SourcePackScanResult[]): boolean {
  if (modTranslations[row.namespace]?.[locale]?.[row.key] !== undefined) {
    return true;
  }
  return sourcePacks.some((pack) => pack.translations[row.namespace]?.[locale]?.[row.key] !== undefined);
}

export function resolveVisibleReferenceValue(
  references: readonly ReferenceValue[],
  globalLocale: LocaleCode,
  fallbackLocale: LocaleCode,
): ReferenceValue | undefined {
  const referenceByLocale = new Map(references.map((reference) => [reference.locale, reference]));
  for (const locale of uniqueLocaleCodes([globalLocale, fallbackLocale, "en_us"])) {
    const reference = referenceByLocale.get(locale);
    if (reference) {
      return reference;
    }
  }
  return references[0];
}

export function llmReferenceModeLabel(mode: AppSettings["llmReferenceMode"]): string {
  switch (mode) {
    case "en_us":
      return "1. en_us only";
    case "fallback":
      return "2. fallback value";
    case "all":
      return "3. all valid values";
  }
}

export function translationJobsForRows(
  rows: CatalogRow[],
  locale: LocaleCode,
  settings: AppSettings,
  modTranslations: ModScanResult["translations"],
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
): LlmJob[] {
  if (!locale) {
    return [];
  }
  return rows
    .map((row) => row.entries[locale])
    .filter((entry): entry is ResolvedEntry => Boolean(entry && settings.translateSourceTargets[entry.final.source]))
    .map((entry) => llmJobForEntry(entry, settings, modTranslations, sourcePacks, project))
    .filter((job): job is LlmJob => Boolean(job));
}

export function llmJobForEntry(
  entry: ResolvedEntry,
  settings: AppSettings,
  modTranslations: ModScanResult["translations"],
  sourcePacks: SourcePackScanResult[],
  project: LangpackProjectPatch,
): LlmJob | undefined {
  const sourceValues = resolveLlmReferenceValues(
    modTranslations,
    sourcePacks,
    project,
    entry.namespace,
    entry.locale,
    entry.key,
    settings.fallbackChains,
    settings.convertSources,
    settings.llmReferenceMode,
  ).filter((sourceValue) => sourceValue.value.trim().length > 0);
  const primary = sourceValues[0];
  if (!primary) {
    return undefined;
  }
  return {
    namespace: entry.namespace,
    targetLocale: entry.locale,
    key: entry.key,
    sourceLocale: primary.locale,
    sourceText: primary.value,
    sourceValues,
    sourceReferenceMode: settings.llmReferenceMode,
  };
}

export function hasLlmSourceText(jobOrText: LlmJob | string): boolean {
  const text = typeof jobOrText === "string" ? jobOrText : jobOrText.sourceText;
  return text.trim().length > 0;
}

export function groupTableRows(rows: CatalogRow[]): TableItem[] {
  const keySet = new Set(rows.map((row) => row.key));
  const prefixCounts = new Map<string, number>();
  for (const row of rows) {
    for (const prefix of keyPrefixes(row.key)) {
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  const items: TableItem[] = [];
  let activePrefix = "";
  for (const row of rows) {
    const prefix = groupingPrefix(row.key, prefixCounts, keySet);

    if (!prefix) {
      activePrefix = "";
      items.push({ kind: "entry", row, displayKey: row.key });
      continue;
    }

    if (prefix !== activePrefix) {
      items.push({ kind: "divider", id: `prefix:${prefix}:${items.length}`, prefix });
      activePrefix = prefix;
    }

    items.push({ kind: "entry", row, displayKey: row.key.slice(prefix.length) || row.key });
  }

  return items;
}

function groupingPrefix(key: string, prefixCounts: Map<string, number>, keySet: Set<string>): string {
  return (
    [...keyPrefixes(key)]
      .reverse()
      .find((prefix) => (prefixCounts.get(prefix) ?? 0) > 1 && !keySet.has(prefix.slice(0, -1))) ?? ""
  );
}

function keyPrefixes(key: string): string[] {
  const prefixes: string[] = [];
  for (let index = key.indexOf("."); index > 0 && index < key.length - 1; index = key.indexOf(".", index + 1)) {
    prefixes.push(key.slice(0, index + 1));
  }
  return prefixes;
}

export function diffTextAgainstBase(base: string, value: string): DiffSegment[] {
  if (!value) {
    return [];
  }
  if (base === value) {
    return [{ text: value, kind: "same" }];
  }

  const baseChars = Array.from(base);
  const valueChars = Array.from(value);
  const table = Array.from({ length: baseChars.length + 1 }, () => Array<number>(valueChars.length + 1).fill(0));

  for (let baseIndex = baseChars.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let valueIndex = valueChars.length - 1; valueIndex >= 0; valueIndex -= 1) {
      table[baseIndex][valueIndex] =
        baseChars[baseIndex] === valueChars[valueIndex]
          ? table[baseIndex + 1][valueIndex + 1] + 1
          : Math.max(table[baseIndex + 1][valueIndex], table[baseIndex][valueIndex + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let baseIndex = 0;
  let valueIndex = 0;
  while (valueIndex < valueChars.length) {
    if (baseIndex < baseChars.length && baseChars[baseIndex] === valueChars[valueIndex]) {
      pushDiffSegment(segments, valueChars[valueIndex], "same");
      baseIndex += 1;
      valueIndex += 1;
      continue;
    }
    if (baseIndex < baseChars.length && table[baseIndex + 1][valueIndex] >= table[baseIndex][valueIndex + 1]) {
      baseIndex += 1;
      continue;
    }
    pushDiffSegment(segments, valueChars[valueIndex], "added");
    valueIndex += 1;
  }
  return segments;
}

function pushDiffSegment(segments: DiffSegment[], text: string, kind: DiffSegment["kind"]) {
  const last = segments[segments.length - 1];
  if (last?.kind === kind) {
    last.text += text;
    return;
  }
  segments.push({ text, kind });
}

export function isManualEntryPatch(entry: ResolvedEntry | undefined): boolean {
  if (!entry?.patch) {
    return false;
  }
  if (entry.patch.meta?.generatedBy === "llm" || entry.patch.meta?.model) {
    return false;
  }
  if (entry.patch.meta?.generatedBy === "converted") {
    return false;
  }
  return true;
}

export function isActiveLlmCandidate(activePatch: PatchValue | undefined, candidate: PatchValue, candidateIndex: number): boolean {
  if (!activePatch || activePatch.meta?.generatedBy !== "llm") {
    return false;
  }
  return llmCandidateKey(activePatch, candidateIndex) === llmCandidateKey(candidate, candidateIndex);
}

export function llmCandidateKey(candidate: PatchValue, index: number): string {
  return candidate.meta?.llmCandidateId ?? `${candidate.updatedAt}:${index}:${candidate.value}`;
}

export function formatPatchTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parentUnderManual(entry: ResolvedEntry): CandidateValue {
  return entry.base;
}

export function buildStats(rows: CatalogRow[], locale: LocaleCode, project: LangpackProjectPatch) {
  const sourceCounts = rows.reduce(
    (counts, row) => {
      const entry = locale ? row.entries[locale] : undefined;
      if (entry) {
        counts[entry.final.source] += 1;
      }
      return counts;
    },
    {
      jar: 0,
      resourcePack: 0,
      llm: 0,
      manual: 0,
      converted: 0,
      fallback: 0,
      missing: 0,
    },
  );
  const patches = Object.values(project.patches ?? {});
  return {
    ...sourceCounts,
    manual: patches.filter((patch) => patch.meta?.generatedBy !== "llm" && patch.meta?.generatedBy !== "converted").length,
    llm: patches.filter((patch) => patch.meta?.generatedBy === "llm").length,
  };
}

export function countTranslationTargetsBySource(rows: CatalogRow[], locale: LocaleCode): Record<SourceKind, number> {
  return rows.reduce(
    (counts, row) => {
      const entry = locale ? row.entries[locale] : undefined;
      if (entry) {
        counts[entry.final.source] += 1;
      }
      return counts;
    },
    {
      jar: 0,
      resourcePack: 0,
      llm: 0,
      manual: 0,
      converted: 0,
      fallback: 0,
      missing: 0,
    },
  );
}

export function moveListItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

export function chunksByTargetLocale(items: LlmJob[], size: number): LlmJob[][] {
  const groups = new Map<LocaleCode, LlmJob[]>();
  for (const item of items) {
    const group = groups.get(item.targetLocale);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.targetLocale, [item]);
    }
  }
  return [...groups.values()].flatMap((group) => chunks(group, size));
}

export function upsertLiveOutput(outputs: LlmLiveOutput[], next: LlmLiveOutput): LlmLiveOutput[] {
  const filtered = outputs.filter((output) => output.id !== next.id);
  return [next, ...filtered];
}

export function nextAnimatedDraftText(visibleText: string, targetText: string): string {
  if (visibleText === targetText) {
    return visibleText;
  }
  if (!targetText) {
    return "";
  }

  const visibleChars = Array.from(visibleText);
  const targetChars = Array.from(targetText);
  let matchingChars = 0;
  while (
    matchingChars < visibleChars.length &&
    matchingChars < targetChars.length &&
    visibleChars[matchingChars] === targetChars[matchingChars]
  ) {
    matchingChars += 1;
  }

  return targetChars.slice(0, Math.min(matchingChars + 1, targetChars.length)).join("");
}

export class TranslationStoppedError extends Error {
  constructor() {
    super("LLM translation stopped.");
    this.name = "TranslationStoppedError";
  }
}

export async function waitForTranslationResume(control: TranslationControl) {
  while (control.paused && !control.stopped) {
    await delay(250);
  }
}

export function persistedLlmSettings(settings: LlmSettings): PersistedLlmSettings {
  const { apiKey: _apiKey, ...persisted } = settings;
  return persisted;
}

export function restoreDraftState(draft: BrowserDraftState, restoredManualDraftRef: { current: { entryId: EntryId; value: string } | null }) {
  if (draft.manualDraftEntryId && typeof draft.manualDraft === "string") {
    restoredManualDraftRef.current = {
      entryId: draft.manualDraftEntryId,
      value: draft.manualDraft,
    };
  }
}

export function normalizeProjectDraft(project: LangpackProjectPatch | undefined): LangpackProjectPatch {
  try {
    return normalizeProjectPatch(project);
  } catch {
    return createEmptyProjectPatch();
  }
}

export function isLocaleCodeValue(value: unknown): value is LocaleCode {
  return typeof value === "string" && isValidLocaleCode(value);
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === "string" && (value === "project" || value === "sources" || value === "settings" || value.startsWith("namespace:"));
}

export function isEntryDraftRecord(value: unknown): value is Record<EntryId, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((draft) => typeof draft === "string");
}

export function formatDraftTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "the last session";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function translationHeaderText(progress: TranslationProgress): string {
  const action = progress.status === "paused" ? "paused" : progress.status === "stopping" ? "stopping" : "running";
  return `LLM translation ${action}: ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;
}

export function estimateRemainingTime(progress: TranslationProgress, now: number): string {
  if (progress.status === "paused") {
    return "paused";
  }
  if (progress.completed <= 0) {
    return "calculating";
  }
  const elapsed = Math.max(1, now - progress.startedAt);
  const averageMsPerItem = elapsed / progress.completed;
  const remainingItems = Math.max(0, progress.total - progress.completed);
  return formatDuration(remainingItems * averageMsPerItem);
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function removeDraft(drafts: Record<EntryId, string>, id: EntryId): Record<EntryId, string> {
  const next = { ...drafts };
  delete next[id];
  return next;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
