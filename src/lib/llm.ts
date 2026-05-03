import { protectedTokensMatch } from "./placeholders";
import { createPatchValue, resolveBaseValue } from "./patches";
import { DEFAULT_RUNTIME_GLOSSARY, compactVanillaGlossaryEntriesForPrompt, selectGlossaryEntries } from "./glossary";
import { uniqueLocaleCodes } from "./locales";
import type {
  ConvertSourceSettings,
  EntryId,
  LangpackProjectPatch,
  LocaleCode,
  LocaleFallbacks,
  LlmReferenceMode,
  LlmReferenceValue,
  PatchValue,
  GlossaryEntry,
  SourcePackScanResult,
  TranslationMap,
} from "./types";
import { DEFAULT_CONVERT_SOURCE_SETTINGS } from "./types";
import { makeEntryId } from "./entryId";

export const LLM_PROMPT_VERSION = "minecraft-mods-localizer-v1";
export const DEFAULT_LLM_SYSTEM_PROMPT =
  "Translate Minecraft mod language values. Preserve every printf placeholder, backslash escape, Minecraft section sign format code, and XML-like tag exactly. Return only JSON.";
export const DEFAULT_LLM_USER_PROMPT =
  "Translate the provided Minecraft language entries for the requested locale. Keep names, placeholders, and formatting codes intact unless they should naturally be translated.";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt?: string;
  debugMode?: boolean;
  debugDelayMs?: number;
}

export interface LlmJob {
  namespace: string;
  targetLocale: LocaleCode;
  key: string;
  sourceLocale: LocaleCode;
  sourceText: string;
  sourceValues?: LlmReferenceValue[];
  sourceReferenceMode?: LlmReferenceMode;
}

export interface LlmPatchResult {
  patches: Record<EntryId, PatchValue>;
  warnings: string[];
}

export interface LlmRequestOptions {
  signal?: AbortSignal;
  fallbackChains?: LocaleFallbacks;
  convertSources?: ConvertSourceSettings;
  warnFormattingCodeMismatch?: boolean;
  onDraft?: (id: EntryId, text: string) => void | Promise<void>;
  onPatch?: (id: EntryId, patch: PatchValue) => void | Promise<void>;
  onWarning?: (warning: string) => void | Promise<void>;
  onItemComplete?: (id: EntryId) => void | Promise<void>;
}

interface PromptJob {
  promptId: string;
  entryId: EntryId;
  job: LlmJob;
}

interface LlmTranslationState {
  patches: Record<EntryId, PatchValue>;
  warnings: string[];
  promptJobs: PromptJob[];
  promptJobById: Map<string, PromptJob>;
  processedPromptIds: Set<string>;
  unknownPromptIds: Set<string>;
  lastDrafts: Map<string, string>;
  promptVersion: string;
  settings: LlmSettings;
  modTranslations: TranslationMap;
  sourcePacks: SourcePackScanResult[];
  glossary: readonly GlossaryEntry[];
  options: LlmRequestOptions;
}

interface PromptPayload {
  instructions: string;
  to: LocaleCode;
  glossaryInstruction?: string;
  glossary?: Array<Record<string, string[] | string>>;
  outputShape: string;
  items: Array<{
    id: string;
    refs: Array<{
      locale: LocaleCode;
      text: string;
    }>;
  }>;
}

export interface PartialTranslationObjectScan {
  completed: Record<string, string>;
  drafts: Record<string, string>;
  complete: boolean;
}

