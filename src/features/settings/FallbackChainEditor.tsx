import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { normalizeFallbackChain } from "../../lib/deploymentConfig";
import type { LocaleCode } from "../../lib/types";

export function FallbackChainEditor({
  locale,
  chain,
  availableLocales,
  setChain,
}: {
  locale: LocaleCode;
  chain: string[];
  availableLocales: readonly LocaleCode[];
  setChain: (chain: string[]) => void;
}) {
  const normalized = normalizeFallbackChain(locale, chain);
  const movable = normalized.filter((fallbackLocale) => fallbackLocale !== "en_us");
  const available = availableLocales.filter((fallbackLocale) => fallbackLocale !== locale && fallbackLocale !== "en_us" && !movable.includes(fallbackLocale));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= movable.length) {
      return;
    }
    const next = [...movable];
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  }

  function remove(index: number) {
    setChain([...movable.slice(0, index), ...movable.slice(index + 1)]);
  }

  return (
    <div className="fallbackEditor">
      <div className="fallbackTarget">{locale}</div>
      <div className="fallbackList">
        {movable.map((fallbackLocale, index) => (
          <div className="fallbackChip" key={fallbackLocale}>
            <span>{fallbackLocale}</span>
            <button type="button" className="miniIconButton" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${fallbackLocale} up`}>
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              className="miniIconButton"
              onClick={() => move(index, 1)}
              disabled={index === movable.length - 1}
              aria-label={`Move ${fallbackLocale} down`}
            >
              <ArrowDown size={13} />
            </button>
            <button type="button" className="miniIconButton danger" onClick={() => remove(index)} aria-label={`Remove ${fallbackLocale}`}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {locale !== "en_us" ? (
          <div className="fallbackChip locked">
            <span>en_us</span>
          </div>
        ) : null}
        <select
          className="fallbackAdd"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              setChain([...movable, event.target.value]);
            }
          }}
        >
          <option value="">Add fallback</option>
          {available.map((fallbackLocale) => (
            <option key={fallbackLocale} value={fallbackLocale}>
              {fallbackLocale}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
