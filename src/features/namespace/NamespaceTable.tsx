import { Search, TriangleAlert } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { LlmWarningsPanel } from "../../components/LlmWarningsPanel";
import { TranslationProgressPanel } from "../../components/TranslationProgressPanel";
import { Tooltip } from "../../components/Tooltip";
import { removeDraft, rowHasLocaleValue, rowId } from "../../app/helpers";
import { useI18n } from "../../app/i18n";
import type { TableItem, TranslationProgress } from "../../app/types";
import type { AppSettings } from "../../lib/deploymentConfig";
import { effectiveTargetLocales } from "../../lib/locales";
import type { CatalogRow, EntryId, LocaleCode, ModScanResult, ResolvedEntry, SourcePackScanResult } from "../../lib/types";
import { InlineValueEditor } from "./InlineValueEditor";
import { SourceBadge } from "../../components/SourceBadge";

interface NamespaceTableProps {
  filteredRows: CatalogRow[];
  tableItems: TableItem[];
  selectedRow: CatalogRow | undefined;
  activeLocale: LocaleCode;
  settings: AppSettings;
  modTranslations: ModScanResult["translations"];
  sourcePacks: SourcePackScanResult[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  setActiveLocale: Dispatch<SetStateAction<LocaleCode>>;
  setSelectedKey: Dispatch<SetStateAction<string>>;
  inlineDrafts: Record<EntryId, string>;
  setInlineDrafts: Dispatch<SetStateAction<Record<EntryId, string>>>;
  saveManualPatchForEntry: (entry: ResolvedEntry | undefined, value: string, options?: { quiet?: boolean }) => Promise<void>;
  translationProgress: TranslationProgress | null;
  pauseTranslationJob: () => void;
  resumeTranslationJob: () => void;
  stopTranslationJob: () => void;
  llmWarnings: string[];
  clearLlmWarnings: () => void;
}

export function NamespaceTable({
  filteredRows,
  tableItems,
  selectedRow,
  activeLocale,
  settings,
  modTranslations,
  sourcePacks,
  query,
  setQuery,
  setActiveLocale,
  setSelectedKey,
  inlineDrafts,
  setInlineDrafts,
  saveManualPatchForEntry,
  translationProgress,
  pauseTranslationJob,
  resumeTranslationJob,
  stopTranslationJob,
  llmWarnings,
  clearLlmWarnings,
}: NamespaceTableProps) {
  const { t } = useI18n();
  const targetLocales = effectiveTargetLocales(settings.targetLocales);
  return (
    <>
      {llmWarnings.length ? <LlmWarningsPanel warnings={llmWarnings} clearWarnings={clearLlmWarnings} /> : null}
      <div className="tableToolbar">
        <div className="localeTabs" role="tablist" aria-label={t("Locales")}>
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
        <label className="searchBox">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search keys or values")} />
        </label>
      </div>

      {translationProgress?.showPanel ? (
        <TranslationProgressPanel
          progress={translationProgress}
          pauseTranslationJob={pauseTranslationJob}
          resumeTranslationJob={resumeTranslationJob}
          stopTranslationJob={stopTranslationJob}
        />
      ) : null}
      <div className="entryTable" role="table">
        <div className="entryTableHead" role="row">
          <span>{t("Key")}</span>
          <span>{t("Source")}</span>
          <span>{t("Value")}</span>
        </div>
        <div className="entryTableBody">
          {filteredRows.length === 0 ? (
            <div className="emptyState tableEmpty">{t("No keys loaded")}</div>
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
              const hasEnUsValue = rowHasLocaleValue(row, "en_us", modTranslations, sourcePacks);
              return (
                <div
                  className={`entryRow ${selectedRow && rowId(selectedRow) === rowId(row) ? "selected" : ""}`}
                  key={rowId(row)}
                  role="row"
                  onClick={() => setSelectedKey(rowId(row))}
                >
                  <span className="keyCell">
                    <Tooltip content={row.key} className="keyTooltip">
                      <button type="button" className="keyButton" aria-label={row.key} onClick={() => setSelectedKey(rowId(row))}>
                        {item.displayKey}
                      </button>
                    </Tooltip>
                    {!hasEnUsValue ? (
                      <Tooltip content={t("No en_us value")}>
                        <span className="keyWarningIcon" role="img" aria-label={t("No en_us value")} tabIndex={0}>
                          <TriangleAlert size={14} />
                        </span>
                      </Tooltip>
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
    </>
  );
}
