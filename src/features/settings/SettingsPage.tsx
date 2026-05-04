import { ArrowDown, ArrowLeftRight, Download, FileJson, Loader2, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type Dispatch, type SetStateAction, useContext, useMemo, useState } from "react";
import { SourceBadge } from "../../components/SourceBadge";
import { FilePicker } from "../../components/FilePicker";
import { TargetLocalePicker } from "../../components/TargetLocalePicker";
import { ThemeModeSwitcher } from "../../components/ThemeModeSwitcher";
import { useI18n } from "../../app/i18n";
import { SourceLabelContext } from "../../app/sourceLabels";
import { FallbackChainEditor } from "./FallbackChainEditor";
import { FallbackOptionsPool, type FallbackPoolDrag } from "./FallbackOptionsPool";
import { LocaleOrderList, resolveLocaleOrderDropIndex } from "./LocaleOrderList";
import {
  CONVERT_SOURCE_ORDER,
  LLM_REFERENCE_MODES,
  SOURCE_LABEL_ORDER,
  APP_LOCALES,
  type AppSettings,
  type SourceLabelSettings,
  clamp,
  defaultFallbackChainForLocale,
  normalizeFallbackChain,
} from "../../lib/deploymentConfig";
import { BUNDLED_LOCALE_CODES, CHINESE_LOCALES, uniqueLocaleCodes } from "../../lib/locales";
import {
  isBuiltinGlossaryEntry,
  joinGlossaryTerms,
  normalizeGlossaryOverrides,
  glossaryOverrideFromEntry,
  splitGlossaryTerms,
} from "../../lib/glossary";
import { downloadBlob } from "../../lib/projectFile";
import type { LangpackProjectPatch, LocaleCode, GlossaryEntry } from "../../lib/types";
import type { LlmSettings } from "../../lib/llm";
import { errorMessage, llmReferenceModeLabel } from "../../app/helpers";
import type { StatusMessage } from "../../app/types";