export async function listLlmModels(settings: LlmSettings): Promise<string[]> {
  if (!settings.baseUrl.trim()) {
    throw new Error("LLM base URL is required.");
  }
  const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: {
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Model list request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((model: { id?: unknown }) => (typeof model.id === "string" ? model.id : ""))
    .filter(Boolean)
    .sort((first: string, second: string) => first.localeCompare(second));
}

export async function translateJobsWithLlm(
  settings: LlmSettings,
  jobs: LlmJob[],
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  glossaryOrOptions: readonly GlossaryEntry[] | LlmRequestOptions = DEFAULT_RUNTIME_GLOSSARY,
  maybeOptions: LlmRequestOptions = {},
): Promise<LlmPatchResult> {
  const glossary: readonly GlossaryEntry[] = isGlossaryEntryArray(glossaryOrOptions)
    ? glossaryOrOptions
    : DEFAULT_RUNTIME_GLOSSARY;
  const options: LlmRequestOptions = isGlossaryEntryArray(glossaryOrOptions) ? maybeOptions : glossaryOrOptions;
  const translatableJobs = jobs.filter(hasLlmSourceText);
  throwIfAborted(options.signal);
  if (translatableJobs.length === 0) {
    return { patches: {}, warnings: [] };
  }
  if (settings.debugMode) {
    return translateJobsWithDebugLlm(settings, translatableJobs, modTranslations, sourcePacks, glossary, options);
  }
  if (!settings.baseUrl.trim()) {
    throw new Error("LLM base URL is required.");
  }
  if (!settings.model.trim()) {
    throw new Error("LLM model is required.");
  }

  const groups = groupJobsByTargetLocale(translatableJobs);
  const patches: Record<EntryId, PatchValue> = {};
  const warnings: string[] = [];

  for (const group of groups) {
    const result = await translateLocaleJobsWithLlm(settings, group, modTranslations, sourcePacks, glossary, options);
    Object.assign(patches, result.patches);
    warnings.push(...result.warnings);
  }

  return { patches, warnings };
}

async function translateLocaleJobsWithLlm(
  settings: LlmSettings,
  jobs: LlmJob[],
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  glossary: readonly GlossaryEntry[],
  options: LlmRequestOptions,
): Promise<LlmPatchResult> {
  const promptVersion = promptVersionForSettings(settings);
  const promptJobs = createPromptJobs(jobs);
  const payload = createPromptPayload(settings, promptJobs, glossary);
  const state = createTranslationState(settings, promptJobs, modTranslations, sourcePacks, glossary, options, promptVersion);

  const streamResponse = await fetchChatCompletion(settings, payload, options, true);
  if (!streamResponse.ok) {
    return translateLocaleJobsWithoutStream(settings, payload, state, options);
  }

  if (!isEventStreamResponse(streamResponse)) {
    await processChatCompletionResponse(streamResponse, state);
    await warnMissingPromptJobs(state);
    return { patches: state.patches, warnings: state.warnings };
  }

  let content = "";
  try {
    await readChatCompletionStream(streamResponse, async (delta) => {
      content += delta;
      await processStreamingTranslationContent(content, state);
    });
    await processStreamingTranslationContent(content, state);
    await warnMissingPromptJobs(state);
    return { patches: state.patches, warnings: state.warnings };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error;
    }
    if (state.processedPromptIds.size === 0) {
      return translateLocaleJobsWithoutStream(settings, payload, state, options);
    }
    await addWarning(state, `LLM stream ended before every translation completed: ${errorMessage(error)}`);
    await warnMissingPromptJobs(state);
    return { patches: state.patches, warnings: state.warnings };
  }
}

async function translateLocaleJobsWithoutStream(
  settings: LlmSettings,
  payload: PromptPayload,
  state: LlmTranslationState,
  options: LlmRequestOptions,
): Promise<LlmPatchResult> {
  const response = await fetchChatCompletion(settings, payload, options, false);
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }
  await processChatCompletionResponse(response, state);
  await warnMissingPromptJobs(state);
  return { patches: state.patches, warnings: state.warnings };
}

async function fetchChatCompletion(settings: LlmSettings, payload: PromptPayload, options: LlmRequestOptions, stream: boolean): Promise<Response> {
  return fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      ...(stream ? { stream: true } : {}),
      messages: [
        {
          role: "system",
          content: resolvedSystemPrompt(settings),
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });
}

