import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { SourcePackScanResult } from "../../lib/types";

export function SourcesPage({
  sourcePacks,
  moveSourcePack,
  removeSourcePack,
}: {
  sourcePacks: SourcePackScanResult[];
  moveSourcePack: (index: number, delta: number) => void;
  removeSourcePack: (index: number) => void;
}) {
  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>Update From</h2>
      </div>
      <section className="panel">
        <div className="panelHeader">
          <h2>Resource pack priority</h2>
        </div>
        <div className="sourcePackList large">
          {sourcePacks.length === 0 ? (
            <div className="emptyState">No source packs</div>
          ) : (
            sourcePacks.map((pack, index) => (
              <div className="sourcePackRow" key={pack.fingerprint.sha256}>
                <span title={pack.fingerprint.name}>{pack.fingerprint.name}</span>
                <div className="iconGroup">
                  <button type="button" className="iconButton" onClick={() => moveSourcePack(index, -1)} aria-label="Move up">
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" className="iconButton" onClick={() => moveSourcePack(index, 1)} aria-label="Move down">
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" className="iconButton danger" onClick={() => removeSourcePack(index)} aria-label="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
