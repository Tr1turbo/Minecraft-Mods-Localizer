import { Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SourceBadge } from "../../components/SourceBadge";
import { formatPatchTime, isActiveLlmCandidate, llmCandidateKey } from "../../app/helpers";
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
  return (
    <section className="llmCandidatePanel">
      <div className="panelHeader">
        <h2>LLM generated</h2>
        <span className="candidateCount">{candidates.length} saved</span>
      </div>
      <div className="llmCandidateList">
        {candidates.map((candidate, index) => {
          const active = isActiveLlmCandidate(activePatch, candidate, index);
          const animating = active && displayDraft !== undefined;
          return (
            <article className={`llmCandidateCard ${active ? "active" : ""}`} key={llmCandidateKey(candidate, index)}>
              <div className="llmCandidateMeta">
                <SourceBadge source="llm" />
                <span>{candidate.meta?.model ?? "LLM"}</span>
                <time>{formatPatchTime(candidate.updatedAt)}</time>
                {active ? <strong>Active</strong> : null}
              </div>
              <pre>{animating ? displayDraft : candidate.value}</pre>
              <div className="buttonRow compact">
                <button type="button" onClick={() => useCandidate(candidate, index)} disabled={active}>
                  <Check size={16} />
                  Use
                </button>
                <button type="button" onClick={() => deleteCandidate(candidate, index)} disabled={animating}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </article>
          );
        })}
        {liveOutput ? (
          <article className="llmCandidateCard active streaming">
            <div className="llmCandidateMeta">
              <SourceBadge source="llm" />
              <span>{model || "LLM"}</span>
              <strong>Generating</strong>
            </div>
            <pre>{liveOutput.text || <PendingLlmText />}</pre>
            <div className="buttonRow compact">
              <button type="button" disabled>
                <Check size={16} />
                Use
              </button>
              <button type="button" disabled>
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
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
  "Creeping"
];

function PendingLlmText() {
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
    <span className="pendingLlmText" aria-label="Waiting for LLM output">
      <span className="pendingLlmSpinner" />
      <span className="pendingLlmLabel">{typed}</span>
      <span className="pendingLlmCaret" aria-hidden="true" />
    </span>
  );
}
