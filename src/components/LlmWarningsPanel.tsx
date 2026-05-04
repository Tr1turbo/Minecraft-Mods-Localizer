import { Trash2 } from "lucide-react";
import { useI18n } from "../app/i18n";

export function LlmWarningsPanel({ warnings, clearWarnings }: { warnings: string[]; clearWarnings: () => void }) {
  const { t } = useI18n();
  return (
    <section className="llmWarningsPanel" aria-label={t("LLM warnings")}>
      <div className="panelHeader">
        <h2>{t("LLM warnings")}</h2>
        <div className="buttonRow compact">
          <span className="panelNote">{t("{count} warning(s)", { count: warnings.length.toLocaleString() })}</span>
          <button type="button" onClick={clearWarnings}>
            <Trash2 size={16} />
            {t("Clear")}
          </button>
        </div>
      </div>
      <ol className="llmWarningList">
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ol>
    </section>
  );
}
