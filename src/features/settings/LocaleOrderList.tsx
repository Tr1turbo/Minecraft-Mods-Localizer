import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { LocaleCode } from "../../lib/types";

export function LocaleOrderList({
  locales,
  emptyText,
  moveLocale,
  removeLocale,
}: {
  locales: readonly LocaleCode[];
  emptyText: string;
  moveLocale: (index: number, delta: number) => void;
  removeLocale: (locale: LocaleCode) => void;
}) {
  if (locales.length === 0) {
    return <div className="emptyState">{emptyText}</div>;
  }
  return (
    <div className="fallbackList localeOrderList">
      {locales.map((locale, index) => (
        <div className="fallbackChip" key={locale}>
          <span>{locale}</span>
          <button type="button" className="miniIconButton" onClick={() => moveLocale(index, -1)} disabled={index === 0} aria-label={`Move ${locale} up`}>
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="miniIconButton"
            onClick={() => moveLocale(index, 1)}
            disabled={index === locales.length - 1}
            aria-label={`Move ${locale} down`}
          >
            <ArrowDown size={13} />
          </button>
          <button type="button" className="miniIconButton danger" onClick={() => removeLocale(locale)} aria-label={`Remove ${locale}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
