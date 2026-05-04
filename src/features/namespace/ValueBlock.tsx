import { SourceBadge } from "../../components/SourceBadge";
import { useI18n } from "../../app/i18n";
import type { CandidateValue } from "../../lib/types";

export function ValueBlock({ title, source, label, value }: { title: string; source: CandidateValue["source"]; label: string; value: string }) {
  const { t } = useI18n();
  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <h3>{title}</h3>
        <span className="sourceMeta">
          <SourceBadge source={source} />
          <span className="sourceMetaText">{label}</span>
        </span>
      </div>
      <pre>{value || t("None")}</pre>
    </section>
  );
}
