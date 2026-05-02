import { RotateCcw, Wand2 } from "lucide-react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";

import { NamespaceInspector } from "./NamespaceInspector";
import { NamespaceTable } from "./NamespaceTable";
import { clamp, type AppSettings } from "../../lib/deploymentConfig";
import type {
  CatalogRow,
  EntryId,
  LocaleCode,
  ModScanResult,
  PatchValue,
  PhraseMapping,
  ReferenceValue,
  ResolvedEntry,
  SourcePackScanResult,
} from "../../lib/types";
import type { DiffSegment, LlmLiveOutput, TableItem, TranslationProgress } from "../../app/types";

interface NamespaceWorkspaceProps {
  activeNamespace: string;
  filteredRows: CatalogRow[];
  rowsCount: number;
  tableItems: TableItem[];
  selectedRow: CatalogRow | undefined;
  selectedEntry: ResolvedEntry | undefined;
  activeLocale: LocaleCode;
  setActiveLocale: Dispatch<SetStateAction<LocaleCode>>;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  modTranslations: ModScanResult["translations"];
  sourcePacks: SourcePackScanResult[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
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
  translating: boolean;
  namespaceMissingCount: number;
  allMissingCount: number;
  translateNamespace: () => Promise<void>;
  translateAll: () => Promise<void>;
  revertNamespaceManualPatches: () => void;
  startInspectorResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  moveInspectorResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  stopInspectorResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  selectedReferenceLocale: LocaleCode;
  referenceLocale: LocaleCode;
  selectedReferenceValues: readonly ReferenceValue[];
  updateReferenceLocale: (locale: LocaleCode) => void;
  selectedPhraseMatches: PhraseMapping[];
  selectedLlmCandidates: PatchValue[];
  selectedLiveLlmOutput: LlmLiveOutput | undefined;
  selectedLlmDisplayDraft: string | undefined;
  llmModel: string;
  manualDraft: string;
  setManualDraft: (value: string) => void;
  manualDiffSegments: DiffSegment[];
  manualWarnings: string[];
  hasManualPatch: boolean;
  saveManualPatch: () => Promise<void>;
  revertSelectedManualPatch: () => void;
  translateSelected: () => Promise<void>;
  useLlmCandidate: (candidate: PatchValue, index: number) => void;
  deleteLlmCandidate: (candidate: PatchValue, index: number) => void;
}

export function NamespaceWorkspace({
  activeNamespace,
  filteredRows,
  rowsCount,
  tableItems,
  selectedRow,
  selectedEntry,
  activeLocale,
  setActiveLocale,
  settings,
  setSettings,
  modTranslations,
  sourcePacks,
  query,
  setQuery,
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
  translating,
  namespaceMissingCount,
  allMissingCount,
  translateNamespace,
  translateAll,
  revertNamespaceManualPatches,
  startInspectorResize,
  moveInspectorResize,
  stopInspectorResize,
  selectedReferenceLocale,
  referenceLocale,
  selectedReferenceValues,
  updateReferenceLocale,
  selectedPhraseMatches,
  selectedLlmCandidates,
  selectedLiveLlmOutput,
  selectedLlmDisplayDraft,
  llmModel,
  manualDraft,
  setManualDraft,
  manualDiffSegments,
  manualWarnings,
  hasManualPatch,
  saveManualPatch,
  revertSelectedManualPatch,
  translateSelected,
  useLlmCandidate,
  deleteLlmCandidate,
}: NamespaceWorkspaceProps) {
  return (
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
            <button type="button" onClick={translateAll} disabled={rowsCount === 0 || translating || allMissingCount === 0}>
              <Wand2 size={16} />
              Translate all
            </button>
            <button type="button" onClick={revertNamespaceManualPatches} disabled={!activeNamespace}>
              <RotateCcw size={16} />
              Revert namespace edits
            </button>
          </div>
        </div>
        <NamespaceTable
          filteredRows={filteredRows}
          tableItems={tableItems}
          selectedRow={selectedRow}
          activeLocale={activeLocale}
          settings={settings}
          modTranslations={modTranslations}
          sourcePacks={sourcePacks}
          query={query}
          setQuery={setQuery}
          setActiveLocale={setActiveLocale}
          setSelectedKey={setSelectedKey}
          inlineDrafts={inlineDrafts}
          setInlineDrafts={setInlineDrafts}
          saveManualPatchForEntry={saveManualPatchForEntry}
          translationProgress={translationProgress}
          pauseTranslationJob={pauseTranslationJob}
          resumeTranslationJob={resumeTranslationJob}
          stopTranslationJob={stopTranslationJob}
          llmWarnings={llmWarnings}
          clearLlmWarnings={clearLlmWarnings}
        />
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
        <NamespaceInspector
          selectedEntry={selectedEntry}
          referenceLocale={referenceLocale}
          selectedReferenceLocale={selectedReferenceLocale}
          selectedReferenceValues={selectedReferenceValues}
          updateReferenceLocale={updateReferenceLocale}
          selectedPhraseMatches={selectedPhraseMatches}
          selectedLlmCandidates={selectedLlmCandidates}
          selectedLiveLlmOutput={selectedLiveLlmOutput}
          selectedLlmDisplayDraft={selectedLlmDisplayDraft}
          llmModel={llmModel}
          manualDraft={manualDraft}
          setManualDraft={setManualDraft}
          manualDiffSegments={manualDiffSegments}
          manualWarnings={manualWarnings}
          hasManualPatch={hasManualPatch}
          saveManualPatch={saveManualPatch}
          revertSelectedManualPatch={revertSelectedManualPatch}
          translateSelected={translateSelected}
          translating={translating}
          useLlmCandidate={useLlmCandidate}
          deleteLlmCandidate={deleteLlmCandidate}
        />
      </aside>
    </>
  );
}
