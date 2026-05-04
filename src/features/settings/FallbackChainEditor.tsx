import { useI18n } from "../../app/i18n";
import { normalizeFallbackChain } from "../../lib/deploymentConfig";
import type { LocaleCode } from "../../lib/types";
import { LocaleOrderList } from "./LocaleOrderList";

export function FallbackChainEditor({
  locale,
  chain,
  active = false,
  externalDragLocale = null,
  externalDropIndex = null,
  onActivate,
  setChain,
}: {
  locale: LocaleCode;
  chain: string[];
  active?: boolean;
  externalDragLocale?: LocaleCode | null;
  externalDropIndex?: number | null;
  onActivate?: () => void;
  setChain: (chain: string[]) => void;
}) {
  const { t } = useI18n();
  const normalized = normalizeFallbackChain(locale, chain);
  const movable = normalized.filter((fallbackLocale) => fallbackLocale !== "en_us");

  return (
    <div
      className={`fallbackEditor ${active ? "active" : ""}`}
      data-fallback-chain-locale={locale}
      onDragEnter={onActivate}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
    >
      <div className="fallbackTarget">{locale}</div>
      <div className="fallbackChainControl">
        <LocaleOrderList
          locales={movable}
          lockedLocales={locale !== "en_us" ? ["en_us"] : []}
          emptyText={t("Using en_us")}
          canAddLocale={(fallbackLocale) => fallbackLocale !== locale && fallbackLocale !== "en_us"}
          externalDragLocale={externalDragLocale}
          externalDropIndex={externalDropIndex}
          onChange={setChain}
        />
      </div>
    </div>
  );
}
