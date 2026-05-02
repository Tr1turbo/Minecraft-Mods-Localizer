import { SourceBadge } from "../../components/SourceBadge";
import type { CandidateValue } from "../../lib/types";

export function ValueBlock({ title, source, label, value }: { title: string; source: CandidateValue["source"]; label: string; value: string }) {
  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <h3>{title}</h3>
        <span>
          <SourceBadge source={source} /> {label}
        </span>
      </div>
      <pre>{value || "None"}</pre>
    </section>
  );
}
