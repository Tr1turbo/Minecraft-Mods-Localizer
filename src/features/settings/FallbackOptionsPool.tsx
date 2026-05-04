import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useI18n } from "../../app/i18n";
import type { LocaleCode } from "../../lib/types";

export interface FallbackPoolDrag {
  locale: LocaleCode;
  x: number;
  y: number;
}

export function FallbackOptionsPool({
  activeLocale,
  activeChain,
  options,
  dragLocale = null,
  onAdd,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  activeLocale: LocaleCode | null;
  activeChain: readonly LocaleCode[];
  options: readonly LocaleCode[];
  dragLocale?: LocaleCode | null;
  onAdd: (locale: LocaleCode) => void;
  onDragMove?: (drag: FallbackPoolDrag) => void;
  onDragEnd?: (drag: FallbackPoolDrag) => void;
  onDragCancel?: () => void;
}) {
  const { t } = useI18n();
  const [activeDrag, setActiveDrag] = useState<FallbackPoolDrag | null>(null);
  const pendingPointerRef = useRef<{ locale: LocaleCode; startX: number; startY: number } | null>(null);
  const activeDragRef = useRef<FallbackPoolDrag | null>(null);
  const suppressClickRef = useRef(false);
  const activeSet = new Set(activeChain);

  useEffect(() => {
    function suppressNextClick() {
      suppressClickRef.current = true;
    }

    function releaseClickSuppression() {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 120);
    }

    function clearDrag() {
      pendingPointerRef.current = null;
      activeDragRef.current = null;
      setActiveDrag(null);
    }

    function handlePointerMove(event: PointerEvent) {
      const pending = pendingPointerRef.current;
      const active = activeDragRef.current;
      if (!active && !pending) {
        return;
      }
      if (!active && pending) {
        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (distance < 4) {
          return;
        }
        suppressNextClick();
      }

      event.preventDefault();
      const locale = active?.locale ?? pending?.locale;
      if (!locale) {
        return;
      }
      pendingPointerRef.current = null;
      const nextDrag = { locale, x: event.clientX, y: event.clientY };
      activeDragRef.current = nextDrag;
      setActiveDrag(nextDrag);
      onDragMove?.(nextDrag);
    }

    function handlePointerUp(event: PointerEvent) {
      const active = activeDragRef.current;
      pendingPointerRef.current = null;
      if (!active) {
        return;
      }
      event.preventDefault();
      const finalDrag = { ...active, x: event.clientX, y: event.clientY };
      onDragEnd?.(finalDrag);
      clearDrag();
      releaseClickSuppression();
    }

    function handlePointerCancel() {
      if (pendingPointerRef.current || activeDragRef.current) {
        onDragCancel?.();
      }
      clearDrag();
      releaseClickSuppression();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [onDragCancel, onDragEnd, onDragMove]);

  function startCandidateDrag(fallbackLocale: LocaleCode, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }
    pendingPointerRef.current = { locale: fallbackLocale, startX: event.clientX, startY: event.clientY };
  }

  function addLocale(fallbackLocale: LocaleCode, blocked: boolean, selected: boolean) {
    if (suppressClickRef.current) {
      return;
    }
    if (!blocked && !selected) {
      onAdd(fallbackLocale);
    }
  }

  return (
    <div className="fallbackPool">
      <div className="targetLocaleOrderTitle">{t("Fallback options")}</div>
      <div className="fallbackOptionList shared" aria-label={t("Shared fallback options")}>
        {options.map((fallbackLocale) => {
          const blocked = fallbackLocale === activeLocale;
          const selected = activeSet.has(fallbackLocale);
          const dragging = activeDrag?.locale === fallbackLocale || dragLocale === fallbackLocale;
          return (
            <button
              type="button"
              className={`fallbackOption ${selected ? "selected" : ""} ${blocked ? "blocked" : ""} ${dragging ? "dragging" : ""}`}
              key={fallbackLocale}
              onClick={() => addLocale(fallbackLocale, blocked, selected)}
              onPointerDown={(event) => startCandidateDrag(fallbackLocale, event)}
              aria-pressed={selected}
            >
              <span>{fallbackLocale}</span>
            </button>
          );
        })}
      </div>
      {activeDrag ? (
        <div
          className="localeDragGhost"
          style={{
            transform: `translate3d(${activeDrag.x + 12}px, ${activeDrag.y + 10}px, 0)`,
          }}
        >
          <GripVertical size={14} aria-hidden="true" />
          <span>{activeDrag.locale}</span>
        </div>
      ) : null}
    </div>
  );
}
