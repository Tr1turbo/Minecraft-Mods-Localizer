import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  animatedDraftTextAtElapsed,
  chunksByTargetLocale,
  delay,
  draftAnimationDurationMs,
  draftTargetDeltaCharCount,
  errorMessage,
  isAbortError,
  removeDraft,
  TranslationStoppedError,
  upsertLiveOutput,
  waitForTranslationResume,
  yieldToBrowser,
} from "../helpers";
import type { StatusMessage, TranslationControl, TranslationProgress } from "../types";
import { makeEntryId } from "../../lib/entryId";
import {
  listLlmModels,
  mergeLlmPatches,
  translateJobsWithLlm,
  type LlmJob,
  type LlmSettings,
} from "../../lib/llm";
import { clamp, type AppSettings } from "../../lib/deploymentConfig";
import type {
  EntryId,
  LangpackProjectPatch,
  ModScanResult,
  PhraseMapping,
  SourcePackScanResult,
} from "../../lib/types";

interface TranslateJobsOptions {
  animateSingleCandidate?: boolean;
  seedLiveOutput?: boolean;
  showProgressPanel?: boolean;
}

interface UseLlmTranslationOptions {
  project: LangpackProjectPatch;
  setProject: Dispatch<SetStateAction<LangpackProjectPatch>>;
  modScan: ModScanResult;
  sourcePacks: SourcePackScanResult[];
  runtimePhraseMappings: PhraseMapping[];
  settings: AppSettings;
  llmSettings: LlmSettings;
  setStatus: Dispatch<SetStateAction<StatusMessage>>;
}

const LLM_CANDIDATE_HOLD_MS = 250;

