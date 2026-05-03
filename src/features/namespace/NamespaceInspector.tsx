import { RotateCcw, Save, Wand2 } from "lucide-react";

import { SourceBadge } from "../../components/SourceBadge";
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
  if (!selectedEntry) {
    return <div className="emptyState detailEmpty">No key selected</div>;
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
        <ValueBlock title="Base value" source={selectedEntry.base.source} value={selectedEntry.base.value} label={selectedEntry.base.sourceLabel} />
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
        <pre className="minecraftFormattedOutput" aria-label={selectedEntry.final.value || "None"}>
          <MinecraftFormattedText value={selectedEntry.final.value} />
        </pre>
      </section>
    </>
  );
}
