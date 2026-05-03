import { ArrowDown, ArrowLeftRight, Check, Download, FileJson, Loader2, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type Dispatch, type SetStateAction, useContext, useMemo, useState } from "react";
import { SourceBadge } from "../../components/SourceBadge";
import { FilePicker } from "../../components/FilePicker";
import { SourceLabelContext } from "../../app/sourceLabels";
import { FallbackChainEditor } from "./FallbackChainEditor";
import { LocaleOrderList } from "./LocaleOrderList";
import {
  CONVERT_SOURCE_ORDER,
  LLM_REFERENCE_MODES,
  SOURCE_LABEL_ORDER,
  type AppSettings,
  type SourceLabelSettings,
  clamp,
  defaultFallbackChainForLocale,
  normalizeFallbackChain,
} from "../../lib/deploymentConfig";
import { BUNDLED_LOCALE_CODES, CHINESE_LOCALES, isValidLocaleCode, normalizeLocaleCode, uniqueLocaleCodes } from "../../lib/locales";
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
import { errorMessage, llmReferenceModeLabel, moveListItem } from "../../app/helpers";
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
  const [targetLocaleDraft, setTargetLocaleDraft] = useState("");
  const sourceLabels = useContext(SourceLabelContext);
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
      setStatus({ tone: "ok", text: `Imported ${Object.keys(imported).length.toLocaleString()} glossary override(s).` });
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
          [normalized]: current.fallbackChains[normalized] ?? defaultFallbackChainForLocale(normalized),
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
          emptyText="Using en_us"
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
          Warn on formatting code mismatches
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Browser storage</h2>
          <div className="buttonRow compact">
            <button type="button" className="danger" onClick={clearLoadedJars} disabled={loadedJarCount === 0 || stateResetDisabled}>
              <Trash2 size={16} />
              Clear loaded jars
            </button>
            <button type="button" className="danger" onClick={clearAllState} disabled={stateResetDisabled}>
              <Trash2 size={16} />
              Delete all state
            </button>
          </div>
        </div>
        <div className="targetHint">
          {loadedJarCount.toLocaleString()} loaded jar(s). Clear loaded jars removes stored mod files and scan results; delete all state resets the app.
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>Locale fallback</h2>
        </div>
        {settings.targetLocales.length === 0 ? <div className="emptyState">Using en_us</div> : null}
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
            Checked sources are omitted from resource pack zip and patched jar exports. Vanilla, Jar, and Fallback are skipped by default.
          </div>
        </div>
      </section>
      <section className="panel settingsPanel glossaryPanel">
        <div className="panelHeader">
          <h2>Glossary</h2>
          <span className="panelNote">{filteredGlossaryEntries.length.toLocaleString()} shown</span>
        </div>
        <div className="glossaryToolbar">
          <label className="searchBox">
            <Search size={16} />
            <input value={glossaryQuery} onChange={(event) => setGlossaryQuery(event.target.value)} placeholder="Search glossary" />
          </label>
          <div className="buttonRow compact">
            <button type="button" onClick={addCustomGlossaryEntry}>
              <FileJson size={16} />
              Add custom
            </button>
            <button type="button" onClick={resetBuiltinGlossaryEntries}>
              <RotateCcw size={16} />
              Reset curated
            </button>
            <FilePicker label="Import" accept=".json" onChange={importGlossaryEntries} icon={<Upload size={16} />} />
            <button type="button" onClick={exportGlossaryEntries}>
              <Download size={16} />
              Export
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
                    Enabled
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
                        Reset
                      </button>
                    ) : (
                      <button type="button" className="danger" onClick={() => resetGlossaryEntry(entry.id)}>
                        <Trash2 size={16} />
                        Delete
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
                  Note
                  <input value={entry.note ?? ""} onChange={(event) => updateGlossaryEntryField(entry, "note", event.target.value)} />
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
