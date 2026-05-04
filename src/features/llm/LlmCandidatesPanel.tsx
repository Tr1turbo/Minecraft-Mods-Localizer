import { Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SourceBadge } from "../../components/SourceBadge";
import { Tooltip } from "../../components/Tooltip";
import { formatPatchTime, isActiveLlmCandidate, llmCandidateKey } from "../../app/helpers";
import { useI18n } from "../../app/i18n";
import type { LlmLiveOutput } from "../../app/types";
import type { PatchValue } from "../../lib/types";

export function LlmCandidatesPanel({
  candidates,
  activePatch,
  liveOutput,
  displayDraft,
  model,
  useCandidate,
  deleteCandidate,
}: {
  candidates: PatchValue[];
  activePatch: PatchValue | undefined;
  liveOutput?: LlmLiveOutput;
  displayDraft?: string;
  model: string;
  useCandidate: (candidate: PatchValue, index: number) => void;
  deleteCandidate: (candidate: PatchValue, index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="llmCandidatePanel">
      <div className="panelHeader">
        <h2>{t("LLM generated")}</h2>
        <span className="candidateCount">{t("{count} saved", { count: candidates.length })}</span>
      </div>
      <div className="llmCandidateList">
        {candidates.map((candidate, index) => {
          const active = isActiveLlmCandidate(activePatch, candidate, index);
          const animating = active && displayDraft !== undefined;
          const displayedValue = animating ? displayDraft : candidate.value;
          const multiline = isMultilineValue(displayedValue);
          return (
            <article className={`llmCandidateCard ${active ? "active" : ""}`} key={llmCandidateKey(candidate, index)}>
              <div className="llmCandidateMeta">
                <SourceBadge source="llm" />
                <span>{candidate.meta?.model ?? "LLM"}</span>
                <time>{formatPatchTime(candidate.updatedAt)}</time>
                {active ? <strong>{t("Active")}</strong> : null}
              </div>
              <div className={`llmCandidateValueFrame ${multiline ? "multiLine" : "singleLine"}`}>
                <pre>{displayedValue}</pre>
                <CandidateActions
                  useLabel={t("Use")}
                  deleteLabel={t("Delete")}
                  useDisabled={active}
                  deleteDisabled={animating}
                  onUse={() => useCandidate(candidate, index)}
                  onDelete={() => deleteCandidate(candidate, index)}
                />
              </div>
            </article>
          );
        })}
        {liveOutput ? (
          <article className="llmCandidateCard active streaming">
            <div className="llmCandidateMeta">
              <SourceBadge source="llm" />
              <span>{model || "LLM"}</span>
              <strong>{t("Generating")}</strong>
            </div>
            <div className={`llmCandidateValueFrame ${isMultilineValue(liveOutput.text) ? "multiLine" : "singleLine"}`}>
              <pre>{liveOutput.text || <PendingLlmText />}</pre>
              <CandidateActions
                useLabel={t("Use")}
                deleteLabel={t("Delete")}
                useDisabled
                deleteDisabled
              />
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function CandidateActions({
  useLabel,
  deleteLabel,
  useDisabled,
  deleteDisabled,
  onUse,
  onDelete,
}: {
  useLabel: string;
  deleteLabel: string;
  useDisabled?: boolean;
  deleteDisabled?: boolean;
  onUse?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="llmCandidateActions" aria-label={`${useLabel} / ${deleteLabel}`}>
      <Tooltip content={useLabel} className="inspectorActionTooltip">
        <button type="button" className="inspectorActionButton" onClick={onUse} disabled={useDisabled} aria-label={useLabel}>
          <Check size={17} />
        </button>
      </Tooltip>
      <Tooltip content={deleteLabel} className="inspectorActionTooltip">
        <button type="button" className="inspectorActionButton danger" onClick={onDelete} disabled={deleteDisabled} aria-label={deleteLabel}>
          <Trash2 size={17} />
        </button>
      </Tooltip>
    </div>
  );
}

function isMultilineValue(value: string | undefined) {
  return Boolean(value && /\r|\n/.test(value));
}

const THINKING_WORDS = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Brewing",
  "Cogitating",
  "Conjuring",
  "Noodling",
  "Percolating",
  "Marinating",
  "Musing",
  "Ruminating",
  "Simmering",
  "Crafting",
  "Divining",
  "Imagining",
  "Translating",
  "Translating"
];

function PendingLlmText() {
  const { t } = useI18n();
  const [wordIndex, setWordIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_WORDS.length),
  );
  const [typed, setTyped] = useState("");
  const word = THINKING_WORDS[wordIndex];

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    setTyped("");

    const typeMs = 65;
    const eraseMs = 30;
    const holdMs = 1500;

    for (let i = 1; i <= word.length; i += 1) {
      timeouts.push(setTimeout(() => setTyped(word.slice(0, i)), i * typeMs));
    }
    const eraseStart = word.length * typeMs + holdMs;
    for (let i = word.length - 1; i >= 0; i -= 1) {
      timeouts.push(
        setTimeout(
          () => setTyped(word.slice(0, i)),
          eraseStart + (word.length - i) * eraseMs,
        ),
      );
    }
    const total = eraseStart + word.length * eraseMs + 250;
    timeouts.push(
      setTimeout(() => {
        setWordIndex((prev) => {
          let next = Math.floor(Math.random() * THINKING_WORDS.length);
          if (next === prev) next = (next + 1) % THINKING_WORDS.length;
          return next;
        });
      }, total),
    );

    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [word]);

  return (
    <span className="pendingLlmText" aria-label={t("Waiting for LLM output")}>
      <span className="pendingLlmSpinner" />
      <span className="pendingLlmLabel">{typed}</span>
      <span className="pendingLlmCaret" aria-hidden="true" />
    </span>
  );
}
