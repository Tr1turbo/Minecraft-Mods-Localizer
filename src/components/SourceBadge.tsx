import { useContext } from "react";
import { SourceLabelContext } from "../app/sourceLabels";
import type { CandidateValue } from "../lib/types";

export function SourceBadge({ source }: { source: CandidateValue["source"] }) {
  const sourceLabels = useContext(SourceLabelContext);
  const label = sourceLabels[source];
  return (
    <span className={`sourceBadge ${source}`} style={{ background: label.background, color: label.text }}>
      {label.label}
    </span>
  );
}
