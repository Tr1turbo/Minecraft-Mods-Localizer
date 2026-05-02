import { Download, Wand2 } from "lucide-react";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { TranslationProgressPanel } from "../../components/TranslationProgressPanel";
import { LlmWarningsPanel } from "../../components/LlmWarningsPanel";
import { Metric } from "../../components/Metric";
import { SourceBadge } from "../../components/SourceBadge";
import { SOURCE_TRANSLATE_TARGET_ORDER, type AppSettings } from "../../lib/deploymentConfig";
import type { CatalogRow, LocaleCode } from "../../lib/types";
import { buildStats, countTranslationTargetsBySource } from "../../app/helpers";
import type { ProjectMode, SourcePackMode, TranslationProgress } from "../../app/types";

export function ProjectPage({
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
          {translationProgress?.showPanel ? (
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
