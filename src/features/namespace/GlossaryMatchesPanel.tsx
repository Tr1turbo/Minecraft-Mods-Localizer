import { compactVanillaGlossaryEntriesForDisplay, joinGlossaryTerms } from "../../lib/glossary";
import type { LocaleCode, GlossaryEntry } from "../../lib/types";

export function GlossaryMatchesPanel({
  matches,
  activeLocale,
  referenceLocale,
}: {
  matches: GlossaryEntry[];
  activeLocale: LocaleCode;
  referenceLocale: LocaleCode;
}) {
  const compactMatches = compactVanillaGlossaryEntriesForDisplay(matches, [referenceLocale, activeLocale]);

  return (
    <section className="glossaryMatchesPanel">
      <div className="panelHeader">
        <h2>Hint</h2>
        <span className="panelNote">{referenceLocale}</span>
      </div>
      <div className="glossaryMatchList">
        {compactMatches.map((entry) => (
          <article className="glossaryMatchRow" key={entry.id}>
            <div className="glossaryMatchMeta">
              <span className={`glossarySource ${entry.source}`}>{entry.source}</span>
              <strong>{entry.displayId}</strong>
              {entry.hiddenIds.length ? (
                <span className="glossaryIdChip hasTooltip" data-full-ids={entry.allIds.join("\n")} tabIndex={0}>
                  {`+${entry.hiddenIds.length}`}
                </span>
              ) : null}
              {entry.tags.map((tag) => (
                <span className="glossaryIdChip" key={tag}>{tag}</span>
              ))}
            </div>
            <div className="glossaryMatchTerms">
              <span>
                <b>{referenceLocale}</b>
                {joinGlossaryTerms(entry.terms[referenceLocale] ?? []) || "No glossary terms"}
              </span>
              {activeLocale !== referenceLocale ? (
                <span>
                  <b>{activeLocale}</b>
                  {joinGlossaryTerms(entry.terms[activeLocale] ?? []) || "No glossary terms"}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