interface LiveDraftAnimation {
  from: string;
  target: string;
  visible: string;
  startedAt: number;
  durationMs: number;
  frame: number | null;
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export function useLlmTranslation({
  project,
  setProject,
  modScan,
  sourcePacks,
  runtimePhraseMappings,
  settings,
  llmSettings,
  setStatus,
}: UseLlmTranslationOptions) {
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [llmCandidateDisplayDrafts, setLlmCandidateDisplayDrafts] = useState<Record<EntryId, string>>({});
  const [llmWarnings, setLlmWarnings] = useState<string[]>([]);
  const translationControlRef = useRef<TranslationControl>({ paused: false, stopped: false, abortControllers: new Set() });
  const llmDisplayAnimationRef = useRef(0);
  const liveDraftAnimationsRef = useRef<Map<EntryId, LiveDraftAnimation>>(new Map());
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  function clearLiveDraftAnimation(id: EntryId): string {
    const animation = liveDraftAnimationsRef.current.get(id);
    if (!animation) {
      return "";
    }
    if (animation.frame !== null) {
      window.cancelAnimationFrame(animation.frame);
    }
    liveDraftAnimationsRef.current.delete(id);
    return animation.visible;
  }

  function clearAllLiveDraftAnimations() {
    for (const animation of liveDraftAnimationsRef.current.values()) {
      if (animation.frame !== null) {
        window.cancelAnimationFrame(animation.frame);
      }
    }
    liveDraftAnimationsRef.current.clear();
  }

  useEffect(() => {
    return () => {
      clearAllLiveDraftAnimations();
      llmDisplayAnimationRef.current += 1;
    };
  }, []);

  function pauseTranslationJob() {
    if (!translationProgress || translationProgress.status !== "running") {
      return;
    }
    translationControlRef.current.paused = true;
    setTranslationProgress((current) => (current ? { ...current, status: "paused", updatedAt: Date.now() } : current));
    setStatus({ tone: "warn", text: "LLM translation paused. Active requests will finish before the queue waits." });
  }

  function resumeTranslationJob() {
    if (!translationProgress || translationProgress.status !== "paused") {
      return;
    }
    translationControlRef.current.paused = false;
    setTranslationProgress((current) => (current ? { ...current, status: "running", updatedAt: Date.now() } : current));
    setStatus({ tone: "ok", text: "LLM translation resumed." });
  }

  function stopTranslationJob() {
    if (!translationProgress || translationProgress.status === "stopping") {
      return;
    }
    const control = translationControlRef.current;
    control.stopped = true;
    control.paused = false;
    for (const abortController of control.abortControllers) {
      abortController.abort();
    }
    clearAllLiveDraftAnimations();
    setTranslationProgress((current) => (current ? { ...current, status: "stopping", updatedAt: Date.now() } : current));
    setStatus({ tone: "warn", text: "Stopping LLM translation and clearing the queued job." });
  }

  async function refreshModels(): Promise<string[]> {
    setLoadingModels(true);
    try {
      const models = await listLlmModels(llmSettings);
      setAvailableModels(models);
      setStatus({
        tone: models.length ? "ok" : "warn",
        text: models.length ? `Loaded ${models.length} model(s).` : "No models returned by endpoint.",
      });
      return models;
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
      return [];
    } finally {
      setLoadingModels(false);
    }
  }

  async function animateLlmCandidateValue(id: EntryId, value: string, initialValue = "") {
    const token = llmDisplayAnimationRef.current + 1;
    llmDisplayAnimationRef.current = token;
    const startedAt = window.performance.now();
    const durationMs = draftAnimationDurationMs(draftTargetDeltaCharCount(initialValue, value), { complete: true });
    let visible = initialValue;
    setLlmCandidateDisplayDrafts((current) => ({ ...current, [id]: visible }));
    while (visible !== value) {
      const timestamp = await nextAnimationFrame();
      if (llmDisplayAnimationRef.current !== token) {
        return;
      }
      visible = animatedDraftTextAtElapsed(initialValue, value, timestamp - startedAt, durationMs);
      setLlmCandidateDisplayDrafts((current) => ({ ...current, [id]: visible }));
    }
    await delay(LLM_CANDIDATE_HOLD_MS);
    if (llmDisplayAnimationRef.current !== token) {
      return;
    }
    setLlmCandidateDisplayDrafts((current) => removeDraft(current, id));
  }

  async function translateJobs(
    jobs: LlmJob[],
    label = "LLM translation",
    options: TranslateJobsOptions = {},
  ) {
    if (jobs.length === 0) {
      setStatus({ tone: "warn", text: "No translation jobs." });
      return;
    }
    clearAllLiveDraftAnimations();
    const initialLiveOutputs =
      options.seedLiveOutput && jobs.length === 1
        ? [{ id: makeEntryId(jobs[0].namespace, jobs[0].targetLocale, jobs[0].key), text: "", updatedAt: Date.now() }]
        : [];
    const control: TranslationControl = { paused: false, stopped: false, abortControllers: new Set() };
    translationControlRef.current = control;
    setTranslating(true);
    setLlmWarnings([]);
    setTranslationProgress({
      label,
      status: "running",
      total: jobs.length,
      completed: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      warningCount: 0,
      liveOutputs: initialLiveOutputs,
      showPanel: options.showProgressPanel ?? true,
    });
    await yieldToBrowser();
    let completed = 0;
    const completedIds = new Set<EntryId>();
    const warnings: string[] = [];
    try {
      let nextProject = project;
      const jobChunks = chunksByTargetLocale(jobs, settings.llmBatchSize);
      const concurrency = clamp(Math.round(settings.llmConcurrency) || 1, 1, 12);
      let nextChunkIndex = 0;

      function updateProgress(update: (current: TranslationProgress) => TranslationProgress) {
        setTranslationProgress((current) => (current ? update(current) : current));
      }

      function setLiveOutputText(id: EntryId, text: string) {
        updateProgress((current) => ({
          ...current,
          updatedAt: Date.now(),
          liveOutputs: upsertLiveOutput(current.liveOutputs, { id, text, updatedAt: Date.now() }),
        }));
      }

      function scheduleLiveOutputAnimation(id: EntryId) {
        const animation = liveDraftAnimationsRef.current.get(id);
        if (!animation || animation.frame !== null || animation.visible === animation.target) {
          return;
        }
        animation.frame = window.requestAnimationFrame((timestamp) => {
          const currentAnimation = liveDraftAnimationsRef.current.get(id);
          if (!currentAnimation) {
            return;
          }
          currentAnimation.frame = null;
          if (control.stopped || completedIds.has(id)) {
            clearLiveDraftAnimation(id);
            return;
          }
          currentAnimation.visible = animatedDraftTextAtElapsed(
            currentAnimation.from,
            currentAnimation.target,
            timestamp - currentAnimation.startedAt,
            currentAnimation.durationMs,
          );
          setLiveOutputText(id, currentAnimation.visible);
          scheduleLiveOutputAnimation(id);
        });
      }

      function updateLiveOutput(id: EntryId, text: string) {
        const animation = liveDraftAnimationsRef.current.get(id);
        const visible = animation?.visible ?? "";
        if (animation?.frame != null) {
          window.cancelAnimationFrame(animation.frame);
        }
        const previousTarget = animation?.target ?? visible;
        const startedAt = window.performance.now();
        const durationMs = draftAnimationDurationMs(draftTargetDeltaCharCount(previousTarget, text));
        if (animation) {
          animation.from = visible;
          animation.target = text;
          animation.startedAt = startedAt;
          animation.durationMs = durationMs;
          animation.frame = null;
        } else {
          liveDraftAnimationsRef.current.set(id, {
            from: visible,
            target: text,
            visible,
            startedAt,
            durationMs,
            frame: null,
          });
          setLiveOutputText(id, visible);
        }
        scheduleLiveOutputAnimation(id);
      }

      function removeLiveOutput(id: EntryId) {
        clearLiveDraftAnimation(id);
        updateProgress((current) => ({
          ...current,
          updatedAt: Date.now(),
          liveOutputs: current.liveOutputs.filter((output) => output.id !== id),
        }));
      }

      function finishItem(id: EntryId) {
        if (completedIds.has(id)) {
          removeLiveOutput(id);
          return;
        }
        completedIds.add(id);
        clearLiveDraftAnimation(id);
        completed = completedIds.size;
        updateProgress((current) => ({
          ...current,
          status: "running",
          completed,
          updatedAt: Date.now(),
          warningCount: warnings.length,
          liveOutputs: current.liveOutputs.filter((output) => output.id !== id),
        }));
      }

      function addWarning(warning: string) {
        warnings.push(warning);
        setLlmWarnings([...warnings]);
        updateProgress((current) => ({
          ...current,
          updatedAt: Date.now(),
          warningCount: warnings.length,
        }));
      }

      async function runWorker() {
        while (!control.stopped) {
          await waitForTranslationResume(control);
          if (control.stopped) {
            throw new TranslationStoppedError();
          }
          const chunk = jobChunks[nextChunkIndex];
          nextChunkIndex += 1;
          if (!chunk) {
            return;
          }
          const abortController = new AbortController();
          control.abortControllers.add(abortController);
          try {
            await translateJobsWithLlm(llmSettings, chunk, modScan.translations, sourcePacks, runtimePhraseMappings, {
              signal: abortController.signal,
              fallbackChains: settings.fallbackChains,
              convertSources: settings.convertSources,
              warnFormattingCodeMismatch: settings.warnFormattingCodeMismatch,
              onDraft: (id, text) => updateLiveOutput(id, text),
              onPatch: (id, patch) => {
                const candidateSeed = options.animateSingleCandidate ? clearLiveDraftAnimation(id) : "";
                if (options.animateSingleCandidate) {
                  void animateLlmCandidateValue(id, patch.value, candidateSeed);
                }
                nextProject = mergeLlmPatches(nextProject, { [id]: patch });
                setProject(nextProject);
              },
              onWarning: addWarning,
              onItemComplete: finishItem,
            });
          } finally {
            control.abortControllers.delete(abortController);
          }
          if (control.stopped) {
            throw new TranslationStoppedError();
          }
          await yieldToBrowser();
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, jobChunks.length) }, () => runWorker());
      try {
        await Promise.all(workers);
      } catch (error) {
        control.stopped = true;
        for (const abortController of control.abortControllers) {
          abortController.abort();
        }
        await Promise.allSettled(workers);
        throw error;
      }
      setProject(nextProject);
      setLlmWarnings(warnings);
      setStatus({
        tone: warnings.length ? "warn" : "ok",
        text: warnings.length ? `LLM finished with ${warnings.length} warning(s).` : `LLM translated ${jobs.length} item(s).`,
      });
    } catch (error) {
      if (error instanceof TranslationStoppedError || isAbortError(error)) {
        setStatus({ tone: "warn", text: `LLM translation stopped. Queued work was cleared after ${completed.toLocaleString()} item(s).` });
      } else {
        setStatus({ tone: "error", text: errorMessage(error) });
      }
    } finally {
      clearAllLiveDraftAnimations();
      translationControlRef.current = { paused: false, stopped: false, abortControllers: new Set() };
      setTranslating(false);
      setTranslationProgress(null);
    }
  }

  return {
    translating,
    translationProgress,
    llmCandidateDisplayDrafts,
    llmWarnings,
    setLlmWarnings,
    loadingModels,
    availableModels,
    refreshModels,
    translateJobs,
    pauseTranslationJob,
    resumeTranslationJob,
    stopTranslationJob,
  };
}
