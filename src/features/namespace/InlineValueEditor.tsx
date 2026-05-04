import { useContext } from "react";
import { SourceLabelContext } from "../../app/sourceLabels";
import type { ResolvedEntry } from "../../lib/types";

export function InlineValueEditor({
  entry,
  draft,
  setDraft,
  clearDraft,
  saveValue,
  selectRow,
}: {
  entry: ResolvedEntry;
  draft?: string;
  setDraft: (value: string) => void;
  clearDraft: () => void;
  saveValue: (value: string) => Promise<void>;
  selectRow: () => void;
}) {
  const value = draft ?? entry.final.value;
  const sourceLabels = useContext(SourceLabelContext);
  return (
    <input
      className={`inlineValueInput ${entry.final.source}`}
      style={{ borderLeftColor: sourceLabels[entry.final.source].stripe }}
      value={value}
      onFocus={selectRow}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (event.target.value !== entry.final.value) {
          void saveValue(event.target.value);
        } else {
          clearDraft();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          clearDraft();
          event.currentTarget.blur();
        }
      }}
      spellCheck={false}
    />
  );
}