async function processChatCompletionResponse(response: Response, state: LlmTranslationState): Promise<void> {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM response did not include message content.");
  }

  const translations = parseTranslationObject(content);
  for (const promptId of Object.keys(translations)) {
    if (!state.promptJobById.has(promptId)) {
      await warnUnknownPromptId(state, promptId);
    }
  }
  for (const promptJob of state.promptJobs) {
    await processPromptTranslation(state, promptJob, translations[promptJob.promptId]);
  }
}

function createPromptPayload(settings: LlmSettings, promptJobs: PromptJob[], glossaryEntries: readonly GlossaryEntry[]): PromptPayload {
  const targetLocale = promptJobs[0]?.job.targetLocale ?? "";
  const glossaryReferences = promptJobs.flatMap((promptJob) =>
    normalizedJobSourceValues(promptJob.job).map((sourceValue) => ({
      key: promptJob.job.key,
      locale: sourceValue.locale,
      value: sourceValue.value,
    })),
  );
  const glossarySourceLocales = uniqueLocaleCodes(glossaryReferences.map((reference) => reference.locale).filter(Boolean));
  const glossary = compactGlossary(
    selectGlossaryEntries(glossaryReferences, glossaryEntries),
    glossarySourceLocales,
    targetLocale,
  );
  return {
    instructions: resolvedUserPrompt(settings),
    to: targetLocale,
    ...(glossary.length
      ? {
          glossaryInstruction: "When glossary contains a relevant term, use the first target term as preferred. Later terms are accepted aliases.",
          glossary,
        }
      : {}),
    outputShape: "Return one JSON object only. Keys must be item ids. Values must be translated strings.",
    items: promptJobs.map((promptJob) => ({
      id: promptJob.promptId,
      refs: normalizedJobSourceValues(promptJob.job).map((sourceValue) => ({
        locale: sourceValue.locale,
        text: sourceValue.value,
      })),
    })),
  };
}

function compactGlossary(
  glossary: ReturnType<typeof selectGlossaryEntries>,
  sourceLocales: readonly LocaleCode[],
  targetLocale: LocaleCode,
): Array<Record<string, string[] | string>> {
  const locales = uniqueLocaleCodes([...sourceLocales, targetLocale]);
  const entries = glossary.flatMap((entry) => {
    const sourceTerms = sourceLocales
      .filter((locale) => locale !== targetLocale)
      .map((locale) => [locale, entry.terms[locale] ?? []] as const)
      .filter(([, terms]) => terms.length > 0);
    const targetTerms = entry.terms[targetLocale] ?? [];
    if (sourceTerms.length === 0 || targetTerms.length === 0) {
      return [];
    }
    return [{
      id: entry.id,
      source: entry.source,
      terms: {
        ...Object.fromEntries(sourceTerms),
        [targetLocale]: targetTerms,
      },
      ...(entry.note ? { note: entry.note } : {}),
    }];
  });
  return compactVanillaGlossaryEntriesForPrompt(entries, locales).map((entry) => ({
    id: entry.id,
    ...entry.terms,
    ...(entry.note ? { note: entry.note } : {}),
  }));
}

function createPromptJobs(jobs: LlmJob[]): PromptJob[] {
  const keyCounts = countBy(jobs.map((job) => job.key));
  const usedPromptIds = new Set<string>();
  return jobs.map((job) => {
    const basePromptId = (keyCounts.get(job.key) ?? 0) > 1 ? `${job.namespace}/${job.key}` : job.key;
    const promptId = uniquePromptId(basePromptId, usedPromptIds);
    usedPromptIds.add(promptId);
    return {
      promptId,
      entryId: makeEntryId(job.namespace, job.targetLocale, job.key),
      job,
    };
  });
}

