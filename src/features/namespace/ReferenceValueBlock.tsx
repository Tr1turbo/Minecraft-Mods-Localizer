import { TriangleAlert } from "lucide-react";
import { SourceBadge } from "../../components/SourceBadge";
import type { LocaleCode, ReferenceValue } from "../../lib/types";

export function ReferenceValueBlock({
  globalReferenceLocale,
  referenceLocale,
  availableReferenceValues,
  onReferenceLocaleChange,
  hasEnUsValue,
}: {
  globalReferenceLocale: LocaleCode;
  referenceLocale: LocaleCode;
  availableReferenceValues: readonly ReferenceValue[];
  onReferenceLocaleChange: (locale: LocaleCode) => void;
  hasEnUsValue: boolean;
}) {
  const referenceByLocale = new Map(availableReferenceValues.map((reference) => [reference.locale, reference]));
  const currentReference = referenceByLocale.get(referenceLocale);
  const fallbackNotice =
    globalReferenceLocale && currentReference && currentReference.locale !== globalReferenceLocale && !referenceByLocale.has(globalReferenceLocale)
      ? { requestedLocale: globalReferenceLocale, displayedLocale: currentReference.locale }
      : undefined;
  const source = currentReference?.source ?? "missing";
  const label = currentReference?.sourceLabel ?? "No reference";
  const value = currentReference?.value ?? "";

  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <label className="referenceSelectLabel">
          Reference
          {!hasEnUsValue ? (
            <span className="referenceWarningIcon" title="No en_us value" role="img" aria-label="No en_us value">
              <TriangleAlert size={14} />
            </span>
          ) : null}
          <select value={currentReference?.locale ?? ""} disabled={availableReferenceValues.length === 0} onChange={(event) => onReferenceLocaleChange(event.target.value)}>
            {availableReferenceValues.length === 0 ? <option value="">No reference</option> : null}
            {availableReferenceValues.map((reference) => (
              <option key={reference.locale} value={reference.locale}>
                {reference.locale}
              </option>
            ))}
          </select>
        </label>
        <span>
          <SourceBadge source={source} /> {label}
        </span>
      </div>
      {fallbackNotice ? (
        <div className="referenceFallbackNotice">
          <TriangleAlert size={14} />
          <span>
            No <b>{fallbackNotice.requestedLocale}</b> reference for this key. Showing <b>{fallbackNotice.displayedLocale}</b> instead.
          </span>
        </div>
      ) : null}
      <pre>{value || "None"}</pre>
    </section>
  );
}
