import { RotateCcw, Save, Wand2 } from "lucide-react";

import { SourceBadge } from "../../components/SourceBadge";
import { Tooltip } from "../../components/Tooltip";
import { useI18n } from "../../app/i18n";
import { LlmCandidatesPanel } from "../llm/LlmCandidatesPanel";
import type { DiffSegment, LlmLiveOutput } from "../../app/types";
import type { LocaleCode, PatchValue, GlossaryEntry, ReferenceValue, ResolvedEntry } from "../../lib/types";
import { PatchTextEditor } from "./PatchTextEditor";
import { GlossaryMatchesPanel } from "./GlossaryMatchesPanel";
import { ReferenceValueBlock } from "./ReferenceValueBlock";
import { ValueBlock } from "./ValueBlock";
import { MinecraftFormattedText } from "./MinecraftFormattedText";

interface NamespaceInspectorProps {
  selectedEntry: ResolvedEntry | undefined;
  referenceLocale: LocaleCode;
  selectedReferenceLocale: LocaleCode;
  selectedReferenceValues: readonly ReferenceValue[];
  updateReferenceLocale: (locale: LocaleCode) => void;
  selectedGlossaryMatches: GlossaryEntry[];
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
  translating: boolean;
  useLlmCandidate: (candidate: PatchValue, index: number) => void;
  deleteLlmCandidate: (candidate: PatchValue, index: number) => void;
}

export function NamespaceInspector({
  selectedEntry,
  referenceLocale,
  selectedReferenceLocale,
  selectedReferenceValues,
  updateReferenceLocale,
  selectedGlossaryMatches,
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
  translating,
  useLlmCandidate,
  deleteLlmCandidate,
}: NamespaceInspectorProps) {
  const { t } = useI18n();
  if (!selectedEntry) {
    return <div className="emptyState detailEmpty">{t("No key selected")}</div>;
  }

  return (
    <>
      <section className="valueStack">
        <ReferenceValueBlock
          globalReferenceLocale={referenceLocale}
          referenceLocale={selectedReferenceLocale}
          availableReferenceValues={selectedReferenceValues}
          onReferenceLocaleChange={updateReferenceLocale}
          hasEnUsValue={selectedReferenceValues.some((reference) => reference.locale === "en_us")}
        />
        <ValueBlock title={t("Base value")} source={selectedEntry.base.source} value={selectedEntry.base.value} label={selectedEntry.base.sourceLabel} />
      </section>

      {selectedGlossaryMatches.length ? (
        <GlossaryMatchesPanel matches={selectedGlossaryMatches} activeLocale={selectedEntry.locale} referenceLocale={selectedReferenceLocale || referenceLocale} />
      ) : null}

      {selectedLlmCandidates.length || selectedLiveLlmOutput ? (
        <LlmCandidatesPanel
          candidates={selectedLlmCandidates}
          activePatch={selectedEntry.patch}
          liveOutput={selectedLiveLlmOutput}
          displayDraft={selectedLlmDisplayDraft}
          model={llmModel}
          useCandidate={useLlmCandidate}
          deleteCandidate={deleteLlmCandidate}
        />
      ) : null}

      <section className="editPanel">
        <div className="panelHeader">
          <h2>{t("Patch")}</h2>
          <div className="buttonRow compact">
            <Tooltip content={t("Save")} className="inspectorActionTooltip">
              <button type="button" className="inspectorActionButton" onClick={saveManualPatch} aria-label={t("Save")}>
                <Save size={17} />
              </button>
            </Tooltip>
            <Tooltip content={t("Revert key")} className="inspectorActionTooltip">
              <button
                type="button"
                className="inspectorActionButton"
                onClick={revertSelectedManualPatch}
                disabled={!selectedEntry.patch}
                aria-label={t("Revert key")}
              >
                <RotateCcw size={17} />
              </button>
            </Tooltip>
            <Tooltip content="LLM" className="inspectorActionTooltip">
              <button
                type="button"
                className="inspectorActionButton"
                onClick={translateSelected}
                disabled={!selectedEntry || translating}
                aria-label="LLM"
              >
                <Wand2 size={17} />
              </button>
            </Tooltip>
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
          <h2>{t("Final Output")}</h2>
          <SourceBadge source={selectedEntry.final.source} />
        </div>
        <pre className="minecraftFormattedOutput" aria-label={selectedEntry.final.value || "None"}>
          <MinecraftFormattedText value={selectedEntry.final.value} />
        </pre>
      </section>
    </>
  );
}
