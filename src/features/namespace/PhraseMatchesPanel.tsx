import { isChineseLocale } from "../../lib/locales";
import { joinPhraseTerms } from "../../lib/phraseMappings";
import type { LocaleCode, PhraseMapping } from "../../lib/types";

export function PhraseMatchesPanel({
  matches,
  activeLocale,
  referenceLocale,
}: {
  matches: PhraseMapping[];
  activeLocale: LocaleCode;
  referenceLocale: string;
}) {
  const targetTermsLocale = isChineseLocale(activeLocale) ? activeLocale : undefined;
  return (
    <section className="phraseMatchesPanel">
      <div className="panelHeader">
        <h2>Hint</h2>
        <span className="panelNote">{referenceLocale}</span>
      </div>
      <div className="phraseMatchList">
        {matches.map((mapping) => (
          <article className="phraseMatchRow" key={mapping.id}>
            <div className="phraseMatchMeta">
              <span className={`phraseSource ${mapping.source}`}>{mapping.source}</span>
              <strong>{mapping.id}</strong>
            </div>
            <div className="phraseMatchTerms">
              <span>
                <b>en_us</b>
                {joinPhraseTerms(mapping.en_us)}
              </span>
              <span>
                <b>{activeLocale}</b>
                {targetTermsLocale ? joinPhraseTerms(mapping[targetTermsLocale]) : "No Chinese glossary terms"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
