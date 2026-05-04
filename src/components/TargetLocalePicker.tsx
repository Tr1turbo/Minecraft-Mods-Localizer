import { GripVertical, Plus, Search, X } from "lucide-react";
import { Fragment, useDeferredValue, useId, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";

import { useI18n } from "../app/i18n";
import {
  BUNDLED_LOCALE_CODES,
  isValidLocaleCode,
  normalizeLocaleCode,
  uniqueLocaleCodes,
} from "../lib/locales";
import type { LocaleCode } from "../lib/types";

const LOCALE_NAMES: Record<string, string> = {
  de_de: "Deutsch",
  en_us: "English",
  es_es: "Español",
  fr_fr: "Français",
  it_it: "Italiano",
  ja_jp: "日本語",
  ko_kr: "한국어",
  lzh: "文言",
  nl_nl: "Nederlands",
  pt_br: "Português do Brasil",
  ru_ru: "Русский",
  th_th: "ไทย",
  uk_ua: "Українська",
  vi_vn: "Tiếng Việt",
  zh_cn: "简体中文",
  zh_hk: "繁體中文（香港）",
  zh_tw: "繁體中文（台灣）",
};

export function TargetLocalePicker({
  selectedLocales,
  onChange,
  showSelectedList = true,
  allowCustom = true,
}: {
  selectedLocales: readonly LocaleCode[];
  onChange: (locales: LocaleCode[]) => void;
  showSelectedList?: boolean;
  allowCustom?: boolean;
}) {
  const { t } = useI18n();
  const searchId = useId();
  const customId = useId();
  const [query, setQuery] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState("");
  const [draggedLocale, setDraggedLocale] = useState<LocaleCode | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const selected = useMemo(() => uniqueLocaleCodes(selectedLocales), [selectedLocales]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(
    () =>
      BUNDLED_LOCALE_CODES.filter((locale) => {
        const name = LOCALE_NAMES[locale] ?? locale;
        return !deferredQuery || locale.includes(deferredQuery) || name.toLowerCase().includes(deferredQuery);
      }),
    [deferredQuery],
  );

  function addLocale(locale: LocaleCode) {
    setCustomError("");
    if (selectedSet.has(locale)) {
      return;
    }
    onChange([...selected, locale]);
  }

  function removeLocale(locale: LocaleCode) {
    onChange(selected.filter((item) => item !== locale));
  }

  function addCustomLocale() {
    const normalized = normalizeLocaleCode(customDraft);
    if (!isValidLocaleCode(normalized)) {
      setCustomError(t("Enter a valid Minecraft locale code."));
      return;
    }
    setCustomError("");
    setCustomDraft("");
    if (!selectedSet.has(normalized)) {
      onChange([...selected, normalized]);
    }
  }

  function startLocaleDrag(locale: LocaleCode, event: ReactDragEvent) {
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", locale);
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
    dragFrameRef.current = window.requestAnimationFrame(() => {
      setDraggedLocale(locale);
      dragFrameRef.current = null;
    });
  }

  function finishLocaleDrag() {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setDraggedLocale(null);
    setDropIndex(null);
  }

  function insertionIndexFromEvent(event: ReactDragEvent<HTMLElement>, index: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }

  function dropLocale(rawLocale: string, targetIndex: number) {
    const locale = normalizeLocaleCode(rawLocale);
    if (!isValidLocaleCode(locale)) {
      return;
    }
    const next = [...selected];
    const fromIndex = next.indexOf(locale);
    if (fromIndex >= 0) {
      const [item] = next.splice(fromIndex, 1);
      const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const boundedIndex = Math.max(0, Math.min(adjustedIndex, next.length));
      if (boundedIndex === fromIndex) {
        return;
      }
      next.splice(boundedIndex, 0, item);
    } else {
      const boundedIndex = Math.max(0, Math.min(targetIndex, next.length));
      next.splice(boundedIndex, 0, locale);
    }
    onChange(uniqueLocaleCodes(next));
  }

  function dragOverSelectedList(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(selected.length);
  }

  function dragOverSelectedItem(event: ReactDragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(insertionIndexFromEvent(event, index));
  }

  function dropOnSelectedList(event: ReactDragEvent<HTMLElement>, targetIndex = dropIndex ?? selected.length) {
    event.preventDefault();
    event.stopPropagation();
    dropLocale(event.dataTransfer.getData("text/plain"), targetIndex);
    finishLocaleDrag();
  }

  function renderInsertionPlaceholder(index: number) {
    return (
      <span
        aria-hidden="true"
        className="localeInsertPlaceholder"
        key={`placeholder-${index}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropIndex(index);
        }}
        onDrop={(event) => dropOnSelectedList(event, index)}
      />
    );
  }

  return (
    <div className="targetLocalePicker">
      <label className="targetLocaleSearch" htmlFor={searchId}>
        <Search size={16} />
        <input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search languages")}
          spellCheck={false}
        />
      </label>

      <div className="targetLocaleOptions" role="group" aria-label={t("Bundled languages")}>
        {visibleOptions.length ? (
          visibleOptions.map((locale) => {
            const active = selectedSet.has(locale);
            return (
              <button
                type="button"
                className={active ? "targetLocaleOption active" : "targetLocaleOption"}
                key={locale}
                onClick={() => addLocale(locale)}
                draggable
                onDragStart={(event) => startLocaleDrag(locale, event)}
                onDragEnd={finishLocaleDrag}
                aria-pressed={active}
              >
                <span className="targetLocaleText">
                  <strong>{locale}</strong>
                  <small>{LOCALE_NAMES[locale] ?? locale}</small>
                </span>
              </button>
            );
          })
        ) : (
          <div className="targetLocaleEmpty">
            <strong>{t("No languages match")}</strong>
            <span>{t("Try another search or add a custom locale.")}</span>
          </div>
        )}
      </div>

      {allowCustom ? (
        <div className="targetLocaleCustom">
          <label htmlFor={customId}>{t("Custom locale")}</label>
          <div className="targetLocaleCustomRow">
            <input
              id={customId}
              value={customDraft}
              onChange={(event) => {
                setCustomDraft(event.target.value);
                setCustomError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustomLocale();
                }
              }}
              placeholder={t("custom code")}
              spellCheck={false}
            />
            <button type="button" onClick={addCustomLocale}>
              <Plus size={16} />
              {t("Add")}
            </button>
          </div>
          {customError ? <div className="targetLocaleError">{customError}</div> : null}
        </div>
      ) : null}

      {showSelectedList ? (
        <div className="targetLocaleSelected" aria-label={t("Selected languages")}>
          <div className="targetLocaleSelectedHeader">
            <span>{t("Selected languages")}</span>
            <strong>{selected.length.toLocaleString()}</strong>
          </div>
          <div
            className="targetLocaleSelectedList"
            onDragOver={dragOverSelectedList}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropIndex(null);
              }
            }}
            onDrop={(event) => dropOnSelectedList(event)}
          >
            {selected.length ? (
              <>
                {dropIndex === 0 ? renderInsertionPlaceholder(0) : null}
                {selected.map((locale, index) => (
                  <Fragment key={locale}>
                    <span
                      className={`targetLocaleChip ${draggedLocale === locale ? "dragging" : ""}`}
                      draggable
                      onDragStart={(event) => startLocaleDrag(locale, event)}
                      onDragEnd={finishLocaleDrag}
                      onDragOver={(event) => dragOverSelectedItem(event, index)}
                      onDrop={(event) => dropOnSelectedList(event, insertionIndexFromEvent(event, index))}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                      <b>{locale}</b>
                      <small>{LOCALE_NAMES[locale] ?? t("Custom")}</small>
                      <button type="button" onClick={() => removeLocale(locale)} aria-label={t("Remove")}>
                        <X size={13} />
                      </button>
                    </span>
                    {dropIndex === index + 1 ? renderInsertionPlaceholder(index + 1) : null}
                  </Fragment>
                ))}
              </>
            ) : dropIndex === 0 ? (
              renderInsertionPlaceholder(0)
            ) : (
              <div className="targetLocaleEmpty compact">{t("Select at least one target language.")}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
