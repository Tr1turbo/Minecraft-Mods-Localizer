import { useCallback, useRef, useState, useEffect, type Dispatch, type SetStateAction } from "react";

import { BROWSER_DRAFT_SCHEMA_VERSION, DRAFT_AUTOSAVE_DELAY_MS, EMPTY_SCAN } from "../constants";
import {
  errorMessage,
  formatDraftTime,
  isEntryDraftRecord,
  isLocaleCodeValue,
  isPageId,
  normalizeProjectDraft,
  restoreDraftState,
} from "../helpers";
import type { BrowserDraftState, PageId, StatusMessage } from "../types";
import {
  readBrowserDraftModFiles,
  readBrowserDraftSnapshot,
  writeBrowserDraftModFiles,
  writeBrowserDraftSnapshot,
} from "../../lib/browserDraft";
import {
  type AppSettings,
  type DeploymentDefaults,
  type SourceLabelSettings,
  loadDeploymentConfig,
  mergeAppSettings,
  mergeLlmSettings,
} from "../../lib/deploymentConfig";
import type { LlmSettings } from "../../lib/llm";
import type { EntryId, LangpackProjectPatch, LocaleCode, ModScanResult, SourcePackScanResult } from "../../lib/types";

interface UseBrowserDraftPersistenceOptions {
  draftState: BrowserDraftState;
  hasRestorableProgress: boolean;
  busy: boolean;
  translating: boolean;
  modFiles: File[];
  setModFiles: Dispatch<SetStateAction<File[]>>;
  setModScan: Dispatch<SetStateAction<ModScanResult>>;
  setSourcePacks: Dispatch<SetStateAction<SourcePackScanResult[]>>;
  setProject: Dispatch<SetStateAction<LangpackProjectPatch>>;
  setActiveLocale: Dispatch<SetStateAction<LocaleCode>>;
  setActivePage: Dispatch<SetStateAction<PageId>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setReferenceLocale: Dispatch<SetStateAction<string>>;
  setReferenceFallbackLocale: Dispatch<SetStateAction<string>>;
  setSelectedKey: Dispatch<SetStateAction<string>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setInlineDrafts: Dispatch<SetStateAction<Record<EntryId, string>>>;
  setLlmSettings: Dispatch<SetStateAction<LlmSettings>>;
  setLlmWarnings: Dispatch<SetStateAction<string[]>>;
  setDeploymentDefaults: Dispatch<SetStateAction<DeploymentDefaults>>;
  setSourceLabels: Dispatch<SetStateAction<SourceLabelSettings>>;
  setStatus: Dispatch<SetStateAction<StatusMessage>>;
}

