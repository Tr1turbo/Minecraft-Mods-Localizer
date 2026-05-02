import { useRef } from "react";
import type { DiffSegment } from "../../app/types";

export function PatchTextEditor({
  value,
  onChange,
  diffSegments,
  hasManualPatch,
}: {
  value: string;
  onChange: (value: string) => void;
  diffSegments: DiffSegment[];
  hasManualPatch: boolean;
}) {
  const diffLayerRef = useRef<HTMLPreElement>(null);

  return (
    <div className={`patchEditorFrame ${hasManualPatch ? "manualPatch" : "noManualPatch"}`}>
      <pre className="patchDiffLayer" aria-hidden="true" ref={diffLayerRef}>
        {diffSegments.length === 0
          ? "\u00a0"
          : diffSegments.map((segment, index) => (
              <span className={`patchDiffSegment ${segment.kind}`} key={`${segment.kind}-${index}`}>
                {segment.text}
              </span>
            ))}
      </pre>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (!diffLayerRef.current) {
            return;
          }
          diffLayerRef.current.scrollTop = event.currentTarget.scrollTop;
          diffLayerRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        spellCheck={false}
      />
    </div>
  );
}