function uniquePromptId(basePromptId: string, usedPromptIds: Set<string>): string {
  if (!usedPromptIds.has(basePromptId)) {
    return basePromptId;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${basePromptId}#${index}`;
    if (!usedPromptIds.has(candidate)) {
      return candidate;
    }
  }
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function groupJobsByTargetLocale(jobs: LlmJob[]): LlmJob[][] {
  const groups = new Map<LocaleCode, LlmJob[]>();
  for (const job of jobs) {
    const group = groups.get(job.targetLocale);
    if (group) {
      group.push(job);
    } else {
      groups.set(job.targetLocale, [job]);
    }
  }
  return [...groups.values()];
}

function createTranslationState(
  settings: LlmSettings,
  promptJobs: PromptJob[],
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  glossary: readonly GlossaryEntry[],
  options: LlmRequestOptions,
  promptVersion: string,
): LlmTranslationState {
  return {
    patches: {},
    warnings: [],
    promptJobs,
    promptJobById: new Map(promptJobs.map((promptJob) => [promptJob.promptId, promptJob])),
    processedPromptIds: new Set(),
    unknownPromptIds: new Set(),
    lastDrafts: new Map(),
    promptVersion,
    settings,
    modTranslations,
    sourcePacks,
    glossary,
    options,
  };
}

async function processStreamingTranslationContent(content: string, state: LlmTranslationState): Promise<boolean> {
  const scan = scanPartialTranslationObject(content);
  let emittedDraft = false;

  for (const [promptId, draft] of Object.entries(scan.drafts)) {
    const promptJob = state.promptJobById.get(promptId);
    if (!promptJob || state.processedPromptIds.has(promptId) || state.lastDrafts.get(promptId) === draft) {
      continue;
    }
    state.lastDrafts.set(promptId, draft);
    emittedDraft = true;
    await state.options.onDraft?.(promptJob.entryId, draft);
  }

  for (const [promptId, translated] of Object.entries(scan.completed)) {
    const promptJob = state.promptJobById.get(promptId);
    if (!promptJob) {
      await warnUnknownPromptId(state, promptId);
      continue;
    }
    await processPromptTranslation(state, promptJob, translated);
  }

  return emittedDraft;
}

async function processPromptTranslation(state: LlmTranslationState, promptJob: PromptJob, translated: string | undefined): Promise<void> {
  if (state.processedPromptIds.has(promptJob.promptId)) {
    return;
  }
  state.processedPromptIds.add(promptJob.promptId);
  state.lastDrafts.delete(promptJob.promptId);

  const { job, entryId } = promptJob;
  throwIfAborted(state.options.signal);
  if (typeof translated !== "string" || !translated.trim()) {
    await addWarning(state, `${entryId}: missing LLM translation`, entryId);
    return;
  }
  if (!protectedTokensMatch(job.sourceText, translated)) {
    await addWarning(state, `${entryId}: rejected LLM translation because protected tokens changed`, entryId);
    return;
  }
  if (state.options.warnFormattingCodeMismatch && !protectedTokensMatch(job.sourceText, translated, { includeFormattingCodes: true })) {
    await addWarning(state, `${entryId}: LLM translation changed formatting codes`);
  }

  const parent = resolveBaseValue(
    state.modTranslations,
    state.sourcePacks,
    job.namespace,
    job.targetLocale,
    job.key,
    state.options.fallbackChains,
    state.glossary,
    undefined,
    state.options.convertSources ?? DEFAULT_CONVERT_SOURCE_SETTINGS,
  );
  const patch = await createPatchValue(translated, parent, {
    generatedBy: "llm",
    llmCandidateId: createLlmCandidateId(),
    model: state.settings.model,
    promptVersion: state.promptVersion,
  });
  state.patches[entryId] = patch;
  await state.options.onPatch?.(entryId, patch);
  await state.options.onItemComplete?.(entryId);
}

async function warnMissingPromptJobs(state: LlmTranslationState): Promise<void> {
  for (const promptJob of state.promptJobs) {
    if (state.processedPromptIds.has(promptJob.promptId)) {
      continue;
    }
    state.processedPromptIds.add(promptJob.promptId);
    await addWarning(state, `${promptJob.entryId}: missing LLM translation`, promptJob.entryId);
  }
}

async function warnUnknownPromptId(state: LlmTranslationState, promptId: string): Promise<void> {
  if (state.unknownPromptIds.has(promptId)) {
    return;
  }
  state.unknownPromptIds.add(promptId);
  await addWarning(state, `${promptId}: unknown LLM translation id`);
}

async function addWarning(state: LlmTranslationState, warning: string, completedEntryId?: EntryId): Promise<void> {
  state.warnings.push(warning);
  await state.options.onWarning?.(warning);
  if (completedEntryId) {
    await state.options.onItemComplete?.(completedEntryId);
  }
}

function isEventStreamResponse(response: Response): boolean {
  return Boolean(response.body && response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream"));
}

async function readChatCompletionStream(response: Response, onContent: (content: string) => Promise<void>): Promise<void> {
  if (!response.body) {
    throw new Error("LLM streaming response did not include a body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      await processStreamEvent(event, onContent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processStreamEvent(buffer, onContent);
  }
}

async function processStreamEvent(event: string, onContent: (content: string) => Promise<void>): Promise<void> {
  const data = event
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") {
    return;
  }
  const parsed = JSON.parse(data);
  const content = parsed?.choices?.[0]?.delta?.content;
  if (typeof content === "string" && content) {
    await onContent(content);
  }
}

export function scanPartialTranslationObject(content: string): PartialTranslationObjectScan {
  const objectStart = content.indexOf("{");
  const completed: Record<string, string> = {};
  const drafts: Record<string, string> = {};
  if (objectStart < 0) {
    return { completed, drafts, complete: false };
  }

  let index = objectStart + 1;
  while (index < content.length) {
    index = skipJsonWhitespaceAndCommas(content, index);
    if (content[index] === "}") {
      return { completed, drafts, complete: true };
    }
    if (content[index] !== "\"") {
      break;
    }

    const key = readJsonString(content, index);
    if (!key.complete) {
      break;
    }
    index = skipJsonWhitespace(content, key.end);
    if (content[index] !== ":") {
      break;
    }
    index = skipJsonWhitespace(content, index + 1);
    drafts[key.value] = "";
    if (content[index] !== "\"") {
      break;
    }

    const value = readJsonString(content, index);
    drafts[key.value] = value.value;
    if (!value.complete) {
      break;
    }
    completed[key.value] = value.value;
    index = value.end;
  }

  return { completed, drafts, complete: false };
}

function skipJsonWhitespaceAndCommas(content: string, index: number): number {
  let next = index;
  while (next < content.length && (isJsonWhitespace(content[next]) || content[next] === ",")) {
    next += 1;
  }
  return next;
}

function skipJsonWhitespace(content: string, index: number): number {
  let next = index;
  while (next < content.length && isJsonWhitespace(content[next])) {
    next += 1;
  }
  return next;
}

function isJsonWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\n" || value === "\r" || value === "\t";
}

function readJsonString(content: string, start: number): { value: string; complete: boolean; end: number } {
  let value = "";
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === "\"") {
      return { value, complete: true, end: index + 1 };
    }
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }

    if (index + 1 >= content.length) {
      return { value, complete: false, end: content.length };
    }
    const escaped = content[index + 1];
    switch (escaped) {
      case "\"":
      case "\\":
      case "/":
        value += escaped;
        index += 2;
        break;
      case "b":
        value += "\b";
        index += 2;
        break;
      case "f":
        value += "\f";
        index += 2;
        break;
      case "n":
        value += "\n";
        index += 2;
        break;
      case "r":
        value += "\r";
        index += 2;
        break;
      case "t":
        value += "\t";
        index += 2;
        break;
      case "u": {
        const hex = content.slice(index + 2, index + 6);
        if (hex.length < 4 || !/^[0-9a-f]{4}$/i.test(hex)) {
          return { value, complete: false, end: content.length };
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        break;
      }
      default:
        return { value, complete: false, end: content.length };
    }
  }
  return { value, complete: false, end: content.length };
}

