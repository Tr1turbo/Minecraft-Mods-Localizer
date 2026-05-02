import { Search, TriangleAlert } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { LlmWarningsPanel } from "../../components/LlmWarningsPanel";
import { TranslationProgressPanel } from "../../components/TranslationProgressPanel";
import { removeDraft, rowHasLocaleValue, rowId } from "../../app/helpers";
import type { TableItem, TranslationProgress } from "../../app/types";
import type { AppSettings } from "../../lib/deploymentConfig";
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
  return (
    <>
      {llmWarnings.length ? <LlmWarningsPanel warnings={llmWarnings} clearWarnings={clearLlmWarnings} /> : null}
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
              const hasEnUsValue = rowHasLocaleValue(row, "en_us", modTranslations, sourcePacks);
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
    </>
  );
}
