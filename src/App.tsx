import {
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FileJson,
  Loader2,
  Package,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  Settings,
  Square,
  TriangleAlert,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import {
  createContext,
  type ChangeEvent,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createResourcePackZip } from "./lib/exportPack";
import { placeholderWarnings } from "./lib/placeholders";
import {
  effectivePhraseMappings,
  isBuiltinPhraseMapping,
  joinPhraseTerms,
  normalizePhraseMappingOverrides,
  phraseMappingOverrideFromMapping,
  phraseMappingsWithInternalVanilla,
  selectPhraseMappingsForReference,
  splitPhraseTerms,
} from "./lib/phraseMappings";
import {
  buildCatalog,
  createEmptyProjectPatch,
  createPatchValue,
  normalizeProjectPatch,
  resolveLlmReferenceValues,
  resolveReferenceValuesForKey,
  revertManualKey,
  revertManualNamespace,
} from "./lib/patches";
import { downloadBlob, projectPatchBlob, readProjectPatchFile } from "./lib/projectFile";
import { scanModJars, scanResourcePack } from "./lib/scanner";
import type {
  CatalogRow,
  CandidateValue,
  EntryId,
  LangpackProjectPatch,
  LocaleCode,
  ModScanResult,
  PatchValue,
  PhraseMapping,
  ReferenceValue,
  ResolvedEntry,
  SourceKind,
  SourcePackScanResult,
} from "./lib/types";
import { BUNDLED_LOCALE_CODES, CHINESE_LOCALES, isChineseLocale, isValidLocaleCode, normalizeLocaleCode, uniqueLocaleCodes } from "./lib/locales";
import {
  listLlmModels,
  mergeLlmPatches,
  translateJobsWithLlm,
  type LlmJob,
  type LlmSettings,
} from "./lib/llm";
import {
  CONVERT_SOURCE_ORDER,
  LLM_REFERENCE_MODES,
  SOURCE_LABEL_ORDER,
  SOURCE_TRANSLATE_TARGET_ORDER,
  type AppSettings,
  type DeploymentDefaults,
  type PersistedLlmSettings,
  type SourceLabelSettings,
  clamp,
  createDefaultAppSettings,
  createDefaultDeploymentDefaults,
  createDefaultLlmSettings,
  createDefaultSourceLabels,
  loadDeploymentConfig,
  mergeAppSettings,
  mergeLlmSettings,
  normalizeFallbackChain,
} from "./lib/deploymentConfig";
import { createPatchedJarDownload } from "./lib/exportJars";
import {
  clearBrowserDraftModFiles,
  readBrowserDraftModFiles,
  readBrowserDraftSnapshot,
  writeBrowserDraftModFiles,
  writeBrowserDraftSnapshot,
} from "./lib/browserDraft";

const EMPTY_SCAN: ModScanResult = {
  fingerprints: [],
  translations: {},
  warnings: [],
};

type StatusTone = "idle" | "ok" | "warn" | "error";
type PageId = "project" | "sources" | "settings" | `namespace:${string}`;
type ProjectMode = AppSettings["projectMode"];
type SourcePackMode = AppSettings["sourcePackMode"];

interface StatusMessage {
  tone: StatusTone;
  text: string;
}

type TableItem =
  | { kind: "divider"; id: string; prefix: string }
  | { kind: "entry"; row: CatalogRow; displayKey: string };

type DiffSegment = { text: string; kind: "same" | "added" };
type TranslationJobStatus = "running" | "paused" | "stopping";

interface TranslationProgress {
  label: string;
  status: TranslationJobStatus;
  total: number;
  completed: number;
  startedAt: number;
  updatedAt: number;
  warningCount: number;
}

interface TranslationControl {
  paused: boolean;
  stopped: boolean;
  abortControllers: Set<AbortController>;
}

interface BrowserDraftState {
  schemaVersion: 1;
  modScan: ModScanResult;
  sourcePacks: SourcePackScanResult[];
  project: LangpackProjectPatch;
  activeLocale: LocaleCode;
  activePage: PageId;
  settings: AppSettings;
  referenceLocale: string;
  referenceFallbackLocale: string;
  selectedKey: string;
  query: string;
  manualDraft: string;
  manualDraftEntryId: EntryId | "";
  inlineDrafts: Record<EntryId, string>;
  llmSettings: PersistedLlmSettings;
  llmWarnings: string[];
}

const BROWSER_DRAFT_SCHEMA_VERSION = 1;
const DRAFT_AUTOSAVE_DELAY_MS = 700;
const SourceLabelContext = createContext<SourceLabelSettings>(createDefaultSourceLabels());

function App() {
  const [modScan, setModScan] = useState<ModScanResult>(EMPTY_SCAN);
  const [modFiles, setModFiles] = useState<File[]>([]);
  const [sourcePacks, setSourcePacks] = useState<SourcePackScanResult[]>([]);
  const [project, setProject] = useState<LangpackProjectPatch>(() => createEmptyProjectPatch());
  const [activeLocale, setActiveLocale] = useState<LocaleCode>("");
  const [activePage, setActivePage] = useState<PageId>("project");
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultAppSettings());
  const [resizingInspector, setResizingInspector] = useState(false);
  const [referenceLocale, setReferenceLocale] = useState("en_us");
  const [referenceFallbackLocale, setReferenceFallbackLocale] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [manualDraft, setManualDraft] = useState("");
  const [inlineDrafts, setInlineDrafts] = useState<Record<EntryId, string>>({});
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [llmWarnings, setLlmWarnings] = useState<string[]>([]);
  const translationControlRef = useRef<TranslationControl>({ paused: false, stopped: false, abortControllers: new Set() });
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMessage>({ tone: "idle", text: "Ready" });
  const [deploymentDefaults, setDeploymentDefaults] = useState<DeploymentDefaults>(() => createDefaultDeploymentDefaults());
  const [sourceLabels, setSourceLabels] = useState<SourceLabelSettings>(() => createDefaultSourceLabels());
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => createDefaultLlmSettings());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const restoredManualDraftRef = useRef<{ entryId: EntryId; value: string } | null>(null);
  const draftSaveWarningShownRef = useRef(false);
  const lastSavedModFileKeyRef = useRef("");

  const phraseMappings = useMemo(() => effectivePhraseMappings(project.phraseMappings), [project.phraseMappings]);
  const runtimePhraseMappings = useMemo(() => phraseMappingsWithInternalVanilla(phraseMappings), [phraseMappings]);
  const rows = useMemo(
    () =>
      buildCatalog(
        modScan.translations,
        sourcePacks,
        project,
        settings.fallbackChains,
        runtimePhraseMappings,
        settings.convertSources,
        settings.targetLocales,
      ),
    [
      modScan.translations,
      sourcePacks,
      project,
      settings.fallbackChains,
      runtimePhraseMappings,
      settings.convertSources,
      settings.targetLocales,
    ],
  );
  const namespaces = useMemo(() => Array.from(new Set(rows.map((row) => row.namespace))).sort(), [rows]);
  const activeNamespace = activePage.startsWith("namespace:") ? activePage.slice("namespace:".length) : "";
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const namespaceMatches = activeNamespace ? row.namespace === activeNamespace : false;
        const normalizedQuery = query.trim().toLowerCase();
        const activeEntry = activeLocale ? row.entries[activeLocale] : undefined;
        const queryMatches =
          !normalizedQuery ||
          row.key.toLowerCase().includes(normalizedQuery) ||
          (activeEntry?.sourceValue ?? row.sourceValue).toLowerCase().includes(normalizedQuery) ||
          (activeEntry?.final.value ?? "").toLowerCase().includes(normalizedQuery);
        return namespaceMatches && queryMatches;
      }),
    [activeLocale, activeNamespace, query, rows],
  );
  const namespaceRows = useMemo(
    () => (activeNamespace ? rows.filter((row) => row.namespace === activeNamespace) : []),
    [activeNamespace, rows],
  );
  const tableItems = useMemo(() => groupTableRows(filteredRows), [filteredRows]);
  const namespaceMissingCount = useMemo(
    () => translationJobsForRows(namespaceRows, activeLocale, settings, modScan.translations, sourcePacks, project).length,
    [activeLocale, modScan.translations, namespaceRows, project, settings, sourcePacks],
  );
  const allMissingCount = useMemo(
    () => translationJobsForRows(rows, activeLocale, settings, modScan.translations, sourcePacks, project).length,
    [activeLocale, modScan.translations, project, rows, settings, sourcePacks],
  );
  const selectedRow = filteredRows.find((row) => rowId(row) === selectedKey) ?? filteredRows[0];
  const selectedEntry = activeLocale ? selectedRow?.entries[activeLocale] : undefined;
  const manualWarnings = selectedEntry ? placeholderWarnings(selectedEntry.sourceValue, manualDraft) : [];
  const manualDiffSegments = useMemo(
    () => diffTextAgainstBase(selectedEntry?.base.value ?? "", manualDraft),
    [manualDraft, selectedEntry?.base.value],
  );
  const hasManualPatch = isManualEntryPatch(selectedEntry);
  const selectedLlmCandidates = selectedEntry ? (project.llmCandidates?.[selectedEntry.id] ?? []) : [];
  const hasUnsavedPatchEdit = Boolean(selectedEntry && manualDraft !== (selectedEntry.patch?.value ?? selectedEntry.final.value));
  const selectedReferenceValues = useMemo(
    () =>
      selectedRow
        ? resolveReferenceValuesForKey(modScan.translations, sourcePacks, project, selectedRow.namespace, selectedRow.key)
        : [],
    [modScan.translations, project, selectedRow, sourcePacks],
  );
  const selectedReference = resolveVisibleReferenceValue(selectedReferenceValues, referenceLocale, referenceFallbackLocale);
  const selectedReferenceValue = selectedReference?.value ?? "";
  const selectedPhraseMatches = useMemo(
    () =>
      selectedRow
      && isChineseLocale(activeLocale)
        ? selectPhraseMappingsForReference({ key: selectedRow.key, value: selectedReferenceValue }, runtimePhraseMappings)
        : [],
    [activeLocale, runtimePhraseMappings, selectedReferenceValue, selectedRow],
  );
  const stats = useMemo(() => buildStats(rows, activeLocale, project), [activeLocale, project, rows]);
  const draftState = useMemo<BrowserDraftState>(
    () => ({
      schemaVersion: BROWSER_DRAFT_SCHEMA_VERSION,
      modScan,
      sourcePacks,
      project,
      activeLocale,
      activePage,
      settings,
      referenceLocale,
      referenceFallbackLocale,
      selectedKey,
      query,
      manualDraft,
      manualDraftEntryId: selectedEntry?.id ?? "",
      inlineDrafts,
      llmSettings: persistedLlmSettings(llmSettings),
      llmWarnings,
    }),
    [
      activeLocale,
      activePage,
      inlineDrafts,
      llmSettings,
      llmWarnings,
      manualDraft,
      modScan,
      project,
      query,
      referenceFallbackLocale,
      referenceLocale,
      selectedEntry?.id,
      selectedKey,
      settings,
      sourcePacks,
    ],
  );
  const hasRestorableProgress = useMemo(
    () =>
      modScan.fingerprints.length > 0 ||
      sourcePacks.length > 0 ||
      Object.keys(project.patches ?? {}).length > 0 ||
      Object.keys(project.llmCandidates ?? {}).length > 0 ||
      Object.keys(project.phraseMappings ?? {}).length > 0 ||
      Object.keys(inlineDrafts).length > 0 ||
      Boolean(selectedEntry && manualDraft !== (selectedEntry.patch?.value ?? selectedEntry.final.value)),
    [inlineDrafts, manualDraft, modScan.fingerprints.length, project, selectedEntry, sourcePacks.length],
  );

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
  }, []);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const timer = window.setTimeout(() => {
      void writeBrowserDraftSnapshot(draftState).catch(reportDraftSaveError);
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, draftState]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const saveNow = () => {
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
  }, [draftHydrated, draftState]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const fileKey = modFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("\n");
    if (fileKey === lastSavedModFileKeyRef.current) {
      return;
    }
    lastSavedModFileKeyRef.current = fileKey;
    const timer = window.setTimeout(() => {
      void writeBrowserDraftModFiles(modFiles).catch(reportDraftSaveError);
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, modFiles]);

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

  function reportDraftSaveError(error: unknown) {
    if (draftSaveWarningShownRef.current) {
      return;
    }
    draftSaveWarningShownRef.current = true;
    setStatus({ tone: "warn", text: `Browser autosave failed: ${errorMessage(error)}` });
  }

  useEffect(() => {
    if (activePage.startsWith("namespace:") && activeNamespace && !namespaces.includes(activeNamespace)) {
      setActivePage(namespaces.length > 0 ? `namespace:${namespaces[0]}` : "project");
    }
  }, [activeNamespace, activePage, namespaces]);

  useEffect(() => {
    if (settings.targetLocales.length === 0) {
      if (activeLocale) {
        setActiveLocale("");
      }
      return;
    }
    if (!settings.targetLocales.includes(activeLocale)) {
      setActiveLocale(settings.targetLocales[0]);
    }
  }, [activeLocale, settings.targetLocales]);

  useEffect(() => {
    if (settings.targetLocales.length === 0) {
      if (referenceFallbackLocale) {
        setReferenceFallbackLocale("");
      }
      return;
    }
    if (!settings.targetLocales.includes(referenceFallbackLocale)) {
      setReferenceFallbackLocale(activeLocale && settings.targetLocales.includes(activeLocale) ? activeLocale : settings.targetLocales[0]);
    }
  }, [activeLocale, referenceFallbackLocale, settings.targetLocales]);

  useEffect(() => {
    if (!activePage.startsWith("namespace:")) {
      setSelectedKey("");
    }
  }, [activePage]);

  useEffect(() => {
    if (!selectedEntry) {
      setManualDraft("");
      return;
    }
    if (restoredManualDraftRef.current?.entryId === selectedEntry.id) {
      setManualDraft(restoredManualDraftRef.current.value);
      restoredManualDraftRef.current = null;
      return;
    }
    setManualDraft(selectedEntry.patch?.value ?? selectedEntry.final.value);
  }, [selectedEntry?.id, selectedEntry?.patch?.value, selectedEntry?.final.value]);

  async function handleModFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    await runBusy(`Scanned ${files.length} mod file(s).`, async () => {
      const scan = await scanModJars(files);
      setModFiles(files);
      setModScan(scan);
      setProject((current) => ({ ...current, modFingerprints: scan.fingerprints }));
      if (scan.warnings.length) {
        setStatus({ tone: "warn", text: `Scanned with ${scan.warnings.length} warning(s).` });
      }
    });
  }

  async function handleSourcePackFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    await runBusy(`Added ${files.length} source pack(s).`, async () => {
      const scanned = await Promise.all(files.map((file) => scanResourcePack(file)));
      const next = [...sourcePacks, ...scanned];
      setSourcePacks(next);
      setProject((current) => ({ ...current, sourcePackOrder: next.map((pack) => pack.fingerprint) }));
      const warningCount = scanned.reduce((total, pack) => total + pack.warnings.length, 0);
      if (warningCount) {
        setStatus({ tone: "warn", text: `Added source packs with ${warningCount} warning(s).` });
      }
    });
  }

  async function handleProjectPatch(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await runBusy("Loaded project patch.", async () => {
      const loadedProject = await readProjectPatchFile(file);
      setProject(loadedProject);
      setSettings((current) => ({
        ...current,
        targetLocales: [...loadedProject.locales],
        fallbackChains: { ...loadedProject.fallbackChains },
      }));
    });
  }

  function moveSourcePack(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= sourcePacks.length) {
      return;
    }
    const next = [...sourcePacks];
    [next[index], next[target]] = [next[target], next[index]];
    setSourcePacks(next);
    setProject((current) => ({ ...current, sourcePackOrder: next.map((pack) => pack.fingerprint) }));
  }

  function removeSourcePack(index: number) {
    const next = sourcePacks.filter((_, currentIndex) => currentIndex !== index);
    setSourcePacks(next);
    setProject((current) => ({ ...current, sourcePackOrder: next.map((pack) => pack.fingerprint) }));
  }

  async function saveManualPatch() {
    if (!selectedEntry) {
      return;
    }
    await saveManualPatchForEntry(selectedEntry, manualDraft);
  }

  function revertSelectedManualPatch() {
    if (!selectedEntry) {
      return;
    }
    setProject((current) => revertManualKey(current, selectedEntry.id));
    setStatus({ tone: "ok", text: "Manual patch reverted." });
  }

  function useLlmCandidate(candidate: PatchValue) {
    if (!selectedEntry) {
      return;
    }
    if (hasUnsavedPatchEdit) {
      setStatus({ tone: "warn", text: "Save or revert the current patch edit before switching LLM output." });
      return;
    }
    if (isManualEntryPatch(selectedEntry) && selectedEntry.patch?.value !== candidate.value) {
      setStatus({ tone: "warn", text: "Revert the current manual patch before switching LLM output." });
      return;
    }
    setProject((current) => ({
      ...current,
      patches: {
        ...(current.patches ?? {}),
        [selectedEntry.id]: candidate,
      },
    }));
    setManualDraft(candidate.value);
    setStatus({ tone: "ok", text: "LLM output selected." });
  }

  async function deleteLlmCandidate(candidate: PatchValue, candidateIndex: number) {
    if (!selectedEntry) {
      return;
    }
    if (hasUnsavedPatchEdit) {
      setStatus({ tone: "warn", text: "Save or revert the current patch edit before deleting LLM output." });
      return;
    }
    const activeCandidate = isActiveLlmCandidate(selectedEntry.patch, candidate, candidateIndex);
    const flattenedPatch = activeCandidate
      ? await createPatchValue(candidate.value, parentUnderManual(selectedEntry), { generatedBy: "manual" })
      : undefined;

    setProject((current) => {
      const nextCandidates = { ...(current.llmCandidates ?? {}) };
      const candidates = [...(nextCandidates[selectedEntry.id] ?? [])];
      candidates.splice(candidateIndex, 1);
      if (candidates.length) {
        nextCandidates[selectedEntry.id] = candidates;
      } else {
        delete nextCandidates[selectedEntry.id];
      }

      const nextPatches = { ...(current.patches ?? {}) };
      if (flattenedPatch) {
        nextPatches[selectedEntry.id] = flattenedPatch;
      }

      return {
        ...current,
        llmCandidates: nextCandidates,
        patches: nextPatches,
      };
    });
    if (flattenedPatch) {
      setManualDraft(flattenedPatch.value);
    }
    setStatus({
      tone: "ok",
      text: flattenedPatch ? "LLM output deleted and flattened into a manual patch." : "LLM output deleted.",
    });
  }

  async function saveManualPatchForEntry(entry: ResolvedEntry | undefined, value: string, options: { quiet?: boolean } = {}) {
    if (!entry) {
      return;
    }
    const parent = parentUnderManual(entry);
    const patch = await createPatchValue(value, parent);
    setProject((current) => ({
      ...current,
      patches: {
        ...(current.patches ?? {}),
        [entry.id]: {
          ...patch,
          meta: { ...patch.meta, generatedBy: "manual" },
        },
      },
    }));
    setInlineDrafts((current) => removeDraft(current, entry.id));
    const warnings = placeholderWarnings(entry.sourceValue, value);
    setStatus({
      tone: warnings.length ? "warn" : "ok",
      text: warnings.length ? `Manual patch saved with warning: ${warnings[0]}` : options.quiet ? "Inline edit saved." : "Manual patch saved.",
    });
  }

  function revertNamespaceManualPatches() {
    const namespace = selectedRow?.namespace ?? activeNamespace;
    if (!namespace) {
      return;
    }
    setProject((current) => revertManualNamespace(current, namespace));
    setStatus({ tone: "ok", text: "Namespace manual patches reverted." });
  }

  async function translateSelected() {
    const job = selectedEntry ? llmJobForEntry(selectedEntry, settings, modScan.translations, sourcePacks, project) : undefined;
    if (!job) {
      setStatus({ tone: "warn", text: "No selected source value." });
      return;
    }
    await translateJobs([job], "Selected key");
  }

  async function translateNamespace() {
    if (!activeNamespace) {
      return;
    }
    if (!activeLocale) {
      setStatus({ tone: "warn", text: "Add a target locale before translating." });
      return;
    }
    const jobs = translationJobsForRows(namespaceRows, activeLocale, settings, modScan.translations, sourcePacks, project);
    if (jobs.length === 0) {
      setStatus({ tone: "warn", text: "No untranslated keys on this page." });
      return;
    }
    await translateJobs(jobs, `${activeNamespace} ${activeLocale}`);
  }

  async function translateAll() {
    if (!activeLocale) {
      setStatus({ tone: "warn", text: "Add a target locale before translating." });
      return;
    }
    const jobs = translationJobsForRows(rows, activeLocale, settings, modScan.translations, sourcePacks, project);
    if (jobs.length === 0) {
      setStatus({ tone: "warn", text: "No untranslated keys left." });
      return;
    }
    await translateJobs(jobs, `Project ${activeLocale}`);
  }

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

  function refreshConvertedValues() {
    setProject((current) => ({
      ...current,
      patches: Object.fromEntries(Object.entries(current.patches ?? {}).filter(([, patch]) => patch.meta?.generatedBy !== "converted")),
    }));
    setStatus({ tone: "ok", text: "Converted base values refreshed." });
  }

  async function translateJobs(jobs: LlmJob[], label = "LLM translation") {
    if (jobs.length === 0) {
      setStatus({ tone: "warn", text: "No translation jobs." });
      return;
    }
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
    });
    await yieldToBrowser();
    let completed = 0;
    const warnings: string[] = [];
    try {
      let nextProject = project;
      const jobChunks = chunks(jobs, settings.llmBatchSize);
      const concurrency = clamp(Math.round(settings.llmConcurrency) || 1, 1, 12);
      let nextChunkIndex = 0;

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
          let result;
          try {
            result = await translateJobsWithLlm(llmSettings, chunk, modScan.translations, sourcePacks, runtimePhraseMappings, {
              signal: abortController.signal,
              fallbackChains: settings.fallbackChains,
              convertSources: settings.convertSources,
            });
          } finally {
            control.abortControllers.delete(abortController);
          }
          if (control.stopped) {
            throw new TranslationStoppedError();
          }
          nextProject = mergeLlmPatches(nextProject, result.patches);
          warnings.push(...result.warnings);
          if (result.warnings.length) {
            setLlmWarnings([...warnings]);
          }
          completed += chunk.length;
          setProject(nextProject);
          setTranslationProgress((current) =>
            current
              ? {
                  ...current,
                  status: "running",
                  completed,
                  updatedAt: Date.now(),
                  warningCount: warnings.length,
                }
              : current,
          );
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
      translationControlRef.current = { paused: false, stopped: false, abortControllers: new Set() };
      setTranslating(false);
      setTranslationProgress(null);
    }
  }

  async function exportProjectPatch() {
    const exportProject: LangpackProjectPatch = {
      ...project,
      schemaVersion: 2,
      locales: [...settings.targetLocales],
      fallbackChains: { ...settings.fallbackChains },
      sourceLocalePriority: [],
      llmCandidates: project.llmCandidates ?? {},
      phraseMappings: project.phraseMappings ?? {},
      modFingerprints: modScan.fingerprints,
      sourcePackOrder: sourcePacks.map((pack) => pack.fingerprint),
    };
    downloadBlob(projectPatchBlob(exportProject), "minecraft-langpatch.json");
    setStatus({ tone: "ok", text: "Project patch exported." });
  }

  async function exportResourcePack() {
    if (rows.length === 0) {
      setStatus({ tone: "warn", text: settings.targetLocales.length === 0 ? "Add a target locale before exporting." : "Load mod jars before exporting." });
      return;
    }
    await runBusy("Resource pack zip exported.", async () => {
      const blob = await createResourcePackZip(rows, settings.targetLocales, {
        packFormat: settings.packFormat,
        description: `${settings.description}\nLocales: ${settings.targetLocales.join(", ")}`,
        sourcePacks,
        sourcePackMode: settings.sourcePackMode,
        skipSources: settings.exportSkipSources,
      });
      downloadBlob(blob, "Minecraft-Mods-Localizer.zip");
    });
  }

  async function exportPatchedJars() {
    if (modFiles.length === 0 || rows.length === 0) {
      setStatus({ tone: "warn", text: settings.targetLocales.length === 0 ? "Add a target locale before exporting patched jars." : "Load mod jars before exporting patched jars." });
      return;
    }
    let summary = "";
    await runBusy("Patched jar export created.", async () => {
      const result = await createPatchedJarDownload(modFiles, rows, settings.targetLocales, {
        skipSources: settings.exportSkipSources,
      });
      if (result.jars.length === 0) {
        const skippedText = result.skipped.length
          ? ` ${result.skipped.length.toLocaleString()} jar(s) were unreadable: ${result.skipped
              .slice(0, 3)
              .map((jar) => jar.filename)
              .join(", ")}.`
          : "";
        setStatus({ tone: "warn", text: `No loaded jar namespaces matched the current project rows.${skippedText}` });
        return;
      }
      downloadBlob(result.blob, result.filename);
      const langFileCount = result.jars.reduce((total, jar) => total + jar.langFilesWritten, 0);
      const entryCount = result.jars.reduce((total, jar) => total + jar.entriesWritten, 0);
      const skippedText = result.skipped.length ? ` Skipped ${result.skipped.length.toLocaleString()} unreadable jar(s).` : "";
      summary = `Exported ${result.jars.length.toLocaleString()} patched jar(s), ${langFileCount.toLocaleString()} lang file(s), ${entryCount.toLocaleString()} value(s).${skippedText}`;
    });
    if (summary) {
      setStatus({ tone: "ok", text: summary });
    }
  }

  async function clearLoadedJars() {
    const nextProject = { ...project, modFingerprints: [] };
    const nextPage: PageId = activePage.startsWith("namespace:") ? "project" : activePage;
    setBusy(true);
    try {
      await clearBrowserDraftModFiles();
      const nextDraftState: BrowserDraftState = {
        ...draftState,
        modScan: EMPTY_SCAN,
        project: nextProject,
        activePage: nextPage,
        selectedKey: "",
        manualDraft: "",
        manualDraftEntryId: "",
        inlineDrafts: {},
        referenceFallbackLocale: "",
      };
      await writeBrowserDraftSnapshot(nextDraftState);
      lastSavedModFileKeyRef.current = "";
      setModFiles([]);
      setModScan(EMPTY_SCAN);
      setProject(nextProject);
      setActivePage(nextPage);
      setSelectedKey("");
      setManualDraft("");
      setInlineDrafts({});
      setReferenceFallbackLocale("");
      setStatus({ tone: "ok", text: "Loaded jars cleared from this session and browser storage." });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runBusy(successText: string, work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      setStatus((current) => (current.tone === "warn" ? current : { tone: "ok", text: successText }));
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function resizeInspectorFromPointer(clientX: number, workspaceElement: HTMLElement | null) {
    const workspaceRect = workspaceElement?.getBoundingClientRect();
    const workspaceWidth = workspaceRect?.width ?? window.innerWidth;
    const workspaceRight = workspaceRect?.right ?? window.innerWidth;
    const maximumWidth = Math.max(320, Math.min(620, workspaceWidth - 238 - 390 - 8));
    const nextWidth = clamp(Math.round(workspaceRight - clientX - 4), 320, maximumWidth);
    setSettings((current) => ({ ...current, inspectorWidth: nextWidth }));
  }

  function startInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingInspector(true);
    resizeInspectorFromPointer(event.clientX, event.currentTarget.closest(".workspace") as HTMLElement | null);
  }

  function moveInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizingInspector && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    resizeInspectorFromPointer(event.clientX, event.currentTarget.closest(".workspace") as HTMLElement | null);
  }

  function stopInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingInspector(false);
  }

  function updateReferenceLocale(locale: LocaleCode) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale) {
      return;
    }
    setReferenceLocale(normalizedLocale);
    if (settings.targetLocales.includes(normalizedLocale)) {
      setReferenceFallbackLocale(normalizedLocale);
    }
  }

  const headerStatusText = translationProgress
    ? translationHeaderText(translationProgress)
    : busy || translating
      ? "Working..."
      : status.text;

  return (
    <SourceLabelContext.Provider value={sourceLabels}>
      <main className="appShell">
      <header className="topBar">
        <div>
          <h1>Minecraft Mods Localizer</h1>
          <div className={`statusLine ${status.tone}`}>{headerStatusText}</div>
        </div>
        <div className="topActions">
          <FilePicker label="Mods" accept=".jar" multiple onChange={handleModFiles} icon={<Upload size={16} />} />
          <FilePicker label="Update From" accept=".zip" multiple onChange={handleSourcePackFiles} icon={<Upload size={16} />} />
          <FilePicker label="Patch" accept=".json" onChange={handleProjectPatch} icon={<FileJson size={16} />} />
          <button type="button" onClick={exportProjectPatch}>
            <Download size={16} />
            Patch
          </button>
          <button type="button" className="primary" onClick={exportResourcePack}>
            <Download size={16} />
            Zip
          </button>
          <button type="button" onClick={exportPatchedJars}>
            <Download size={16} />
            Jars
          </button>
        </div>
      </header>

      <section
        className={`workspace ${resizingInspector ? "resizing" : ""}`}
        style={{ ["--inspector-width" as string]: `${settings.inspectorWidth}px` }}
      >
        <aside className="leftPane">
          <nav className="pageNav" aria-label="Pages">
            <button type="button" className={activePage === "project" ? "active" : ""} onClick={() => setActivePage("project")}>
              <Package size={16} />
              Project
            </button>
            <button type="button" className={activePage === "sources" ? "active" : ""} onClick={() => setActivePage("sources")}>
              <Upload size={16} />
              Update From
            </button>
            <button type="button" className={activePage === "settings" ? "active" : ""} onClick={() => setActivePage("settings")}>
              <Settings size={16} />
              Settings
            </button>
          </nav>

          <section className="namespaceNav">
            <div className="navSectionTitle">Namespaces</div>
            {namespaces.length === 0 ? (
              <div className="emptyState">{modScan.fingerprints.length && settings.targetLocales.length === 0 ? "Add target locale" : "Load mod jars"}</div>
            ) : (
              namespaces.map((namespace) => (
                <button
                  type="button"
                  key={namespace}
                  className={activePage === `namespace:${namespace}` ? "active" : ""}
                  onClick={() => setActivePage(`namespace:${namespace}`)}
                >
                  <span>{namespace}</span>
                  <strong>{rows.filter((row) => row.namespace === namespace).length.toLocaleString()}</strong>
                </button>
              ))
            )}
          </section>
        </aside>

        {activePage === "project" ? (
          <ProjectPage
            rows={rows}
            stats={stats}
            modCount={modScan.fingerprints.length}
            sourceCount={sourcePacks.length}
            settings={settings}
            setSettings={setSettings}
            activeLocale={activeLocale}
            setActiveLocale={setActiveLocale}
            translating={translating}
            translationProgress={translationProgress}
            llmWarnings={llmWarnings}
            allMissingCount={allMissingCount}
            translateAll={translateAll}
            pauseTranslationJob={pauseTranslationJob}
            resumeTranslationJob={resumeTranslationJob}
            stopTranslationJob={stopTranslationJob}
            clearLlmWarnings={() => setLlmWarnings([])}
            clearLoadedJars={clearLoadedJars}
            exportProjectPatch={exportProjectPatch}
            exportResourcePack={exportResourcePack}
            exportPatchedJars={exportPatchedJars}
          />
        ) : null}

        {activePage === "sources" ? (
          <SourcesPage sourcePacks={sourcePacks} moveSourcePack={moveSourcePack} removeSourcePack={removeSourcePack} />
        ) : null}

        {activePage === "settings" ? (
          <SettingsPage
            settings={settings}
            setSettings={setSettings}
            llmSettings={llmSettings}
            setLlmSettings={setLlmSettings}
            translating={translating}
            availableModels={availableModels}
            loadingModels={loadingModels}
            refreshModels={refreshModels}
            phraseMappings={phraseMappings}
            projectPhraseMappings={project.phraseMappings ?? {}}
            hasRows={rows.length > 0}
            refreshConvertedValues={refreshConvertedValues}
            setProject={setProject}
            setStatus={setStatus}
            defaultLlmSettings={deploymentDefaults.llmSettings}
          />
        ) : null}

        {activePage.startsWith("namespace:") ? (
          <>
            <section className="centerPane">
              <div className="namespaceHeader">
                <div>
                  <h2>{activeNamespace}</h2>
                  <p>{filteredRows.length.toLocaleString()} visible keys</p>
                </div>
                <div className="namespaceHeaderActions">
                  <button type="button" onClick={translateNamespace} disabled={!activeNamespace || translating || namespaceMissingCount === 0}>
                    <Wand2 size={16} />
                    Translate page
                  </button>
                  <button type="button" onClick={translateAll} disabled={rows.length === 0 || translating || allMissingCount === 0}>
                    <Wand2 size={16} />
                    Translate all
                  </button>
                  <button type="button" onClick={revertNamespaceManualPatches} disabled={!activeNamespace}>
                    <RotateCcw size={16} />
                    Revert namespace edits
                  </button>
                </div>
              </div>
              {llmWarnings.length ? <LlmWarningsPanel warnings={llmWarnings} clearWarnings={() => setLlmWarnings([])} /> : null}
              <div className="tableToolbar">
                <div className="localeTabs" role="tablist" aria-label="Locales">
                  {settings.targetLocales.map((locale) => (
                    <button
                      type="button"
                      key={locale}
                      className={locale === activeLocale ? "active" : ""}
                      onClick={() => setActiveLocale(locale)}
                    >
                      {locale}
                    </button>
                  ))}
                </div>
                <label className="searchBox">
                  <Search size={16} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keys or values" />
                </label>
              </div>

              <div className="entryTable" role="table">
                <div className="entryTableHead" role="row">
                  <span>Key</span>
                  <span>Source</span>
                  <span>Value</span>
                </div>
                <div className="entryTableBody">
                  {filteredRows.length === 0 ? (
                    <div className="emptyState tableEmpty">No keys loaded</div>
                  ) : (
                    tableItems.map((item) => {
                      if (item.kind === "divider") {
                        return (
                          <div className="prefixDivider" key={item.id} role="row">
                            <span>{item.prefix}</span>
                          </div>
                        );
                      }
                      const row = item.row;
                      const entry = activeLocale ? row.entries[activeLocale] : undefined;
                      if (!entry) {
                        return null;
                      }
                      const hasEnUsValue = rowHasLocaleValue(row, "en_us", modScan.translations, sourcePacks);
                      return (
                        <div
                          className={`entryRow ${selectedRow && rowId(selectedRow) === rowId(row) ? "selected" : ""}`}
                          key={rowId(row)}
                          role="row"
                          onClick={() => setSelectedKey(rowId(row))}
                        >
                          <span className="keyCell" data-full-key={row.key}>
                            <button type="button" className="keyButton" title={row.key} onClick={() => setSelectedKey(rowId(row))}>
                              {item.displayKey}
                            </button>
                            {!hasEnUsValue ? (
                              <span className="keyWarningIcon" title="No en_us value" role="img" aria-label="No en_us value">
                                <TriangleAlert size={14} />
                              </span>
                            ) : null}
                          </span>
                          <SourceBadge source={entry.final.source} />
                          <InlineValueEditor
                            entry={entry}
                            draft={inlineDrafts[entry.id]}
                            setDraft={(value) =>
                              setInlineDrafts((current) => ({
                                ...current,
                                [entry.id]: value,
                              }))
                            }
                            clearDraft={() => setInlineDrafts((current) => removeDraft(current, entry.id))}
                            saveValue={(value) => saveManualPatchForEntry(entry, value, { quiet: true })}
                            selectRow={() => setSelectedKey(rowId(row))}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            <div
              className="splitHandle"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              aria-valuemin={320}
              aria-valuemax={620}
              aria-valuenow={settings.inspectorWidth}
              tabIndex={0}
              onPointerDown={startInspectorResize}
              onPointerMove={moveInspectorResize}
              onPointerUp={stopInspectorResize}
              onPointerCancel={stopInspectorResize}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }
                event.preventDefault();
                const delta = event.key === "ArrowLeft" ? 20 : -20;
                setSettings((current) => ({ ...current, inspectorWidth: clamp(current.inspectorWidth + delta, 320, 620) }));
              }}
            />

            <aside className="rightPane">
              {selectedEntry && selectedRow ? (
                <>
                  <section className="valueStack">
                    <ReferenceValueBlock
                      referenceLocale={selectedReference?.locale ?? ""}
                      availableReferenceValues={selectedReferenceValues}
                      onReferenceLocaleChange={updateReferenceLocale}
                      hasEnUsValue={selectedReferenceValues.some((reference) => reference.locale === "en_us")}
                    />
                    <ValueBlock title="Base value" source={selectedEntry.base.source} value={selectedEntry.base.value} label={selectedEntry.base.sourceLabel} />
                  </section>

                  {selectedPhraseMatches.length ? (
                    <PhraseMatchesPanel matches={selectedPhraseMatches} activeLocale={activeLocale} referenceLocale={selectedReference?.locale ?? referenceLocale} />
                  ) : null}

                  {selectedLlmCandidates.length ? (
                    <LlmCandidatesPanel
                      candidates={selectedLlmCandidates}
                      activePatch={selectedEntry.patch}
                      useCandidate={useLlmCandidate}
                      deleteCandidate={deleteLlmCandidate}
                    />
                  ) : null}

                  <section className="editPanel">
                    <div className="panelHeader">
                      <h2>Patch</h2>
                      <div className="buttonRow compact">
                        <button type="button" onClick={saveManualPatch}>
                          <Save size={16} />
                          Save
                        </button>
                        <button type="button" onClick={revertSelectedManualPatch} disabled={!selectedEntry.patch}>
                          <RotateCcw size={16} />
                          Key
                        </button>
                        <button type="button" onClick={translateSelected} disabled={!selectedEntry || translating}>
                          <Wand2 size={16} />
                          LLM
                        </button>
                        {selectedEntry.patch?.meta?.generatedBy === "llm" ? <SourceBadge source="llm" /> : null}
                        {selectedEntry.patch?.meta?.generatedBy === "converted" ? <SourceBadge source="converted" /> : null}
                      </div>
                    </div>
                    <PatchTextEditor
                      value={manualDraft}
                      onChange={setManualDraft}
                      diffSegments={manualDiffSegments}
                      hasManualPatch={hasManualPatch}
                    />
                    {manualWarnings.length ? <div className="warningText">{manualWarnings[0]}</div> : null}
                  </section>

                  <section className="finalPanel">
                    <div className="panelHeader">
                      <h2>Final Output</h2>
                      <SourceBadge source={selectedEntry.final.source} />
                    </div>
                    <pre>{selectedEntry.final.value}</pre>
                  </section>
                </>
              ) : (
                <div className="emptyState detailEmpty">No key selected</div>
              )}
            </aside>
          </>
        ) : null}
      </section>
      </main>
    </SourceLabelContext.Provider>
  );
}

function FilePicker({
  label,
  accept,
  multiple,
  onChange,
  icon,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  icon: ReactNode;
}) {
  return (
    <label className="fileButton">
      {icon}
      {label}
      <input type="file" accept={accept} multiple={multiple} onChange={onChange} />
    </label>
  );
}

function SourceBadge({ source }: { source: CandidateValue["source"] }) {
  const sourceLabels = useContext(SourceLabelContext);
  const label = sourceLabels[source];
  return (
    <span className={`sourceBadge ${source}`} style={{ background: label.background, color: label.text }}>
      {label.label}
    </span>
  );
}

function LlmCandidatesPanel({
  candidates,
  activePatch,
  useCandidate,
  deleteCandidate,
}: {
  candidates: PatchValue[];
  activePatch: PatchValue | undefined;
  useCandidate: (candidate: PatchValue, index: number) => void;
  deleteCandidate: (candidate: PatchValue, index: number) => void;
}) {
  return (
    <section className="llmCandidatePanel">
      <div className="panelHeader">
        <h2>LLM generated</h2>
        <span className="candidateCount">{candidates.length} saved</span>
      </div>
      <div className="llmCandidateList">
        {candidates.map((candidate, index) => {
          const active = isActiveLlmCandidate(activePatch, candidate, index);
          return (
            <article className={`llmCandidateCard ${active ? "active" : ""}`} key={llmCandidateKey(candidate, index)}>
              <div className="llmCandidateMeta">
                <SourceBadge source="llm" />
                <span>{candidate.meta?.model ?? "LLM"}</span>
                <time>{formatPatchTime(candidate.updatedAt)}</time>
                {active ? <strong>Active</strong> : null}
              </div>
              <pre>{candidate.value}</pre>
              <div className="buttonRow compact">
                <button type="button" onClick={() => useCandidate(candidate, index)} disabled={active}>
                  <Check size={16} />
                  Use
                </button>
                <button type="button" onClick={() => deleteCandidate(candidate, index)}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FallbackChainEditor({
  locale,
  chain,
  availableLocales,
  setChain,
}: {
  locale: LocaleCode;
  chain: string[];
  availableLocales: readonly LocaleCode[];
  setChain: (chain: string[]) => void;
}) {
  const normalized = normalizeFallbackChain(locale, chain);
  const movable = normalized.filter((fallbackLocale) => fallbackLocale !== "en_us");
  const available = availableLocales.filter((fallbackLocale) => fallbackLocale !== locale && fallbackLocale !== "en_us" && !movable.includes(fallbackLocale));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= movable.length) {
      return;
    }
    const next = [...movable];
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  }

  function remove(index: number) {
    setChain([...movable.slice(0, index), ...movable.slice(index + 1)]);
  }

  return (
    <div className="fallbackEditor">
      <div className="fallbackTarget">{locale}</div>
      <div className="fallbackList">
        {movable.map((fallbackLocale, index) => (
          <div className="fallbackChip" key={fallbackLocale}>
            <span>{fallbackLocale}</span>
            <button type="button" className="miniIconButton" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${fallbackLocale} up`}>
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              className="miniIconButton"
              onClick={() => move(index, 1)}
              disabled={index === movable.length - 1}
              aria-label={`Move ${fallbackLocale} down`}
            >
              <ArrowDown size={13} />
            </button>
            <button type="button" className="miniIconButton danger" onClick={() => remove(index)} aria-label={`Remove ${fallbackLocale}`}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {locale !== "en_us" ? (
          <div className="fallbackChip locked">
            <span>en_us</span>
          </div>
        ) : null}
        <select
          className="fallbackAdd"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              setChain([...movable, event.target.value]);
            }
          }}
        >
          <option value="">Add fallback</option>
          {available.map((fallbackLocale) => (
            <option key={fallbackLocale} value={fallbackLocale}>
              {fallbackLocale}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ProjectPage({
  rows,
  stats,
  modCount,
  sourceCount,
  settings,
  setSettings,
  activeLocale,
  setActiveLocale,
  translating,
  translationProgress,
  llmWarnings,
  allMissingCount,
  translateAll,
  pauseTranslationJob,
  resumeTranslationJob,
  stopTranslationJob,
  clearLlmWarnings,
  clearLoadedJars,
  exportProjectPatch,
  exportResourcePack,
  exportPatchedJars,
}: {
  rows: CatalogRow[];
  stats: ReturnType<typeof buildStats>;
  modCount: number;
  sourceCount: number;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  activeLocale: LocaleCode;
  setActiveLocale: Dispatch<SetStateAction<LocaleCode>>;
  translating: boolean;
  translationProgress: TranslationProgress | null;
  llmWarnings: string[];
  allMissingCount: number;
  translateAll: () => void;
  pauseTranslationJob: () => void;
  resumeTranslationJob: () => void;
  stopTranslationJob: () => void;
  clearLlmWarnings: () => void;
  clearLoadedJars: () => void;
  exportProjectPatch: () => void;
  exportResourcePack: () => void;
  exportPatchedJars: () => void;
}) {
  const namespaceCount = new Set(rows.map((row) => row.namespace)).size;
  const sourceTargetCounts = useMemo(() => countTranslationTargetsBySource(rows, activeLocale), [activeLocale, rows]);
  const missingSourceRows = useMemo(
    () => (activeLocale ? rows.filter((row) => row.entries[activeLocale]?.final.source === "missing").length : 0),
    [activeLocale, rows],
  );
  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>Project</h2>
      </div>
      <section className="panel metricsPanel wide">
        <Metric label="Namespaces" value={namespaceCount} />
        <Metric label="Keys" value={rows.length} />
        <Metric label="Mod files" value={modCount} />
        <Metric label="Update packs" value={sourceCount} />
        <Metric label="Manual patches" value={stats.manual} />
        <Metric label="LLM patches" value={stats.llm} />
        <Metric label="Converted values" value={stats.converted} />
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Project mode</h2>
        </div>
        <label>
          Mode
          <select
            value={settings.projectMode}
            onChange={(event) => setSettings((current) => ({ ...current, projectMode: event.target.value as ProjectMode }))}
          >
            <option value="resourcePack">Minecraft resource pack</option>
          </select>
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Export</h2>
        </div>
        <label>
          Update From pack contents
          <select
            value={settings.sourcePackMode}
            onChange={(event) => setSettings((current) => ({ ...current, sourcePackMode: event.target.value as SourcePackMode }))}
          >
            <option value="prune">Prune to loaded mod namespaces</option>
            <option value="keep">Keep other namespaces from Update From packs</option>
          </select>
        </label>
        <label>
          Pack format
          <input
            type="number"
            min="1"
            value={settings.packFormat}
            onChange={(event) => setSettings((current) => ({ ...current, packFormat: Number(event.target.value) || current.packFormat }))}
          />
        </label>
        <label>
          Description
          <input value={settings.description} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} />
        </label>
        <div className="targetHint">
          Resource pack export creates a normal pack zip. Jar export creates modified copies of loaded mod jars and writes final lang JSON into matching
          namespaces; the original local jars are not changed.
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Project actions</h2>
          <span className="panelNote">{allMissingCount.toLocaleString()} target key(s)</span>
        </div>
        <div className="projectActionPanel">
          <div className="localeTabs" role="tablist" aria-label="Project action locale">
            {settings.targetLocales.length === 0 ? <span className="targetHint">Add a target locale in Settings.</span> : null}
            {settings.targetLocales.map((locale) => (
              <button
                type="button"
                key={locale}
                className={locale === activeLocale ? "active" : ""}
                onClick={() => setActiveLocale(locale)}
              >
                {locale}
              </button>
            ))}
          </div>
          <div className="translateTargetGroup" aria-label="Translate targets">
            <span>Translate target</span>
            <div className="sourceTargetToggles">
              {SOURCE_TRANSLATE_TARGET_ORDER.map((source) => (
                <label className={`sourceTargetToggle ${settings.translateSourceTargets[source] ? "active" : ""}`} key={source}>
                  <input
                    type="checkbox"
                    checked={settings.translateSourceTargets[source]}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        translateSourceTargets: {
                          ...current.translateSourceTargets,
                          [source]: event.target.checked,
                        },
                      }))
                    }
                  />
                  <SourceBadge source={source} />
                  <strong>{sourceTargetCounts[source].toLocaleString()}</strong>
                </label>
              ))}
            </div>
            {missingSourceRows ? (
              <div className="targetHint">
                {missingSourceRows.toLocaleString()} row(s) have no source value. The key is shown only as a placeholder and will not be translated.
              </div>
            ) : null}
          </div>
          {translationProgress ? (
            <TranslationProgressPanel
              progress={translationProgress}
              pauseTranslationJob={pauseTranslationJob}
              resumeTranslationJob={resumeTranslationJob}
              stopTranslationJob={stopTranslationJob}
            />
          ) : null}
          {llmWarnings.length ? <LlmWarningsPanel warnings={llmWarnings} clearWarnings={clearLlmWarnings} /> : null}
          <div className="buttonRow projectActions">
            <button type="button" onClick={translateAll} disabled={rows.length === 0 || translating || allMissingCount === 0}>
              <Wand2 size={16} />
              Translate all
            </button>
            <button type="button" onClick={exportProjectPatch}>
              <Download size={16} />
              Export patch
            </button>
            <button type="button" onClick={exportResourcePack} disabled={rows.length === 0}>
              <Download size={16} />
              Export zip
            </button>
            <button type="button" onClick={exportPatchedJars} disabled={rows.length === 0 || modCount === 0}>
              <Download size={16} />
              Export jars
            </button>
            <button type="button" className="danger" onClick={clearLoadedJars} disabled={modCount === 0 || translating}>
              <Trash2 size={16} />
              Clear loaded jars
            </button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <h2>Workflow</h2>
        </div>
        <div className="workflowList">
          <span>Load mod jars from the top bar.</span>
          <span>Add Update From resource packs and order them by priority.</span>
          <span>Open a namespace page, edit values inline, or use the detail panel.</span>
          <span>Export a patch file, final resource pack zip, or patched jar copies.</span>
        </div>
      </section>
    </section>
  );
}

function SourcesPage({
  sourcePacks,
  moveSourcePack,
  removeSourcePack,
}: {
  sourcePacks: SourcePackScanResult[];
  moveSourcePack: (index: number, delta: number) => void;
  removeSourcePack: (index: number) => void;
}) {
  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>Update From</h2>
      </div>
      <section className="panel">
        <div className="panelHeader">
          <h2>Resource pack priority</h2>
        </div>
        <div className="sourcePackList large">
          {sourcePacks.length === 0 ? (
            <div className="emptyState">No source packs</div>
          ) : (
            sourcePacks.map((pack, index) => (
              <div className="sourcePackRow" key={pack.fingerprint.sha256}>
                <span title={pack.fingerprint.name}>{pack.fingerprint.name}</span>
                <div className="iconGroup">
                  <button type="button" className="iconButton" onClick={() => moveSourcePack(index, -1)} aria-label="Move up">
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" className="iconButton" onClick={() => moveSourcePack(index, 1)} aria-label="Move down">
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" className="iconButton danger" onClick={() => removeSourcePack(index)} aria-label="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function TranslationProgressPanel({
  progress,
  pauseTranslationJob,
  resumeTranslationJob,
  stopTranslationJob,
}: {
  progress: TranslationProgress;
  pauseTranslationJob: () => void;
  resumeTranslationJob: () => void;
  stopTranslationJob: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const remaining = estimateRemainingTime(progress, now);
  const statusLabel =
    progress.status === "paused" ? "Paused" : progress.status === "stopping" ? "Stopping" : `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;

  return (
    <section className="translationProgressPanel" aria-label="LLM translation progress">
      <div className="progressHeader">
        <div>
          <strong>{progress.label}</strong>
          <span>{statusLabel}</span>
        </div>
        <span>{percent}%</span>
      </div>
      <div className="progressBar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} role="progressbar">
        <div className="progressBarFill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progressFooter">
        <div className="progressStats">
          <span>ETA {remaining}</span>
          {progress.warningCount ? <span>{progress.warningCount.toLocaleString()} warning(s)</span> : null}
        </div>
        <div className="progressControls">
          {progress.status === "paused" ? (
            <button type="button" onClick={resumeTranslationJob}>
              <Play size={16} />
              Resume
            </button>
          ) : (
            <button type="button" onClick={pauseTranslationJob} disabled={progress.status === "stopping"}>
              <Pause size={16} />
              Pause
            </button>
          )}
          <button type="button" className="danger" onClick={stopTranslationJob} disabled={progress.status === "stopping"}>
            <Square size={16} />
            Stop
          </button>
        </div>
      </div>
    </section>
  );
}

function LlmWarningsPanel({ warnings, clearWarnings }: { warnings: string[]; clearWarnings: () => void }) {
  return (
    <section className="llmWarningsPanel" aria-label="LLM warnings">
      <div className="panelHeader">
        <h2>LLM warnings</h2>
        <div className="buttonRow compact">
          <span className="panelNote">{warnings.length.toLocaleString()} warning(s)</span>
          <button type="button" onClick={clearWarnings}>
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </div>
      <ol className="llmWarningList">
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ol>
    </section>
  );
}

function LocaleOrderList({
  locales,
  emptyText,
  moveLocale,
  removeLocale,
}: {
  locales: readonly LocaleCode[];
  emptyText: string;
  moveLocale: (index: number, delta: number) => void;
  removeLocale: (locale: LocaleCode) => void;
}) {
  if (locales.length === 0) {
    return <div className="emptyState">{emptyText}</div>;
  }
  return (
    <div className="fallbackList localeOrderList">
      {locales.map((locale, index) => (
        <div className="fallbackChip" key={locale}>
          <span>{locale}</span>
          <button type="button" className="miniIconButton" onClick={() => moveLocale(index, -1)} disabled={index === 0} aria-label={`Move ${locale} up`}>
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="miniIconButton"
            onClick={() => moveLocale(index, 1)}
            disabled={index === locales.length - 1}
            aria-label={`Move ${locale} down`}
          >
            <ArrowDown size={13} />
          </button>
          <button type="button" className="miniIconButton danger" onClick={() => removeLocale(locale)} aria-label={`Remove ${locale}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SettingsPage({
  settings,
  setSettings,
  llmSettings,
  setLlmSettings,
  translating,
  availableModels,
  loadingModels,
  refreshModels,
  phraseMappings,
  projectPhraseMappings,
  hasRows,
  refreshConvertedValues,
  setProject,
  setStatus,
  defaultLlmSettings,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  llmSettings: LlmSettings;
  setLlmSettings: Dispatch<SetStateAction<LlmSettings>>;
  translating: boolean;
  availableModels: string[];
  loadingModels: boolean;
  refreshModels: () => Promise<string[]>;
  phraseMappings: PhraseMapping[];
  projectPhraseMappings: LangpackProjectPatch["phraseMappings"];
  hasRows: boolean;
  refreshConvertedValues: () => void;
  setProject: Dispatch<SetStateAction<LangpackProjectPatch>>;
  setStatus: Dispatch<SetStateAction<StatusMessage>>;
  defaultLlmSettings: LlmSettings;
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [phraseQuery, setPhraseQuery] = useState("");
  const [targetLocaleDraft, setTargetLocaleDraft] = useState("");
  const sourceLabels = useContext(SourceLabelContext);
  const filteredPhraseMappings = useMemo(() => {
    const normalizedQuery = phraseQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return phraseMappings;
    }
    return phraseMappings.filter((mapping) =>
      [
        mapping.id,
        mapping.source,
        mapping.en_us.join(" "),
        mapping.zh_cn.join(" "),
        mapping.zh_tw.join(" "),
        mapping.zh_hk.join(" "),
        mapping.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [phraseMappings, phraseQuery]);

  async function openModelMenu() {
    if (llmSettings.debugMode || loadingModels) {
      return;
    }
    if (modelMenuOpen) {
      setModelMenuOpen(false);
      return;
    }
    const models = availableModels.length ? availableModels : await refreshModels();
    setModelMenuOpen(models.length > 0);
  }

  function updatePhraseMapping(mapping: PhraseMapping, next: PhraseMapping) {
    setProject((current) => ({
      ...current,
      phraseMappings: {
        ...(current.phraseMappings ?? {}),
        [mapping.id]: phraseMappingOverrideFromMapping(next),
      },
    }));
  }

  function updatePhraseMappingField<K extends keyof PhraseMapping>(mapping: PhraseMapping, field: K, value: PhraseMapping[K]) {
    updatePhraseMapping(mapping, { ...mapping, [field]: value });
  }

  function resetPhraseMapping(id: string) {
    setProject((current) => {
      const next = { ...(current.phraseMappings ?? {}) };
      delete next[id];
      return { ...current, phraseMappings: next };
    });
  }

  function resetBuiltinPhraseMappings() {
    setProject((current) => ({
      ...current,
      phraseMappings: Object.fromEntries(
        Object.entries(current.phraseMappings ?? {}).filter(([id]) => !isBuiltinPhraseMapping(id)),
      ),
    }));
    setStatus({ tone: "ok", text: "Curated Phrase Mapping overrides reset." });
  }

  function addCustomPhraseMapping() {
    const id = `custom.${Date.now().toString(36)}`;
    const mapping: PhraseMapping = {
      id,
      enabled: true,
      source: "custom",
      en_us: [],
      zh_cn: [],
      zh_tw: [],
      zh_hk: [],
    };
    setProject((current) => ({
      ...current,
      phraseMappings: {
        ...(current.phraseMappings ?? {}),
        [id]: phraseMappingOverrideFromMapping(mapping),
      },
    }));
    setPhraseQuery("");
  }

  async function importPhraseMappings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const imported = normalizePhraseMappingOverrides(JSON.parse(await file.text()));
      setProject((current) => ({
        ...current,
        phraseMappings: {
          ...(current.phraseMappings ?? {}),
          ...imported,
        },
      }));
      setStatus({ tone: "ok", text: `Imported ${Object.keys(imported).length.toLocaleString()} phrase mapping override(s).` });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  function exportPhraseMappings() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, phraseMappings: projectPhraseMappings ?? {} }, null, 2) + "\n"], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, "minecraft-phrase-mappings.json");
    setStatus({ tone: "ok", text: "Phrase Mapping overrides exported." });
  }

  function addTargetLocale(locale: string) {
    const normalized = normalizeLocaleCode(locale);
    if (!isValidLocaleCode(normalized)) {
      setStatus({ tone: "warn", text: "Enter a valid Minecraft locale code." });
      return;
    }
    setSettings((current) => {
      if (current.targetLocales.includes(normalized)) {
        return current;
      }
      return {
        ...current,
        targetLocales: [...current.targetLocales, normalized],
        fallbackChains: {
          ...current.fallbackChains,
          [normalized]: current.fallbackChains[normalized] ?? [],
        },
      };
    });
    setTargetLocaleDraft("");
  }

  function removeTargetLocale(locale: LocaleCode) {
    setSettings((current) => {
      const fallbackChains = { ...current.fallbackChains };
      delete fallbackChains[locale];
      return {
        ...current,
        targetLocales: current.targetLocales.filter((item) => item !== locale),
        fallbackChains,
      };
    });
  }

  function moveTargetLocale(index: number, delta: number) {
    setSettings((current) => ({
      ...current,
      targetLocales: moveListItem(current.targetLocales, index, delta),
    }));
  }

  const targetSuggestions = BUNDLED_LOCALE_CODES.filter((locale) => !settings.targetLocales.includes(locale));
  const fallbackSuggestions = uniqueLocaleCodes([...settings.targetLocales, ...BUNDLED_LOCALE_CODES]);

  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>Settings</h2>
        {translating ? <Loader2 size={16} className="spin" /> : null}
      </div>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Target locales</h2>
          <span className="panelNote">{settings.targetLocales.length.toLocaleString()} selected</span>
        </div>
        <div className="localeManageControls">
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addTargetLocale(event.target.value);
              }
            }}
          >
            <option value="">Add bundled locale</option>
            {targetSuggestions.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
          <input value={targetLocaleDraft} onChange={(event) => setTargetLocaleDraft(event.target.value)} placeholder="custom code" />
          <button type="button" onClick={() => addTargetLocale(targetLocaleDraft)}>
            <Check size={16} />
            Add
          </button>
        </div>
        <LocaleOrderList
          locales={settings.targetLocales}
          emptyText="No target locales"
          moveLocale={moveTargetLocale}
          removeLocale={removeTargetLocale}
        />
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Editor</h2>
        </div>
        <label>
          Inspector width
          <div className="rangeControl">
            <input
              type="range"
              min="320"
              max="620"
              step="10"
              value={settings.inspectorWidth}
              onChange={(event) => setSettings((current) => ({ ...current, inspectorWidth: Number(event.target.value) }))}
            />
            <input
              type="number"
              min="320"
              max="620"
              value={settings.inspectorWidth}
              onChange={(event) => setSettings((current) => ({ ...current, inspectorWidth: Number(event.target.value) || current.inspectorWidth }))}
            />
          </div>
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Locale fallback</h2>
        </div>
        {settings.targetLocales.length === 0 ? <div className="emptyState">No target locales</div> : null}
        {settings.targetLocales.map((locale) => (
          <FallbackChainEditor
            key={locale}
            locale={locale}
            chain={settings.fallbackChains[locale] ?? []}
            availableLocales={fallbackSuggestions}
            setChain={(chain) =>
              setSettings((current) => ({
                ...current,
                fallbackChains: {
                  ...current.fallbackChains,
                  [locale]: normalizeFallbackChain(locale, chain),
                },
              }))
            }
          />
        ))}
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Convert</h2>
          <button type="button" onClick={refreshConvertedValues} disabled={!hasRows}>
            <ArrowLeftRight size={16} />
            Refresh converted
          </button>
        </div>
        <div className="translateTargetGroup" aria-label="Convert sources">
          <span>Convert from</span>
          <div className="sourceTargetToggles">
            {CONVERT_SOURCE_ORDER.map((source) => (
              <label className={`sourceTargetToggle ${settings.convertSources[source] ? "active" : ""}`} key={source}>
                <input
                  type="checkbox"
                  checked={settings.convertSources[source]}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      convertSources: {
                        ...current.convertSources,
                        [source]: event.target.checked,
                      },
                    }))
                  }
                />
                <SourceBadge source={source} />
              </label>
            ))}
          </div>
        </div>
        <label>
          LLM source values
          <select
            value={settings.llmReferenceMode}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                llmReferenceMode: event.target.value as AppSettings["llmReferenceMode"],
              }))
            }
          >
            {LLM_REFERENCE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {llmReferenceModeLabel(mode)}
              </option>
            ))}
          </select>
        </label>
        <div className="targetHint">Starts from the selected source mode, then falls back to later modes when that source is unavailable.</div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Export</h2>
        </div>
        <div className="translateTargetGroup" aria-label="Export skipped sources">
          <span>Skip keys from</span>
          <div className="sourceTargetToggles">
            {SOURCE_LABEL_ORDER.map((source) => (
              <label className={`sourceTargetToggle ${settings.exportSkipSources[source] ? "active" : ""}`} key={source}>
                <input
                  type="checkbox"
                  checked={settings.exportSkipSources[source]}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      exportSkipSources: {
                        ...current.exportSkipSources,
                        [source]: event.target.checked,
                      },
                    }))
                  }
                />
                <SourceBadge source={source} />
              </label>
            ))}
          </div>
          <div className="targetHint">
            Checked sources are omitted from resource pack zip and patched jar exports. Jar and Fallback are skipped by default.
          </div>
        </div>
      </section>
      <section className="panel settingsPanel phraseMappingPanel">
        <div className="panelHeader">
          <h2>Phrase Mapping</h2>
          <span className="panelNote">{filteredPhraseMappings.length.toLocaleString()} shown</span>
        </div>
        <div className="phraseMappingToolbar">
          <label className="searchBox">
            <Search size={16} />
            <input value={phraseQuery} onChange={(event) => setPhraseQuery(event.target.value)} placeholder="Search mappings" />
          </label>
          <div className="buttonRow compact">
            <button type="button" onClick={addCustomPhraseMapping}>
              <FileJson size={16} />
              Add custom
            </button>
            <button type="button" onClick={resetBuiltinPhraseMappings}>
              <RotateCcw size={16} />
              Reset curated
            </button>
            <FilePicker label="Import" accept=".json" onChange={importPhraseMappings} icon={<Upload size={16} />} />
            <button type="button" onClick={exportPhraseMappings}>
              <Download size={16} />
              Export
            </button>
          </div>
        </div>
        <div className="phraseMappingList">
          {filteredPhraseMappings.map((mapping) => {
            const builtin = isBuiltinPhraseMapping(mapping.id);
            const overridden = Boolean(projectPhraseMappings?.[mapping.id]);
            return (
              <article className="phraseMappingCard" key={mapping.id}>
                <div className="phraseMappingCardHead">
                  <label className="checkboxControl">
                    <input
                      type="checkbox"
                      checked={mapping.enabled}
                      onChange={(event) => updatePhraseMappingField(mapping, "enabled", event.target.checked)}
                    />
                    Enabled
                  </label>
                  <div className="phraseMappingIdentity">
                    <strong>{mapping.id}</strong>
                    <span>
                      {mapping.source}
                      {overridden ? " override" : ""}
                    </span>
                  </div>
                  <div className="buttonRow compact">
                    {builtin ? (
                      <button type="button" onClick={() => resetPhraseMapping(mapping.id)} disabled={!overridden}>
                        <RotateCcw size={16} />
                        Reset
                      </button>
                    ) : (
                      <button type="button" className="danger" onClick={() => resetPhraseMapping(mapping.id)}>
                        <Trash2 size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <div className="phraseMappingGrid">
                  <label>
                    en_us
                    <input
                      value={joinPhraseTerms(mapping.en_us)}
                      onChange={(event) => updatePhraseMappingField(mapping, "en_us", splitPhraseTerms(event.target.value))}
                    />
                  </label>
                  {CHINESE_LOCALES.map((locale) => (
                    <label key={locale}>
                      {locale}
                      <input
                        value={joinPhraseTerms(mapping[locale])}
                        onChange={(event) => updatePhraseMappingField(mapping, locale, splitPhraseTerms(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Note
                  <input value={mapping.note ?? ""} onChange={(event) => updatePhraseMappingField(mapping, "note", event.target.value)} />
                </label>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Source labels</h2>
        </div>
        <div className="colorLegend">
          {SOURCE_LABEL_ORDER.map((source) => {
            const colors = sourceLabels[source];
            return (
              <div className="colorLegendRow" key={source}>
                <SourceBadge source={source} />
                <span className="colorSwatch" style={{ background: colors.background, borderColor: colors.stripe }} />
                <code>{colors.background}</code>
                <code>{colors.text}</code>
                <code>{colors.stripe}</code>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel llmPanel settingsPanel">
        <div className="panelHeader">
          <h2>LLM</h2>
          <button
            type="button"
            onClick={() =>
              setLlmSettings((current) => ({
                ...current,
                systemPrompt: defaultLlmSettings.systemPrompt,
                userPrompt: defaultLlmSettings.userPrompt,
              }))
            }
          >
            <RotateCcw size={16} />
            Reset prompts
          </button>
        </div>
        <label className="checkboxControl">
          <input
            type="checkbox"
            checked={Boolean(llmSettings.debugMode)}
            onChange={(event) => setLlmSettings((current) => ({ ...current, debugMode: event.target.checked }))}
          />
          Debug simulated LLM
        </label>
        <label>
          Debug wait per batch (ms)
          <input
            type="number"
            min="0"
            max="5000"
            step="25"
            value={llmSettings.debugDelayMs ?? 0}
            disabled={!llmSettings.debugMode}
            onChange={(event) => setLlmSettings((current) => ({ ...current, debugDelayMs: Number(event.target.value) || 0 }))}
          />
        </label>
        <label>
          Base URL
          <input
            value={llmSettings.baseUrl}
            disabled={llmSettings.debugMode}
            onChange={(event) => setLlmSettings((current) => ({ ...current, baseUrl: event.target.value }))}
          />
        </label>
        <label>
          Model
          <div
            className="modelControl"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setModelMenuOpen(false);
              }
            }}
          >
            <input value={llmSettings.model} onChange={(event) => setLlmSettings((current) => ({ ...current, model: event.target.value }))} />
            <button
              type="button"
              className="modelMenuButton"
              onClick={openModelMenu}
              disabled={llmSettings.debugMode || loadingModels}
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
            >
              {loadingModels ? <Loader2 size={16} className="spin" /> : <ArrowDown size={16} />}
              Models
            </button>
            {modelMenuOpen && availableModels.length ? (
              <div className="modelMenu" role="listbox" aria-label="Available models">
                {availableModels.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model === llmSettings.model}
                    className={model === llmSettings.model ? "active" : ""}
                    key={model}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setLlmSettings((current) => ({ ...current, model }));
                      setModelMenuOpen(false);
                    }}
                  >
                    {model}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </label>
        <label>
          API Key
          <input
            type="password"
            value={llmSettings.apiKey}
            disabled={llmSettings.debugMode}
            onChange={(event) => setLlmSettings((current) => ({ ...current, apiKey: event.target.value }))}
          />
        </label>
        <label>
          Batch size
          <input
            type="number"
            min="1"
            max="200"
            value={settings.llmBatchSize}
            onChange={(event) => setSettings((current) => ({ ...current, llmBatchSize: Number(event.target.value) || current.llmBatchSize }))}
          />
        </label>
        <label>
          Parallel requests
          <input
            type="number"
            min="1"
            max="12"
            value={settings.llmConcurrency}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                llmConcurrency: clamp(Number(event.target.value) || current.llmConcurrency, 1, 12),
              }))
            }
          />
        </label>
        <label>
          System prompt
          <textarea
            className="promptTextarea"
            value={llmSettings.systemPrompt ?? ""}
            onChange={(event) => setLlmSettings((current) => ({ ...current, systemPrompt: event.target.value }))}
            spellCheck={false}
          />
        </label>
        <label>
          User prompt
          <textarea
            className="promptTextarea large"
            value={llmSettings.userPrompt ?? ""}
            onChange={(event) => setLlmSettings((current) => ({ ...current, userPrompt: event.target.value }))}
            spellCheck={false}
          />
        </label>
      </section>
    </section>
  );
}

function InlineValueEditor({
  entry,
  draft,
  setDraft,
  clearDraft,
  saveValue,
  selectRow,
}: {
  entry: ResolvedEntry;
  draft?: string;
  setDraft: (value: string) => void;
  clearDraft: () => void;
  saveValue: (value: string) => Promise<void>;
  selectRow: () => void;
}) {
  const value = draft ?? entry.final.value;
  const sourceLabels = useContext(SourceLabelContext);
  return (
    <input
      className={`inlineValueInput ${entry.final.source}`}
      style={{ borderLeftColor: sourceLabels[entry.final.source].stripe }}
      value={value}
      title={value}
      onFocus={selectRow}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (event.target.value !== entry.final.value) {
          void saveValue(event.target.value);
        } else {
          clearDraft();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          clearDraft();
          event.currentTarget.blur();
        }
      }}
      spellCheck={false}
    />
  );
}

function PatchTextEditor({
  value,
  onChange,
  diffSegments,
  hasManualPatch,
}: {
  value: string;
  onChange: (value: string) => void;
  diffSegments: DiffSegment[];
  hasManualPatch: boolean;
}) {
  const diffLayerRef = useRef<HTMLPreElement>(null);

  return (
    <div className={`patchEditorFrame ${hasManualPatch ? "manualPatch" : "noManualPatch"}`}>
      <pre className="patchDiffLayer" aria-hidden="true" ref={diffLayerRef}>
        {diffSegments.length === 0
          ? "\u00a0"
          : diffSegments.map((segment, index) => (
              <span className={`patchDiffSegment ${segment.kind}`} key={`${segment.kind}-${index}`}>
                {segment.text}
              </span>
            ))}
      </pre>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (!diffLayerRef.current) {
            return;
          }
          diffLayerRef.current.scrollTop = event.currentTarget.scrollTop;
          diffLayerRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        spellCheck={false}
      />
    </div>
  );
}

function ValueBlock({ title, source, label, value }: { title: string; source: CandidateValue["source"]; label: string; value: string }) {
  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <h3>{title}</h3>
        <span>
          <SourceBadge source={source} /> {label}
        </span>
      </div>
      <pre>{value || "None"}</pre>
    </section>
  );
}

function ReferenceValueBlock({
  referenceLocale,
  availableReferenceValues,
  onReferenceLocaleChange,
  hasEnUsValue,
}: {
  referenceLocale: LocaleCode;
  availableReferenceValues: readonly ReferenceValue[];
  onReferenceLocaleChange: (locale: LocaleCode) => void;
  hasEnUsValue: boolean;
}) {
  const referenceByLocale = new Map(availableReferenceValues.map((reference) => [reference.locale, reference]));
  const currentReference = referenceByLocale.get(referenceLocale);
  const source = currentReference?.source ?? "missing";
  const label = currentReference?.sourceLabel ?? "No reference";
  const value = currentReference?.value ?? "";

  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <label className="referenceSelectLabel">
          Reference
          {!hasEnUsValue ? (
            <span className="referenceWarningIcon" title="No en_us value" role="img" aria-label="No en_us value">
              <TriangleAlert size={14} />
            </span>
          ) : null}
          <select value={currentReference?.locale ?? ""} disabled={availableReferenceValues.length === 0} onChange={(event) => onReferenceLocaleChange(event.target.value)}>
            {availableReferenceValues.length === 0 ? <option value="">No reference</option> : null}
            {availableReferenceValues.map((reference) => (
              <option key={reference.locale} value={reference.locale}>
                {reference.locale}
              </option>
            ))}
          </select>
        </label>
        <span>
          <SourceBadge source={source} /> {label}
        </span>
      </div>
      <pre>{value || "None"}</pre>
    </section>
  );
}

function PhraseMatchesPanel({
  matches,
  activeLocale,
  referenceLocale,
}: {
  matches: PhraseMapping[];
  activeLocale: LocaleCode;
  referenceLocale: string;
}) {
  const targetTermsLocale = isChineseLocale(activeLocale) ? activeLocale : undefined;
  return (
    <section className="phraseMatchesPanel">
      <div className="panelHeader">
        <h2>Hint</h2>
        <span className="panelNote">{referenceLocale}</span>
      </div>
      <div className="phraseMatchList">
        {matches.map((mapping) => (
          <article className="phraseMatchRow" key={mapping.id}>
            <div className="phraseMatchMeta">
              <span className={`phraseSource ${mapping.source}`}>{mapping.source}</span>
              <strong>{mapping.id}</strong>
            </div>
            <div className="phraseMatchTerms">
              <span>
                <b>en_us</b>
                {joinPhraseTerms(mapping.en_us)}
              </span>
              <span>
                <b>{activeLocale}</b>
                {targetTermsLocale ? joinPhraseTerms(mapping[targetTermsLocale]) : "No Chinese glossary terms"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function rowId(row: CatalogRow): string {
  return `${row.namespace}\u0000${row.key}`;
}

function rowHasLocaleValue(row: CatalogRow, locale: LocaleCode, modTranslations: ModScanResult["translations"], sourcePacks: SourcePackScanResult[]): boolean {
  if (modTranslations[row.namespace]?.[locale]?.[row.key] !== undefined) {
    return true;
  }
  return sourcePacks.some((pack) => pack.translations[row.namespace]?.[locale]?.[row.key] !== undefined);
}

function resolveVisibleReferenceValue(
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

function llmReferenceModeLabel(mode: AppSettings["llmReferenceMode"]): string {
  switch (mode) {
    case "en_us":
      return "1. en_us only";
    case "fallback":
      return "2. fallback value";
    case "all":
      return "3. all valid values";
  }
}

function translationJobsForRows(
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

function rowNeedsTranslation(row: CatalogRow, locale: LocaleCode, sourceTargets: Record<SourceKind, boolean>): boolean {
  const entry = locale ? row.entries[locale] : undefined;
  return Boolean(entry && entryNeedsTranslation(entry, sourceTargets));
}

function entryNeedsTranslation(entry: ResolvedEntry, sourceTargets: Record<SourceKind, boolean>): boolean {
  return Boolean(entry.hasSource && hasLlmSourceText(entry.sourceValue) && sourceTargets[entry.final.source]);
}

function llmJobForEntry(
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

function hasLlmSourceText(jobOrText: LlmJob | string): boolean {
  const text = typeof jobOrText === "string" ? jobOrText : jobOrText.sourceText;
  return text.trim().length > 0;
}

function groupTableRows(rows: CatalogRow[]): TableItem[] {
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

function diffTextAgainstBase(base: string, value: string): DiffSegment[] {
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

function isManualEntryPatch(entry: ResolvedEntry | undefined): boolean {
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

function isActiveLlmCandidate(activePatch: PatchValue | undefined, candidate: PatchValue, candidateIndex: number): boolean {
  if (!activePatch || activePatch.meta?.generatedBy !== "llm") {
    return false;
  }
  return llmCandidateKey(activePatch, candidateIndex) === llmCandidateKey(candidate, candidateIndex);
}

function llmCandidateKey(candidate: PatchValue, index: number): string {
  return candidate.meta?.llmCandidateId ?? `${candidate.updatedAt}:${index}:${candidate.value}`;
}

function formatPatchTime(value: string): string {
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

function parentUnderManual(entry: ResolvedEntry): CandidateValue {
  return entry.base;
}

function buildStats(rows: CatalogRow[], locale: LocaleCode, project: LangpackProjectPatch) {
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

function countTranslationTargetsBySource(rows: CatalogRow[], locale: LocaleCode): Record<SourceKind, number> {
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

function moveListItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

class TranslationStoppedError extends Error {
  constructor() {
    super("LLM translation stopped.");
    this.name = "TranslationStoppedError";
  }
}

async function waitForTranslationResume(control: TranslationControl) {
  while (control.paused && !control.stopped) {
    await delay(250);
  }
}

function persistedLlmSettings(settings: LlmSettings): PersistedLlmSettings {
  const { apiKey: _apiKey, ...persisted } = settings;
  return persisted;
}

function restoreDraftState(draft: BrowserDraftState, restoredManualDraftRef: { current: { entryId: EntryId; value: string } | null }) {
  if (draft.manualDraftEntryId && typeof draft.manualDraft === "string") {
    restoredManualDraftRef.current = {
      entryId: draft.manualDraftEntryId,
      value: draft.manualDraft,
    };
  }
}

function normalizeProjectDraft(project: LangpackProjectPatch | undefined): LangpackProjectPatch {
  try {
    return normalizeProjectPatch(project);
  } catch {
    return createEmptyProjectPatch();
  }
}

function isLocaleCodeValue(value: unknown): value is LocaleCode {
  return typeof value === "string" && isValidLocaleCode(value);
}

function isPageId(value: unknown): value is PageId {
  return typeof value === "string" && (value === "project" || value === "sources" || value === "settings" || value.startsWith("namespace:"));
}

function isEntryDraftRecord(value: unknown): value is Record<EntryId, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((draft) => typeof draft === "string");
}

function formatDraftTime(value: string): string {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function translationHeaderText(progress: TranslationProgress): string {
  const action = progress.status === "paused" ? "paused" : progress.status === "stopping" ? "stopping" : "running";
  return `LLM translation ${action}: ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;
}

function estimateRemainingTime(progress: TranslationProgress, now: number): string {
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

function formatDuration(milliseconds: number): string {
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

function removeDraft(drafts: Record<EntryId, string>, id: EntryId): Record<EntryId, string> {
  const next = { ...drafts };
  delete next[id];
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
