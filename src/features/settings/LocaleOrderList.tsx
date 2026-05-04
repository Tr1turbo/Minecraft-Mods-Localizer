import { GripVertical, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";

import { useI18n } from "../../app/i18n";
import { Tooltip } from "../../components/Tooltip";
import { isValidLocaleCode, normalizeLocaleCode, uniqueLocaleCodes } from "../../lib/locales";
import type { LocaleCode } from "../../lib/types";

export function resolveLocaleOrderDropIndex(
  list: HTMLElement | null,
  clientX: number,
  clientY: number,
  draggingLocale: string | null = null,
  fallbackIndex = 0,
) {
  if (!list) {
    return fallbackIndex;
  }
  const chips = Array.from(list.querySelectorAll<HTMLElement>("[data-locale-chip]")).filter(
    (chip) => chip.dataset.locale !== draggingLocale,
  );
  if (chips.length === 0) {
    return 0;
  }
  const rowTolerance = 8;
  const rows: Array<Array<{ index: number; rect: DOMRect }>> = [];
  for (const [index, element] of chips.entries()) {
    const rect = element.getBoundingClientRect();
    const row = rows.find((items) => Math.abs(items[0].rect.top - rect.top) <= rowTolerance);
    if (row) {
      row.push({ index, rect });
    } else {
      rows.push([{ index, rect }]);
    }
  }
  rows.sort((a, b) => a[0].rect.top - b[0].rect.top);
  for (const row of rows) {
    row.sort((a, b) => a.rect.left - b.rect.left);
    const rowTop = Math.min(...row.map((item) => item.rect.top));
    const rowBottom = Math.max(...row.map((item) => item.rect.bottom));
    if (clientY <= rowBottom + rowTolerance) {
      if (clientY < rowTop - rowTolerance) {
        return row[0].index;
      }
      for (const item of row) {
        if (clientX < item.rect.left + item.rect.width / 2) {
          return item.index;
        }
      }
      return row[row.length - 1].index + 1;
    }
  }
  return chips.length;
}

export function LocaleOrderList({
  locales,
  lockedLocales = [],
  emptyText,
  canAddLocale = () => true,
  externalDragLocale = null,
  externalDropIndex = null,
  onChange,
}: {
  locales: readonly LocaleCode[];
  lockedLocales?: readonly LocaleCode[];
  emptyText: string;
  canAddLocale?: (locale: LocaleCode) => boolean;
  externalDragLocale?: LocaleCode | null;
  externalDropIndex?: number | null;
  onChange: (locales: LocaleCode[]) => void;
}) {
  const { t } = useI18n();
  const [draggedLocale, setDraggedLocale] = useState<LocaleCode | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingPointerRef = useRef<{ locale: LocaleCode; startX: number; startY: number } | null>(null);
  const pointerDragRef = useRef<{ locale: LocaleCode; x: number; y: number } | null>(null);
  const [pointerDrag, setPointerDrag] = useState<{ locale: LocaleCode; x: number; y: number } | null>(null);
  const externalDragActive = externalDragLocale !== null && externalDropIndex !== null && canAddLocale(externalDragLocale);
  const activeDragLocale = pointerDrag?.locale ?? (externalDragActive ? externalDragLocale : null) ?? draggedLocale;
  const displayedDropIndex = externalDragActive ? externalDropIndex : dropIndex;
  const visibleLocales = activeDragLocale && locales.includes(activeDragLocale)
    ? locales.filter((locale) => locale !== activeDragLocale)
    : locales;

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const pending = pendingPointerRef.current;
      const active = pointerDrag ?? (pending ? { locale: pending.locale, x: event.clientX, y: event.clientY } : null);
      if (!active) {
        return;
      }
      if (!pointerDrag && pending) {
        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (distance < 4) {
          return;
        }
      }
      event.preventDefault();
      pendingPointerRef.current = null;
      const nextDrag = { locale: active.locale, x: event.clientX, y: event.clientY };
      pointerDragRef.current = nextDrag;
      setDraggedLocale(active.locale);
      setPointerDrag(nextDrag);
      setDropIndex(resolveDropIndex(event.clientX, event.clientY, active.locale));
    }

    function handlePointerUp(event: PointerEvent) {
      const active = pointerDragRef.current ?? pointerDrag;
      pendingPointerRef.current = null;
      if (!active) {
        return;
      }
      const targetIndex = dropIndex ?? resolveDropIndex(event.clientX, event.clientY, active.locale);
      dropLocale(active.locale, targetIndex);
      pointerDragRef.current = null;
      setPointerDrag(null);
      finishDrag();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dropIndex, pointerDrag, locales]);

  function finishDrag() {
    setDraggedLocale(null);
    setDropIndex(null);
  }

  function removeLocale(locale: LocaleCode) {
    onChange(locales.filter((item) => item !== locale));
  }

  function dropLocale(rawLocale: string, targetIndex: number) {
    const locale = normalizeLocaleCode(rawLocale);
    if (!isValidLocaleCode(locale)) {
      return;
    }
    if (!canAddLocale(locale)) {
      return;
    }
    const next = locales.filter((item) => item !== locale);
    const boundedIndex = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(boundedIndex, 0, locale);
    onChange(uniqueLocaleCodes(next));
  }

  function resolveDropIndex(clientX: number, clientY: number, draggingLocale: LocaleCode | null = activeDragLocale) {
    return resolveLocaleOrderDropIndex(listRef.current, clientX, clientY, draggingLocale, visibleLocales.length);
  }

  function startPointerDrag(locale: LocaleCode, event: ReactPointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingPointerRef.current = { locale, startX: event.clientX, startY: event.clientY };
  }

  function insertionIndexFromEvent(event: ReactDragEvent<HTMLElement>, index: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }

  function dragOverList(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(locales.length);
  }

  function dragOverItem(event: ReactDragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(insertionIndexFromEvent(event, index));
  }

  function dropOnList(event: ReactDragEvent<HTMLElement>, targetIndex = dropIndex ?? locales.length) {
    event.preventDefault();
    event.stopPropagation();
    dropLocale(event.dataTransfer.getData("text/plain"), targetIndex);
    finishDrag();
  }

  function renderInsertionPlaceholder(index: number) {
    return (
      <div
        aria-hidden="true"
        className="localeInsertPlaceholder"
        key={`placeholder-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropIndex(index);
        }}
        onDrop={(event) => dropOnList(event, index)}
      />
    );
  }

  return (
    <div
      ref={listRef}
      className="fallbackList localeOrderList"
      data-locale-order-list
      onDragOver={dragOverList}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropIndex(null);
        }
      }}
      onDrop={(event) => dropOnList(event)}
    >
      {visibleLocales.length || activeDragLocale || lockedLocales.length ? (
        <>
          {displayedDropIndex === 0 ? renderInsertionPlaceholder(0) : null}
          {visibleLocales.map((locale, index) => (
            <Fragment key={locale}>
              <div
                className={`fallbackChip draggable ${activeDragLocale === locale ? "dragging" : ""}`}
                data-locale={locale}
                data-locale-chip
                onPointerDown={(event) => startPointerDrag(locale, event)}
                onDragOver={(event) => dragOverItem(event, index)}
                onDrop={(event) => dropOnList(event, insertionIndexFromEvent(event, index))}
              >
                <GripVertical size={14} aria-hidden="true" />
                <span>{locale}</span>
                <Tooltip content={t("Remove")}>
                  <button
                    type="button"
                    className="miniIconButton danger"
                    onClick={() => removeLocale(locale)}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label={t("Remove")}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </div>
              {displayedDropIndex === index + 1 ? renderInsertionPlaceholder(index + 1) : null}
            </Fragment>
          ))}
          {lockedLocales.map((locale) => (
            <div className="fallbackChip locked" key={locale}>
              <span>{locale}</span>
            </div>
          ))}
        </>
      ) : displayedDropIndex === 0 ? (
        renderInsertionPlaceholder(0)
      ) : (
        <div className="emptyState">{emptyText}</div>
      )}
      {pointerDrag ? (
        <div
          className="localeDragGhost"
          style={{
            transform: `translate3d(${pointerDrag.x + 12}px, ${pointerDrag.y + 10}px, 0)`,
          }}
        >
          <GripVertical size={14} aria-hidden="true" />
          <span>{pointerDrag.locale}</span>
        </div>
      ) : null}
    </div>
  );
}