function hasLlmSourceText(job: LlmJob): boolean {
  return typeof job.sourceText === "string" && job.sourceText.trim().length > 0;
}

function normalizedJobSourceValues(job: LlmJob): LlmReferenceValue[] {
  const sourceValues = (job.sourceValues ?? []).filter((sourceValue) => sourceValue.value.trim().length > 0);
  if (sourceValues.length) {
    return sourceValues;
  }
  return [
    {
      locale: job.sourceLocale,
      source: "fallback",
      sourceLabel: `${job.sourceLocale} source`,
      value: job.sourceText,
    },
  ];
}

async function translateJobsWithDebugLlm(
  settings: LlmSettings,
  jobs: LlmJob[],
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  glossary: readonly GlossaryEntry[],
  options: LlmRequestOptions = {},
): Promise<LlmPatchResult> {
  const patches: Record<EntryId, PatchValue> = {};
  const delayMs = normalizeDebugDelay(settings.debugDelayMs);

  if (delayMs > 0) {
    await delayWithAbort(delayMs, options.signal);
  }

  for (const [index, job] of jobs.entries()) {
    throwIfAborted(options.signal);
    const id = makeEntryId(job.namespace, job.targetLocale, job.key);
    const parent = resolveBaseValue(
      modTranslations,
      sourcePacks,
      job.namespace,
      job.targetLocale,
      job.key,
      options.fallbackChains,
      glossary,
      undefined,
      options.convertSources ?? DEFAULT_CONVERT_SOURCE_SETTINGS,
    );
    const translated = debugTranslate(job.sourceText, job.targetLocale);
    await options.onDraft?.(id, translated);
    patches[id] = await createPatchValue(translated, parent, {
      generatedBy: "llm",
      llmCandidateId: createLlmCandidateId(),
      model: settings.model.trim() || "debug-simulated-llm",
      promptVersion: `${LLM_PROMPT_VERSION}-debug`,
    });
    await options.onPatch?.(id, patches[id]);
    await options.onItemComplete?.(id);
    if ((index + 1) % 8 === 0) {
      await delayWithAbort(0, options.signal);
    }
  }

  return { patches, warnings: [] };
}

