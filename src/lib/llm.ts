import { placeholdersMatch } from "./placeholders";
import { createPatchValue, resolveBaseValue } from "./patches";
import { DEFAULT_RUNTIME_PHRASE_MAPPINGS, selectPhraseGlossary } from "./phraseMappings";
import type {
  EntryId,
  LangpackProjectPatch,
  PatchValue,
  PhraseMapping,
  SourcePackScanResult,
  TargetLocale,
  TranslationMap,
} from "./types";
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
  locale: TargetLocale;
  key: string;
  english: string;
}

export interface LlmPatchResult {
  patches: Record<EntryId, PatchValue>;
  warnings: string[];
}

export interface LlmRequestOptions {
  signal?: AbortSignal;
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
  phraseMappingsOrOptions: readonly PhraseMapping[] | LlmRequestOptions = DEFAULT_RUNTIME_PHRASE_MAPPINGS,
  maybeOptions: LlmRequestOptions = {},
): Promise<LlmPatchResult> {
  const phraseMappings: readonly PhraseMapping[] = isPhraseMappingArray(phraseMappingsOrOptions)
    ? phraseMappingsOrOptions
    : DEFAULT_RUNTIME_PHRASE_MAPPINGS;
  const options: LlmRequestOptions = isPhraseMappingArray(phraseMappingsOrOptions) ? maybeOptions : phraseMappingsOrOptions;
  const translatableJobs = jobs.filter(hasLlmSourceText);
  throwIfAborted(options.signal);
  if (translatableJobs.length === 0) {
    return { patches: {}, warnings: [] };
  }
  if (settings.debugMode) {
    return translateJobsWithDebugLlm(settings, translatableJobs, modTranslations, sourcePacks, phraseMappings, options);
  }
  if (!settings.baseUrl.trim()) {
    throw new Error("LLM base URL is required.");
  }
  if (!settings.model.trim()) {
    throw new Error("LLM model is required.");
  }

  const payloadJobs = translatableJobs.map((job) => ({
    id: makeEntryId(job.namespace, job.locale, job.key),
    locale: job.locale,
    key: job.key,
    english: job.english,
  }));
  const promptVersion = promptVersionForSettings(settings);
  const phraseGlossary = selectPhraseGlossary(translatableJobs, phraseMappings);

  const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: resolvedSystemPrompt(settings),
        },
        {
          role: "user",
          content: JSON.stringify({
            promptVersion,
            instructions: resolvedUserPrompt(settings),
            glossaryInstruction:
              "When phraseGlossary contains a relevant term, use the first value for the requested locale as the preferred term. Later values are accepted aliases.",
            phraseGlossary,
            outputShape: "Return an object whose keys are item ids and whose values are translated strings.",
            items: payloadJobs,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM response did not include message content.");
  }

  const translations = parseTranslationObject(content);
  const patches: Record<EntryId, PatchValue> = {};
  const warnings: string[] = [];

  for (const job of translatableJobs) {
    throwIfAborted(options.signal);
    const id = makeEntryId(job.namespace, job.locale, job.key);
    const translated = translations[id];
    if (typeof translated !== "string" || !translated.trim()) {
      warnings.push(`${id}: missing LLM translation`);
      continue;
    }
    if (!placeholdersMatch(job.english, translated)) {
      warnings.push(`${id}: rejected LLM translation because placeholders changed`);
      continue;
    }
    const parent = resolveBaseValue(modTranslations, sourcePacks, job.namespace, job.locale, job.key, undefined, phraseMappings);
    patches[id] = await createPatchValue(translated, parent, {
      generatedBy: "llm",
      llmCandidateId: createLlmCandidateId(),
      model: settings.model,
      promptVersion,
    });
  }

  return { patches, warnings };
}

function hasLlmSourceText(job: LlmJob): boolean {
  return typeof job.english === "string" && job.english.trim().length > 0;
}

async function translateJobsWithDebugLlm(
  settings: LlmSettings,
  jobs: LlmJob[],
  modTranslations: TranslationMap,
  sourcePacks: SourcePackScanResult[],
  phraseMappings: readonly PhraseMapping[],
  options: LlmRequestOptions = {},
): Promise<LlmPatchResult> {
  const patches: Record<EntryId, PatchValue> = {};
  const delayMs = normalizeDebugDelay(settings.debugDelayMs);

  if (delayMs > 0) {
    await delayWithAbort(delayMs, options.signal);
  }

  for (const [index, job] of jobs.entries()) {
    throwIfAborted(options.signal);
    const id = makeEntryId(job.namespace, job.locale, job.key);
    const parent = resolveBaseValue(modTranslations, sourcePacks, job.namespace, job.locale, job.key, undefined, phraseMappings);
    patches[id] = await createPatchValue(debugTranslate(job.english, job.locale), parent, {
      generatedBy: "llm",
      llmCandidateId: createLlmCandidateId(),
      model: settings.model.trim() || "debug-simulated-llm",
      promptVersion: `${LLM_PROMPT_VERSION}-debug`,
    });
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

function debugTranslate(value: string, locale: TargetLocale): string {
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

function isPhraseMappingArray(value: readonly PhraseMapping[] | LlmRequestOptions): value is readonly PhraseMapping[] {
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