export function useBrowserDraftPersistence({
  draftState,
  hasRestorableProgress,
  busy,
  translating,
  modFiles,
  setModFiles,
  setModScan,
  setSourcePacks,
  setProject,
  setActiveLocale,
  setActivePage,
  setSettings,
  setReferenceLocale,
  setReferenceFallbackLocale,
  setSelectedKey,
  setQuery,
  setInlineDrafts,
  setLlmSettings,
  setLlmWarnings,
  setDeploymentDefaults,
  setSourceLabels,
  setStatus,
}: UseBrowserDraftPersistenceOptions) {
  const [draftHydrated, setDraftHydrated] = useState(false);
  const restoredManualDraftRef = useRef<{ entryId: EntryId; value: string } | null>(null);
  const draftSaveWarningShownRef = useRef(false);
  const lastSavedModFileKeyRef = useRef("");
  const autosavePausedRef = useRef(false);

  const reportDraftSaveError = useCallback(
    (error: unknown) => {
      if (draftSaveWarningShownRef.current) {
        return;
      }
      draftSaveWarningShownRef.current = true;
      setStatus({ tone: "warn", text: `Browser autosave failed: ${errorMessage(error)}` });
    },
    [setStatus],
  );

  const resetSavedModFileKey = useCallback(() => {
    lastSavedModFileKeyRef.current = "";
  }, []);

  const pauseAutosave = useCallback(() => {
    autosavePausedRef.current = true;
    draftSaveWarningShownRef.current = false;
  }, []);

  const resumeAutosave = useCallback(() => {
    autosavePausedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeApp() {
      const defaults = await loadDeploymentConfig();
      let nextSettings = defaults.settings;
      let nextLlmSettings = defaults.llmSettings;
      let nextModFiles: File[] = [];

      try {
        const [draft, restoredModFiles] = await Promise.all([readBrowserDraftSnapshot<BrowserDraftState>(), readBrowserDraftModFiles()]);
        if (cancelled) {
          return;
        }
        setDeploymentDefaults(defaults);
        setSourceLabels(defaults.sourceLabels);
        if (draft?.data.schemaVersion === BROWSER_DRAFT_SCHEMA_VERSION) {
          const restoredProject = normalizeProjectDraft(draft.data.project);
          restoreDraftState(draft.data, restoredManualDraftRef);
          setModScan(draft.data.modScan ?? EMPTY_SCAN);
          setSourcePacks(Array.isArray(draft.data.sourcePacks) ? draft.data.sourcePacks : []);
          setProject(restoredProject);
          setActiveLocale(isLocaleCodeValue(draft.data.activeLocale) ? draft.data.activeLocale : "");
          setActivePage(isPageId(draft.data.activePage) ? draft.data.activePage : "project");
          nextSettings = mergeAppSettings(draft.data.settings, defaults.settings);
          if (nextSettings.targetLocales.length === 0 && restoredProject.locales.length > 0) {
            nextSettings = {
              ...nextSettings,
              targetLocales: [...restoredProject.locales],
              fallbackChains: { ...restoredProject.fallbackChains },
            };
          }
          const restoredReferenceLocale = typeof draft.data.referenceLocale === "string" ? draft.data.referenceLocale : "en_us";
          const restoredFallbackLocale =
            typeof draft.data.referenceFallbackLocale === "string" && nextSettings.targetLocales.includes(draft.data.referenceFallbackLocale)
              ? draft.data.referenceFallbackLocale
              : nextSettings.targetLocales.includes(restoredReferenceLocale)
                ? restoredReferenceLocale
                : "";
          setReferenceLocale(restoredReferenceLocale);
          setReferenceFallbackLocale(restoredFallbackLocale);
          setSelectedKey(typeof draft.data.selectedKey === "string" ? draft.data.selectedKey : "");
          setQuery(typeof draft.data.query === "string" ? draft.data.query : "");
          setInlineDrafts(isEntryDraftRecord(draft.data.inlineDrafts) ? draft.data.inlineDrafts : {});
          nextLlmSettings = mergeLlmSettings(defaults.llmSettings, draft.data.llmSettings);
          setLlmWarnings(Array.isArray(draft.data.llmWarnings) ? draft.data.llmWarnings : []);
          setStatus({ tone: "ok", text: `Restored browser draft from ${formatDraftTime(draft.savedAt)}.` });
        }
        nextModFiles = restoredModFiles;
      } catch (error) {
        if (!cancelled) {
          setDeploymentDefaults(defaults);
          setSourceLabels(defaults.sourceLabels);
          setStatus({ tone: "error", text: `Browser draft restore failed: ${errorMessage(error)}` });
        }
      } finally {
        if (!cancelled) {
          setSettings(nextSettings);
          setLlmSettings(nextLlmSettings);
          setModFiles(nextModFiles);
          setDraftHydrated(true);
        }
      }
    }

    void initializeApp();
    return () => {
      cancelled = true;
    };
  }, [
    setActiveLocale,
    setActivePage,
    setDeploymentDefaults,
    setInlineDrafts,
    setLlmSettings,
    setLlmWarnings,
    setModFiles,
    setModScan,
    setProject,
    setQuery,
    setReferenceFallbackLocale,
    setReferenceLocale,
    setSelectedKey,
    setSettings,
    setSourceLabels,
    setSourcePacks,
    setStatus,
  ]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    if (autosavePausedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      void writeBrowserDraftSnapshot(draftState).catch(reportDraftSaveError);
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, draftState, reportDraftSaveError]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const saveNow = () => {
      if (autosavePausedRef.current) {
        return;
      }
      void writeBrowserDraftSnapshot(draftState).catch(reportDraftSaveError);
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
      }
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [draftHydrated, draftState, reportDraftSaveError]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const fileKey = modFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("\n");
    if (fileKey === lastSavedModFileKeyRef.current) {
      return;
    }
    lastSavedModFileKeyRef.current = fileKey;
    if (autosavePausedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      void writeBrowserDraftModFiles(modFiles).catch(reportDraftSaveError);
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, modFiles, reportDraftSaveError]);

  useEffect(() => {
    if (!draftHydrated || (!hasRestorableProgress && !busy && !translating)) {
      return;
    }
    const confirmLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [busy, draftHydrated, hasRestorableProgress, translating]);

  return {
    draftHydrated,
    pauseAutosave,
    resetSavedModFileKey,
    resumeAutosave,
    restoredManualDraftRef,
  };
}
