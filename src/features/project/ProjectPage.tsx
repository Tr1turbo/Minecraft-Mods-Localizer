import { Download, Wand2 } from "lucide-react";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { TranslationProgressPanel } from "../../components/TranslationProgressPanel";
import { LlmWarningsPanel } from "../../components/LlmWarningsPanel";
import { Metric } from "../../components/Metric";
import { SourceBadge } from "../../components/SourceBadge";
import { useI18n } from "../../app/i18n";
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
  targetLocales,
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
  targetLocales: readonly LocaleCode[];
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
  const { t } = useI18n();
  const namespaceCount = new Set(rows.map((row) => row.namespace)).size;
  const sourceTargetCounts = useMemo(() => countTranslationTargetsBySource(rows, activeLocale), [activeLocale, rows]);
  const missingSourceRows = useMemo(
    () => (activeLocale ? rows.filter((row) => row.entries[activeLocale]?.final.source === "missing").length : 0),
    [activeLocale, rows],
  );
  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>{t("Project")}</h2>
      </div>
      <section className="panel metricsPanel wide">
        <Metric label={t("Namespaces")} value={namespaceCount} />
        <Metric label={t("Keys")} value={rows.length} />
        <Metric label={t("Mod files")} value={modCount} />
        <Metric label={t("Update packs")} value={sourceCount} />
        <Metric label={t("Manual patches")} value={stats.manual} />
        <Metric label={t("LLM patches")} value={stats.llm} />
        <Metric label={t("Converted values")} value={stats.converted} />
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Project mode")}</h2>
        </div>
        <label>
          {t("Mode")}
          <select
            value={settings.projectMode}
            onChange={(event) => setSettings((current) => ({ ...current, projectMode: event.target.value as ProjectMode }))}
          >
            <option value="resourcePack">{t("Minecraft resource pack")}</option>
          </select>
        </label>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Export")}</h2>
        </div>
        <label>
          {t("Update From pack contents")}
          <select
            value={settings.sourcePackMode}
            onChange={(event) => setSettings((current) => ({ ...current, sourcePackMode: event.target.value as SourcePackMode }))}
          >
            <option value="prune">{t("Prune to loaded mod namespaces")}</option>
            <option value="keep">{t("Keep other namespaces from Update From packs")}</option>
          </select>
        </label>
        <label>
          {t("Pack format")}
          <input
            type="number"
            min="1"
            value={settings.packFormat}
            onChange={(event) => setSettings((current) => ({ ...current, packFormat: Number(event.target.value) || current.packFormat }))}
          />
        </label>
        <label>
          {t("Description")}
          <input value={settings.description} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} />
        </label>
        <div className="targetHint">
          {t("Resource pack export creates a normal pack zip. Jar export creates modified copies of loaded mod jars and writes final lang JSON into matching namespaces; the original local jars are not changed.")}
        </div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <h2>{t("Project actions")}</h2>
          <span className="panelNote">{t("{count} target key(s)", { count: allMissingCount.toLocaleString() })}</span>
        </div>
        <div className="projectActionPanel">
          <div className="localeTabs" role="tablist" aria-label={t("Project action locale")}>
            {targetLocales.map((locale) => (
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
          <div className="translateTargetGroup" aria-label={t("Translate targets")}>
            <span>{t("Translate target")}</span>
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
                {t("{count} row(s) have no source value. The key is shown only as a placeholder and will not be translated.", {
                  count: missingSourceRows.toLocaleString(),
                })}
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
              {t("Translate all")}
            </button>
            <button type="button" onClick={exportProjectPatch}>
              <Download size={16} />
              {t("Export patch")}
            </button>
            <button type="button" onClick={exportResourcePack} disabled={rows.length === 0}>
              <Download size={16} />
              {t("Export zip")}
            </button>
            <button type="button" onClick={exportPatchedJars} disabled={rows.length === 0 || modCount === 0}>
              <Download size={16} />
              {t("Export jars")}
            </button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <h2>{t("Workflow")}</h2>
        </div>
        <div className="workflowList">
          <span>{t("Load mod jars from the top bar.")}</span>
          <span>{t("Add Update From resource packs and order them by priority.")}</span>
          <span>{t("Open a namespace page, edit values inline, or use the detail panel.")}</span>
          <span>{t("Export a patch file, final resource pack zip, or patched jar copies.")}</span>
        </div>
      </section>
    </section>
  );
}
