import {
  Download,
  FileJson,
  Package,
  Settings,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { BROWSER_DRAFT_SCHEMA_VERSION, EMPTY_SCAN } from "./app/constants";
import { useBrowserDraftPersistence } from "./app/hooks/useBrowserDraftPersistence";
import { useLlmTranslation } from "./app/hooks/useLlmTranslation";
import { SourceLabelContext } from "./app/sourceLabels";
import type { BrowserDraftState, PageId, StatusMessage } from "./app/types";
import {
  buildStats,
  diffTextAgainstBase,
  errorMessage,
  groupTableRows,
  isActiveLlmCandidate,
  isManualEntryPatch,
  llmJobForEntry,
  parentUnderManual,
  persistedLlmSettings,
  removeDraft,
  resolveVisibleReferenceValue,
  rowId,
  translationHeaderText,
  translationJobsForRows,
} from "./app/helpers";
import { FilePicker } from "./components/FilePicker";
import { NamespaceWorkspace } from "./features/namespace/NamespaceWorkspace";
import { ProjectPage } from "./features/project/ProjectPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SourcesPage } from "./features/sources/SourcesPage";
import { createResourcePackZip } from "./lib/exportPack";
import { createPatchedJarDownload } from "./lib/exportJars";
import { protectedTokenWarnings } from "./lib/placeholders";
import {
  effectiveGlossaryEntries,
  glossaryWithInternalVanilla,
  selectGlossaryEntriesForReference,
} from "./lib/glossary";
import {
  buildCatalog,
  createEmptyProjectPatch,
  createPatchValue,
  resolveReferenceValuesForKey,
  revertManualKey,
  revertManualNamespace,
} from "./lib/patches";
import { downloadBlob, projectPatchBlob, readProjectPatchFile } from "./lib/projectFile";
import { scanModJars, scanResourcePack } from "./lib/scanner";
import type {
  EntryId,
  LangpackProjectPatch,
  LocaleCode,
  ModScanResult,
  PatchValue,
  ResolvedEntry,
  SourcePackScanResult,
} from "./lib/types";
import { effectiveTargetLocales, normalizeLocaleCode } from "./lib/locales";
import { compareNamespaceNames } from "./lib/vanilla";
import { type LlmSettings } from "./lib/llm";
import {
  type AppSettings,
  type DeploymentDefaults,
  type SourceLabelSettings,
  clamp,
  createDefaultAppSettings,
  createDefaultDeploymentDefaults,
  createDefaultLlmSettings,
  createDefaultSourceLabels,
  mergeAppSettings,
  mergeLlmSettings,
  SOURCE_LABEL_ORDER,
} from "./lib/deploymentConfig";
import {
  clearBrowserDraftModFiles,
  clearBrowserDraftStorage,
  writeBrowserDraftSnapshot,
} from "./lib/browserDraft";

const appIconPath = "./assets/icon.svg";

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
  const [status, setStatus] = useState<StatusMessage>({ tone: "idle", text: "Ready" });
  const [deploymentDefaults, setDeploymentDefaults] = useState<DeploymentDefaults>(() => createDefaultDeploymentDefaults());
  const [sourceLabels, setSourceLabels] = useState<SourceLabelSettings>(() => createDefaultSourceLabels());
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => createDefaultLlmSettings());

  const glossaryEntries = useMemo(() => effectiveGlossaryEntries(project.glossary), [project.glossary]);
  const runtimeGlossary = useMemo(() => glossaryWithInternalVanilla(glossaryEntries), [glossaryEntries]);
  const {
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
  } = useLlmTranslation({
    project,
    setProject,
    modScan,
    sourcePacks,
    runtimeGlossary,
    settings,
    llmSettings,
    setStatus,
  });
  const targetLocales = useMemo(() => effectiveTargetLocales(settings.targetLocales), [settings.targetLocales]);
  const rows = useMemo(
    () =>
      buildCatalog(
        modScan.translations,
        sourcePacks,
        project,
        settings.fallbackChains,
        runtimeGlossary,
        settings.convertSources,
        targetLocales,
      ),
    [
      modScan.translations,
      sourcePacks,
      project,
      settings.fallbackChains,
      runtimeGlossary,
      settings.convertSources,
      targetLocales,
    ],
  );
  const namespaces = useMemo(() => Array.from(new Set(rows.map((row) => row.namespace))).sort(compareNamespaceNames), [rows]);
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
  const manualWarnings = selectedEntry
    ? protectedTokenWarnings(selectedEntry.sourceValue, manualDraft, {
        includeFormattingCodes: settings.warnFormattingCodeMismatch,
      })
    : [];
  const manualDiffSegments = useMemo(
    () => diffTextAgainstBase(selectedEntry?.base.value ?? "", manualDraft),
    [manualDraft, selectedEntry?.base.value],
  );
  const hasManualPatch = isManualEntryPatch(selectedEntry);
  const selectedLlmCandidates = selectedEntry ? (project.llmCandidates?.[selectedEntry.id] ?? []) : [];
  const selectedLiveLlmOutput = selectedEntry ? translationProgress?.liveOutputs.find((output) => output.id === selectedEntry.id) : undefined;
  const selectedLlmDisplayDraft = selectedEntry ? llmCandidateDisplayDrafts[selectedEntry.id] : undefined;
  const hasUnsavedPatchEdit = Boolean(selectedEntry && manualDraft !== (selectedEntry.patch?.value ?? selectedEntry.final.value));
  const selectedReferenceValues = useMemo(
    () =>
      selectedRow
        ? resolveReferenceValuesForKey(modScan.translations, sourcePacks, project, selectedRow.namespace, selectedRow.key)
        : [],
    [modScan.translations, project, selectedRow, sourcePacks],
  );
  const selectedReference = resolveVisibleReferenceValue(selectedReferenceValues, referenceLocale, referenceFallbackLocale);
  const selectedGlossaryMatches = useMemo(
    () =>
      selectedRow && activeLocale && selectedReference
        ? selectGlossaryEntriesForReference({ key: selectedRow.key, locale: selectedReference.locale, value: selectedReference.value }, runtimeGlossary, 80)
        : [],
    [activeLocale, runtimeGlossary, selectedReference, selectedRow],
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
      Object.keys(project.glossary ?? {}).length > 0 ||
      Object.keys(inlineDrafts).length > 0 ||
      Boolean(selectedEntry && manualDraft !== (selectedEntry.patch?.value ?? selectedEntry.final.value)),
    [inlineDrafts, manualDraft, modScan.fingerprints.length, project, selectedEntry, sourcePacks.length],
  );

  const { pauseAutosave, resetSavedModFileKey, resumeAutosave, restoredManualDraftRef } = useBrowserDraftPersistence({
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
  });

  useEffect(() => {
    if (activePage.startsWith("namespace:") && activeNamespace && !namespaces.includes(activeNamespace)) {
      setActivePage(namespaces.length > 0 ? `namespace:${namespaces[0]}` : "project");
    }
  }, [activeNamespace, activePage, namespaces]);

  useEffect(() => {
    if (!targetLocales.includes(activeLocale)) {
      setActiveLocale(targetLocales[0]);
    }
  }, [activeLocale, targetLocales]);

  useEffect(() => {
    if (!targetLocales.includes(referenceFallbackLocale)) {
      setReferenceFallbackLocale(activeLocale && targetLocales.includes(activeLocale) ? activeLocale : targetLocales[0]);
    }
  }, [activeLocale, referenceFallbackLocale, targetLocales]);

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
    const warnings = protectedTokenWarnings(entry.sourceValue, value, {
      includeFormattingCodes: settings.warnFormattingCodeMismatch,
    });
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
    await translateJobs([job], "Selected key", { animateSingleCandidate: true, seedLiveOutput: true, showProgressPanel: false });
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

  function refreshConvertedValues() {
    setProject((current) => ({
      ...current,
      patches: Object.fromEntries(Object.entries(current.patches ?? {}).filter(([, patch]) => patch.meta?.generatedBy !== "converted")),
    }));
    setStatus({ tone: "ok", text: "Converted base values refreshed." });
  }

  async function exportProjectPatch() {
    const exportProject: LangpackProjectPatch = {
      ...project,
      schemaVersion: 3,
      locales: [...targetLocales],
      fallbackChains: { ...settings.fallbackChains },
      sourceLocalePriority: [],
      llmCandidates: project.llmCandidates ?? {},
      glossary: project.glossary ?? {},
      modFingerprints: modScan.fingerprints,
      sourcePackOrder: sourcePacks.map((pack) => pack.fingerprint),
    };
    downloadBlob(projectPatchBlob(exportProject), "minecraft-langpatch.json");
    setStatus({ tone: "ok", text: "Project patch exported." });
  }

  async function exportResourcePack() {
    if (rows.length === 0) {
      setStatus({ tone: "warn", text: "Load mod jars before exporting." });
      return;
    }
    await runBusy("Resource pack zip exported.", async () => {
      const blob = await createResourcePackZip(rows, targetLocales, {
        packFormat: settings.packFormat,
        description: `${settings.description}\nLocales: ${targetLocales.join(", ")}`,
        sourcePacks,
        sourcePackMode: settings.sourcePackMode,
        skipSources: settings.exportSkipSources,
      });
      downloadBlob(blob, "Minecraft-Mods-Localizer.zip");
    });
  }

  async function exportPatchedJars() {
    if (modFiles.length === 0 || rows.length === 0) {
      setStatus({ tone: "warn", text: "Load mod jars before exporting patched jars." });
      return;
    }
    let summary = "";
    await runBusy("Patched jar export created.", async () => {
      const result = await createPatchedJarDownload(modFiles, rows, targetLocales, {
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
      resetSavedModFileKey();
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

  async function clearAllState() {
    if (busy || translating) {
      setStatus({ tone: "warn", text: "Wait for the current operation to finish before clearing state." });
      return;
    }
    const confirmed = window.confirm("Delete all app state and this app's browser storage? Export a patch first if you need this work.");
    if (!confirmed) {
      return;
    }

    const defaultSettings = mergeAppSettings(undefined, deploymentDefaults.settings);
    const defaultLlmSettings = mergeLlmSettings(deploymentDefaults.llmSettings, undefined);
    const defaultSourceLabels = Object.fromEntries(
      SOURCE_LABEL_ORDER.map((source) => [source, { ...deploymentDefaults.sourceLabels[source] }]),
    ) as SourceLabelSettings;

    pauseAutosave();
    setBusy(true);
    setModFiles([]);
    setModScan(EMPTY_SCAN);
    setSourcePacks([]);
    setProject(createEmptyProjectPatch());
    setActiveLocale("");
    setActivePage("project");
    setSettings(defaultSettings);
    setReferenceLocale("en_us");
    setReferenceFallbackLocale("");
    setSelectedKey("");
    setQuery("");
    setManualDraft("");
    setInlineDrafts({});
    setLlmSettings(defaultLlmSettings);
    setLlmWarnings([]);
    setSourceLabels(defaultSourceLabels);

    try {
      await clearBrowserDraftStorage();
      setStatus({ tone: "ok", text: "All app state and browser storage cleared." });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    } finally {
      resumeAutosave();
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
    if (targetLocales.includes(normalizedLocale)) {
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
        <div className="brandBlock">
          <img className="brandIcon" src={appIconPath} alt="" aria-hidden="true" />
          <div>
            <h1>Minecraft Mods Localizer</h1>
            <div className={`statusLine ${status.tone}`}>{headerStatusText}</div>
          </div>
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
            targetLocales={targetLocales}
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
            glossaryEntries={glossaryEntries}
            projectGlossary={project.glossary ?? {}}
            hasRows={rows.length > 0}
            refreshConvertedValues={refreshConvertedValues}
            setProject={setProject}
            setStatus={setStatus}
            defaultLlmSettings={deploymentDefaults.llmSettings}
            loadedJarCount={modScan.fingerprints.length}
            clearLoadedJars={clearLoadedJars}
            clearAllState={clearAllState}
            stateResetDisabled={busy || translating}
          />
        ) : null}

        {activePage.startsWith("namespace:") ? (
          <NamespaceWorkspace
            activeNamespace={activeNamespace}
            filteredRows={filteredRows}
            rowsCount={rows.length}
            tableItems={tableItems}
            selectedRow={selectedRow}
            selectedEntry={selectedEntry}
            activeLocale={activeLocale}
            setActiveLocale={setActiveLocale}
            settings={settings}
            setSettings={setSettings}
            modTranslations={modScan.translations}
            sourcePacks={sourcePacks}
            query={query}
            setQuery={setQuery}
            setSelectedKey={setSelectedKey}
            inlineDrafts={inlineDrafts}
            setInlineDrafts={setInlineDrafts}
            saveManualPatchForEntry={saveManualPatchForEntry}
            translationProgress={translationProgress}
            pauseTranslationJob={pauseTranslationJob}
            resumeTranslationJob={resumeTranslationJob}
            stopTranslationJob={stopTranslationJob}
            llmWarnings={llmWarnings}
            clearLlmWarnings={() => setLlmWarnings([])}
            translating={translating}
            namespaceMissingCount={namespaceMissingCount}
            allMissingCount={allMissingCount}
            translateNamespace={translateNamespace}
            translateAll={translateAll}
            revertNamespaceManualPatches={revertNamespaceManualPatches}
            startInspectorResize={startInspectorResize}
            moveInspectorResize={moveInspectorResize}
            stopInspectorResize={stopInspectorResize}
            selectedReferenceLocale={selectedReference?.locale ?? ""}
            referenceLocale={referenceLocale}
            selectedReferenceValues={selectedReferenceValues}
            updateReferenceLocale={updateReferenceLocale}
            selectedGlossaryMatches={selectedGlossaryMatches}
            selectedLlmCandidates={selectedLlmCandidates}
            selectedLiveLlmOutput={selectedLiveLlmOutput}
            selectedLlmDisplayDraft={selectedLlmDisplayDraft}
            llmModel={llmSettings.model}
            manualDraft={manualDraft}
            setManualDraft={setManualDraft}
            manualDiffSegments={manualDiffSegments}
            manualWarnings={manualWarnings}
            hasManualPatch={hasManualPatch}
            saveManualPatch={saveManualPatch}
            revertSelectedManualPatch={revertSelectedManualPatch}
            translateSelected={translateSelected}
            useLlmCandidate={useLlmCandidate}
            deleteLlmCandidate={deleteLlmCandidate}
          />
        ) : null}
      </section>
      </main>
    </SourceLabelContext.Provider>
  );
}

export default App;