export function SettingsPage({
  settings,
  setSettings,
  llmSettings,
  setLlmSettings,
  translating,
  availableModels,
  loadingModels,
  refreshModels,
  glossaryEntries,
  projectGlossary,
  hasRows,
  refreshConvertedValues,
  setProject,
  setStatus,
  defaultLlmSettings,
  loadedJarCount,
  clearLoadedJars,
  clearAllState,
  stateResetDisabled,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  llmSettings: LlmSettings;
  setLlmSettings: Dispatch<SetStateAction<LlmSettings>>;
  translating: boolean;
  availableModels: string[];
  loadingModels: boolean;
  refreshModels: () => Promise<string[]>;
  glossaryEntries: GlossaryEntry[];
  projectGlossary: LangpackProjectPatch["glossary"];
  hasRows: boolean;
  refreshConvertedValues: () => void;
  setProject: Dispatch<SetStateAction<LangpackProjectPatch>>;
  setStatus: Dispatch<SetStateAction<StatusMessage>>;
  defaultLlmSettings: LlmSettings;
  loadedJarCount: number;
  clearLoadedJars: () => void;
  clearAllState: () => void;
  stateResetDisabled: boolean;
}) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [activeFallbackLocale, setActiveFallbackLocale] = useState<LocaleCode | null>(null);
  const [fallbackPoolDrag, setFallbackPoolDrag] = useState<(FallbackPoolDrag & { targetLocale: LocaleCode | null; dropIndex: number | null }) | null>(null);
  const sourceLabels = useContext(SourceLabelContext);
  const { t } = useI18n();
  const resolvedActiveFallbackLocale = settings.targetLocales.includes(activeFallbackLocale ?? "")
    ? activeFallbackLocale
    : settings.targetLocales[0] ?? null;
  const activeFallbackChain = resolvedActiveFallbackLocale
    ? normalizeFallbackChain(resolvedActiveFallbackLocale, settings.fallbackChains[resolvedActiveFallbackLocale] ?? []).filter((fallbackLocale) => fallbackLocale !== "en_us")
    : [];
  const visibleGlossaryLocales = useMemo(
    () => uniqueLocaleCodes(["en_us", ...settings.targetLocales, ...CHINESE_LOCALES]),
    [settings.targetLocales],
  );
  const filteredGlossaryEntries = useMemo(() => {
    const normalizedQuery = glossaryQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return glossaryEntries;
    }
    return glossaryEntries.filter((entry) =>
      [
        entry.id,
        entry.source,
        Object.values(entry.terms).flat().join(" "),
        entry.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [glossaryEntries, glossaryQuery]);

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

  function updateGlossaryEntry(entry: GlossaryEntry, next: GlossaryEntry) {
    setProject((current) => ({
      ...current,
      glossary: {
        ...(current.glossary ?? {}),
        [entry.id]: glossaryOverrideFromEntry(next),
      },
    }));
  }

  function updateGlossaryEntryField<K extends keyof GlossaryEntry>(entry: GlossaryEntry, field: K, value: GlossaryEntry[K]) {
    updateGlossaryEntry(entry, { ...entry, [field]: value });
  }

  function updateGlossaryEntryTerms(entry: GlossaryEntry, locale: LocaleCode, terms: string[]) {
    updateGlossaryEntry(entry, {
      ...entry,
      terms: {
        ...entry.terms,
        [locale]: terms,
      },
    });
  }

  function resetGlossaryEntry(id: string) {
    setProject((current) => {
      const next = { ...(current.glossary ?? {}) };
      delete next[id];
      return { ...current, glossary: next };
    });
  }

  function resetBuiltinGlossaryEntries() {
    setProject((current) => ({
      ...current,
      glossary: Object.fromEntries(
        Object.entries(current.glossary ?? {}).filter(([id]) => !isBuiltinGlossaryEntry(id)),
      ),
    }));
    setStatus({ tone: "ok", text: "Curated Glossary overrides reset." });
  }

  function addCustomGlossaryEntry() {
    const id = `custom.${Date.now().toString(36)}`;
    const entry: GlossaryEntry = {
      id,
      enabled: true,
      source: "custom",
      terms: Object.fromEntries(visibleGlossaryLocales.map((locale) => [locale, []])),
    };
    setProject((current) => ({
      ...current,
      glossary: {
        ...(current.glossary ?? {}),
        [id]: glossaryOverrideFromEntry(entry),
      },
    }));
    setGlossaryQuery("");
  }

  async function importGlossaryEntries(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const imported = normalizeGlossaryOverrides(JSON.parse(await file.text()));
      setProject((current) => ({
        ...current,
        glossary: {
          ...(current.glossary ?? {}),
          ...imported,
        },
      }));
      setStatus({ tone: "ok", text: t("Imported {count} glossary override(s).", { count: Object.keys(imported).length.toLocaleString() }) });
    } catch (error) {
      setStatus({ tone: "error", text: errorMessage(error) });
    }
  }

  function exportGlossaryEntries() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, glossary: projectGlossary ?? {} }, null, 2) + "\n"], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, "minecraft-glossary.json");
    setStatus({ tone: "ok", text: "Glossary overrides exported." });
  }

  function updateTargetLocales(locales: LocaleCode[]) {
    const nextLocales = uniqueLocaleCodes(locales);
    setSettings((current) => {
      const fallbackChains = Object.fromEntries(
        Object.entries(current.fallbackChains).filter(([locale]) => nextLocales.includes(locale)),
      ) as AppSettings["fallbackChains"];
      for (const locale of nextLocales) {
        fallbackChains[locale] = current.fallbackChains[locale] ?? defaultFallbackChainForLocale(locale);
      }
      return {
        ...current,
        targetLocales: nextLocales,
        fallbackChains,
      };
    });
  }

  function updateFallbackChain(locale: LocaleCode, chain: string[]) {
    setSettings((current) => ({
      ...current,
      fallbackChains: {
        ...current.fallbackChains,
        [locale]: normalizeFallbackChain(locale, chain),
      },
    }));
  }

  function movableFallbackChain(locale: LocaleCode, sourceSettings = settings) {
    return normalizeFallbackChain(locale, sourceSettings.fallbackChains[locale] ?? []).filter((fallbackLocale) => fallbackLocale !== "en_us") as LocaleCode[];
  }

  function resolveFallbackPoolTarget(fallbackLocale: LocaleCode, x: number, y: number) {
    if (typeof document === "undefined") {
      return null;
    }
    const hit = document.elementFromPoint(x, y);
    const editor = hit?.closest<HTMLElement>("[data-fallback-chain-locale]");
    const targetLocale = editor?.dataset.fallbackChainLocale as LocaleCode | undefined;
    if (!editor || !targetLocale || !settings.targetLocales.includes(targetLocale)) {
      return null;
    }
    if (fallbackLocale === targetLocale || fallbackLocale === "en_us") {
      return { targetLocale, dropIndex: null };
    }
    const list = editor.querySelector<HTMLElement>("[data-locale-order-list]");
    const chain = movableFallbackChain(targetLocale);
    const fallbackIndex = chain.filter((locale) => locale !== fallbackLocale).length;
    return {
      targetLocale,
      dropIndex: resolveLocaleOrderDropIndex(list, x, y, fallbackLocale, fallbackIndex),
    };
  }

  function insertFallbackIntoChain(targetLocale: LocaleCode, fallbackLocale: LocaleCode, targetIndex?: number) {
    if (fallbackLocale === targetLocale || fallbackLocale === "en_us") {
      return;
    }
    setActiveFallbackLocale(targetLocale);
    setSettings((current) => {
      const chain = movableFallbackChain(targetLocale, current);
      const next = chain.filter((locale) => locale !== fallbackLocale);
      const boundedIndex = Math.max(0, Math.min(targetIndex ?? next.length, next.length));
      next.splice(boundedIndex, 0, fallbackLocale);
      return {
        ...current,
        fallbackChains: {
          ...current.fallbackChains,
          [targetLocale]: normalizeFallbackChain(targetLocale, next),
        },
      };
    });
  }

  function addFallbackToActive(fallbackLocale: LocaleCode) {
    if (!resolvedActiveFallbackLocale || fallbackLocale === resolvedActiveFallbackLocale || fallbackLocale === "en_us" || activeFallbackChain.includes(fallbackLocale)) {
      return;
    }
    insertFallbackIntoChain(resolvedActiveFallbackLocale, fallbackLocale);
  }

  function previewFallbackPoolDrag(drag: FallbackPoolDrag) {
    const target = resolveFallbackPoolTarget(drag.locale, drag.x, drag.y);
    if (target) {
      setActiveFallbackLocale(target.targetLocale);
    }
    setFallbackPoolDrag({
      ...drag,
      targetLocale: target?.targetLocale ?? null,
      dropIndex: target?.dropIndex ?? null,
    });
  }

  function finishFallbackPoolDrag(drag: FallbackPoolDrag) {
    const target = resolveFallbackPoolTarget(drag.locale, drag.x, drag.y);
    if (target && target.dropIndex !== null) {
      insertFallbackIntoChain(target.targetLocale, drag.locale, target.dropIndex);
    }
    setFallbackPoolDrag(null);
  }

  const fallbackSuggestions = uniqueLocaleCodes([...settings.targetLocales, ...BUNDLED_LOCALE_CODES]);
  const sharedFallbackOptions = fallbackSuggestions.filter((fallbackLocale) => fallbackLocale !== "en_us");

  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>{t("Settings")}</h2>
        {translating ? <Loader2 size={16} className="spin" /> : null}
      </div>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Target locales")}</h2>
          <span className="panelNote">{t("{count} selected", { count: settings.targetLocales.length.toLocaleString() })}</span>
        </div>
        <TargetLocalePicker selectedLocales={settings.targetLocales} onChange={updateTargetLocales} showSelectedList={false} />
        <div className="targetLocaleOrderTitle">{t("Target priority")}</div>
        <LocaleOrderList
          locales={settings.targetLocales}
          emptyText={t("Using en_us")}
          onChange={updateTargetLocales}
        />
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Appearance")}</h2>
        </div>
        <label>
          {t("App language")}
          <div className="segmentedControl wide">
            {APP_LOCALES.map((locale) => (
              <button
                type="button"
                key={locale}
                className={locale === settings.appLocale ? "active" : ""}
                onClick={() => setSettings((current) => ({ ...current, appLocale: locale }))}
              >
                {locale === "zh_tw" ? t("Traditional Chinese") : t("English")}
              </button>
            ))}
          </div>
        </label>
        <label className="settingsThemeField">
          {t("Theme")}
          <ThemeModeSwitcher value={settings.themeMode} onChange={(themeMode) => setSettings((current) => ({ ...current, themeMode }))} />
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Editor")}</h2>
        </div>
        <label>
          {t("Inspector width")}
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
        <label className="checkboxControl">
          <input
            type="checkbox"
            checked={settings.warnFormattingCodeMismatch}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                warnFormattingCodeMismatch: event.target.checked,
              }))
            }
          />
          {t("Warn on formatting code mismatches")}
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Browser storage")}</h2>
          <div className="buttonRow compact">
            <button type="button" className="danger" onClick={clearLoadedJars} disabled={loadedJarCount === 0 || stateResetDisabled}>
              <Trash2 size={16} />
              {t("Clear loaded jars")}
            </button>
            <button type="button" className="danger" onClick={clearAllState} disabled={stateResetDisabled}>
              <Trash2 size={16} />
              {t("Delete all state")}
            </button>
          </div>
        </div>
        <div className="targetHint">
          {t("{count} loaded jar(s). Clear loaded jars removes stored mod files and scan results; delete all state resets the app.", {
            count: loadedJarCount.toLocaleString(),
          })}
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Locale fallback")}</h2>
        </div>
        {settings.targetLocales.length === 0 ? <div className="emptyState">{t("Using en_us")}</div> : null}
        {settings.targetLocales.length ? (
          <FallbackOptionsPool
            activeLocale={resolvedActiveFallbackLocale}
            activeChain={activeFallbackChain}
            options={sharedFallbackOptions}
            dragLocale={fallbackPoolDrag?.locale ?? null}
            onAdd={addFallbackToActive}
            onDragMove={previewFallbackPoolDrag}
            onDragEnd={finishFallbackPoolDrag}
            onDragCancel={() => setFallbackPoolDrag(null)}
          />
        ) : null}
        {settings.targetLocales.map((locale) => (
          <FallbackChainEditor
            key={locale}
            locale={locale}
            chain={settings.fallbackChains[locale] ?? []}
            active={locale === resolvedActiveFallbackLocale || locale === fallbackPoolDrag?.targetLocale}
            externalDragLocale={fallbackPoolDrag?.targetLocale === locale ? fallbackPoolDrag.locale : null}
            externalDropIndex={fallbackPoolDrag?.targetLocale === locale ? fallbackPoolDrag.dropIndex : null}
            onActivate={() => setActiveFallbackLocale(locale)}
            setChain={(chain) => updateFallbackChain(locale, chain)}
          />
        ))}
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Convert")}</h2>
          <button type="button" onClick={refreshConvertedValues} disabled={!hasRows}>
            <ArrowLeftRight size={16} />
            {t("Refresh converted")}
          </button>
        </div>
        <div className="translateTargetGroup" aria-label={t("Convert sources")}>
          <span>{t("Convert from")}</span>
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
          {t("LLM source values")}
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
                {t(llmReferenceModeLabel(mode))}
              </option>
            ))}
          </select>
        </label>
        <div className="targetHint">{t("Starts from the selected source mode, then falls back to later modes when that source is unavailable.")}</div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Export")}</h2>
        </div>
        <div className="translateTargetGroup" aria-label={t("Export skipped sources")}>
          <span>{t("Skip keys from")}</span>
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
            {t("Checked sources are omitted from resource pack zip and patched jar exports. Vanilla, Jar, and Fallback are skipped by default.")}
          </div>
        </div>
      </section>
      <section className="panel settingsPanel glossaryPanel">
        <div className="panelHeader">
          <h2>{t("Glossary")}</h2>
          <span className="panelNote">{t("{count} shown", { count: filteredGlossaryEntries.length.toLocaleString() })}</span>
        </div>
        <div className="glossaryToolbar">
          <label className="searchBox">
            <Search size={16} />
            <input value={glossaryQuery} onChange={(event) => setGlossaryQuery(event.target.value)} placeholder={t("Search glossary")} />
          </label>
          <div className="buttonRow compact">
            <button type="button" onClick={addCustomGlossaryEntry}>
              <FileJson size={16} />
              {t("Add custom")}
            </button>
            <button type="button" onClick={resetBuiltinGlossaryEntries}>
              <RotateCcw size={16} />
              {t("Reset curated")}
            </button>
            <FilePicker label={t("Import")} accept=".json" onChange={importGlossaryEntries} icon={<Upload size={16} />} />
            <button type="button" onClick={exportGlossaryEntries}>
              <Download size={16} />
              {t("Export")}
            </button>
          </div>
        </div>
        <div className="glossaryList">
          {filteredGlossaryEntries.map((entry) => {
            const builtin = isBuiltinGlossaryEntry(entry.id);
            const overridden = Boolean(projectGlossary?.[entry.id]);
            return (
              <article className="glossaryCard" key={entry.id}>
                <div className="glossaryCardHead">
                  <label className="checkboxControl">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) => updateGlossaryEntryField(entry, "enabled", event.target.checked)}
                    />
                    {t("Enabled")}
                  </label>
                  <div className="glossaryIdentity">
                    <strong>{entry.id}</strong>
                    <span>
                      {entry.source}
                      {overridden ? " override" : ""}
                    </span>
                  </div>
                  <div className="buttonRow compact">
                    {builtin ? (
                      <button type="button" onClick={() => resetGlossaryEntry(entry.id)} disabled={!overridden}>
                        <RotateCcw size={16} />
                        {t("Reset")}
                      </button>
                    ) : (
                      <button type="button" className="danger" onClick={() => resetGlossaryEntry(entry.id)}>
                        <Trash2 size={16} />
                        {t("Delete")}
                      </button>
                    )}
                  </div>
                </div>
                <div className="glossaryGrid">
                  {visibleGlossaryLocales.map((locale) => (
                    <label key={locale}>
                      {locale}
                      <input
                        value={joinGlossaryTerms(entry.terms[locale] ?? [])}
                        onChange={(event) => updateGlossaryEntryTerms(entry, locale, splitGlossaryTerms(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  {t("Note")}
                  <input value={entry.note ?? ""} onChange={(event) => updateGlossaryEntryField(entry, "note", event.target.value)} />
                </label>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Source labels")}</h2>
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
          <h2>{t("LLM")}</h2>
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
            {t("Reset prompts")}
          </button>
        </div>
        <label className="checkboxControl">
          <input
            type="checkbox"
            checked={Boolean(llmSettings.debugMode)}
            onChange={(event) => setLlmSettings((current) => ({ ...current, debugMode: event.target.checked }))}
          />
          {t("Debug simulated LLM")}
        </label>
        <label>
          {t("Debug wait per batch (ms)")}
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
          {t("Base URL")}
          <input
            value={llmSettings.baseUrl}
            disabled={llmSettings.debugMode}
            onChange={(event) => setLlmSettings((current) => ({ ...current, baseUrl: event.target.value }))}
          />
        </label>
        <label>
          {t("Model")}
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
              {t("Models")}
            </button>
            {modelMenuOpen && availableModels.length ? (
              <div className="modelMenu" role="listbox" aria-label={t("Available models")}>
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
          {t("API Key")}
          <input
            type="password"
            value={llmSettings.apiKey}
            disabled={llmSettings.debugMode}
            onChange={(event) => setLlmSettings((current) => ({ ...current, apiKey: event.target.value }))}
          />
        </label>
        <label>
          {t("Batch size")}
          <input
            type="number"
            min="1"
            max="200"
            value={settings.llmBatchSize}
            onChange={(event) => setSettings((current) => ({ ...current, llmBatchSize: Number(event.target.value) || current.llmBatchSize }))}
          />
        </label>
        <label>
          {t("Parallel requests")}
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
          {t("System prompt")}
          <textarea
            className="promptTextarea"
            value={llmSettings.systemPrompt ?? ""}
            onChange={(event) => setLlmSettings((current) => ({ ...current, systemPrompt: event.target.value }))}
            spellCheck={false}
          />
        </label>
        <label>
          {t("User prompt")}
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