function normalizeDebugDelay(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), 5000);
}

function delayWithAbort(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    function abort() {
      globalThis.clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) {
    return;
  }
  throw abortError();
}

function abortError(): Error {
  const error = new Error("LLM translation aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function debugTranslate(value: string, locale: LocaleCode): string {
  return `[debug ${locale}] ${value}`;
}

function resolvedSystemPrompt(settings: LlmSettings): string {
  return settings.systemPrompt?.trim() || DEFAULT_LLM_SYSTEM_PROMPT;
}

function resolvedUserPrompt(settings: LlmSettings): string {
  return settings.userPrompt?.trim() || DEFAULT_LLM_USER_PROMPT;
}

function promptVersionForSettings(settings: LlmSettings): string {
  return resolvedSystemPrompt(settings) === DEFAULT_LLM_SYSTEM_PROMPT && resolvedUserPrompt(settings) === DEFAULT_LLM_USER_PROMPT
    ? LLM_PROMPT_VERSION
    : `${LLM_PROMPT_VERSION}-custom`;
}

function isGlossaryEntryArray(value: readonly GlossaryEntry[] | LlmRequestOptions): value is readonly GlossaryEntry[] {
  return Array.isArray(value);
}

export function mergeLlmPatches(project: LangpackProjectPatch, patches: Record<EntryId, PatchValue>): LangpackProjectPatch {
  const nextCandidates = { ...(project.llmCandidates ?? {}) };
  for (const [id, patch] of Object.entries(patches) as [EntryId, PatchValue][]) {
    nextCandidates[id] = [...(nextCandidates[id] ?? []), patch];
  }
  return {
    ...project,
    llmCandidates: nextCandidates,
    patches: {
      ...(project.patches ?? {}),
      ...patches,
    },
  };
}

function createLlmCandidateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseTranslationObject(content: string): Record<string, string> {
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM response JSON must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
