import { compactVanillaGlossaryEntriesForDisplay, joinGlossaryTerms } from "../../lib/glossary";
import { useI18n } from "../../app/i18n";
import { Tooltip } from "../../components/Tooltip";
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
  const { t } = useI18n();
  const compactMatches = compactVanillaGlossaryEntriesForDisplay(matches, [referenceLocale, activeLocale]);

  return (
    <section className="glossaryMatchesPanel">
      <div className="panelHeader">
        <h2>{t("Hint")}</h2>
        <span className="panelNote">{referenceLocale}</span>
      </div>
      <div className="glossaryMatchList">
        {compactMatches.map((entry) => (
          <article className="glossaryMatchRow" key={entry.id}>
            <div className="glossaryMatchMeta">
              <span className={`glossarySource ${entry.source}`}>{entry.source}</span>
              <strong>{entry.displayId}</strong>
              {entry.hiddenIds.length ? (
                <Tooltip content={entry.allIds.join("\n")}>
                  <span className="glossaryIdChip" tabIndex={0}>
                    {`+${entry.hiddenIds.length}`}
                  </span>
                </Tooltip>
              ) : null}
              {entry.tags.map((tag) => (
                <span className="glossaryIdChip" key={tag}>{tag}</span>
              ))}
            </div>
            <div className="glossaryMatchTerms">
              <span>
                <b>{referenceLocale}</b>
                {joinGlossaryTerms(entry.terms[referenceLocale] ?? []) || t("No glossary terms")}
              </span>
              {activeLocale !== referenceLocale ? (
                <span>
                  <b>{activeLocale}</b>
                  {joinGlossaryTerms(entry.terms[activeLocale] ?? []) || t("No glossary terms")}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
