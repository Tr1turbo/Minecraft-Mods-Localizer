import { Trash2 } from "lucide-react";

export function LlmWarningsPanel({ warnings, clearWarnings }: { warnings: string[]; clearWarnings: () => void }) {
  return (
    <section className="llmWarningsPanel" aria-label="LLM warnings">
      <div className="panelHeader">
        <h2>LLM warnings</h2>
        <div className="buttonRow compact">
          <span className="panelNote">{warnings.length.toLocaleString()} warning(s)</span>
          <button type="button" onClick={clearWarnings}>
            <Trash2 size={16} />
            Clear
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
