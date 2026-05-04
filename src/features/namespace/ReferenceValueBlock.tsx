import { TriangleAlert } from "lucide-react";
import { SourceBadge } from "../../components/SourceBadge";
import { Tooltip } from "../../components/Tooltip";
import { useI18n } from "../../app/i18n";
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
  const { t } = useI18n();
  const referenceByLocale = new Map(availableReferenceValues.map((reference) => [reference.locale, reference]));
  const currentReference = referenceByLocale.get(referenceLocale);
  const fallbackNotice =
    globalReferenceLocale && currentReference && currentReference.locale !== globalReferenceLocale && !referenceByLocale.has(globalReferenceLocale)
      ? { requestedLocale: globalReferenceLocale, displayedLocale: currentReference.locale }
      : undefined;
  const source = currentReference?.source ?? "missing";
  const label = currentReference?.sourceLabel ?? t("No reference");
  const value = currentReference?.value ?? "";

  return (
    <section className="valueBlock">
      <div className="valueBlockHeader">
        <label className="referenceSelectLabel">
          {t("Reference")}
          {!hasEnUsValue ? (
            <Tooltip content={t("No en_us value")}>
              <span className="referenceWarningIcon" role="img" aria-label={t("No en_us value")} tabIndex={0}>
                <TriangleAlert size={14} />
              </span>
            </Tooltip>
          ) : null}
          <select value={currentReference?.locale ?? ""} disabled={availableReferenceValues.length === 0} onChange={(event) => onReferenceLocaleChange(event.target.value)}>
            {availableReferenceValues.length === 0 ? <option value="">{t("No reference")}</option> : null}
            {availableReferenceValues.map((reference) => (
              <option key={reference.locale} value={reference.locale}>
                {reference.locale}
              </option>
            ))}
          </select>
        </label>
        <span className="sourceMeta">
          <SourceBadge source={source} />
          <span className="sourceMetaText">{label}</span>
        </span>
      </div>
      {fallbackNotice ? (
        <div className="referenceFallbackNotice">
          <TriangleAlert size={14} />
          <span>
            {t("No {locale} reference for this key. Showing {displayedLocale} instead.", {
              locale: fallbackNotice.requestedLocale,
              displayedLocale: fallbackNotice.displayedLocale,
            })}
          </span>
        </div>
      ) : null}
      <pre>{value || t("None")}</pre>
    </section>
  );
}
