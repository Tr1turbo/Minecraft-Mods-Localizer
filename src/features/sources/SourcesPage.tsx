import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useI18n } from "../../app/i18n";
import { Tooltip } from "../../components/Tooltip";
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
  const { t } = useI18n();
  return (
    <section className="pagePane">
      <div className="pageTitle">
        <h2>{t("Update From")}</h2>
      </div>
      <section className="panel">
        <div className="panelHeader">
          <h2>{t("Resource pack priority")}</h2>
        </div>
        <div className="sourcePackList large">
          {sourcePacks.length === 0 ? (
            <div className="emptyState">{t("No source packs")}</div>
          ) : (
            sourcePacks.map((pack, index) => (
              <div className="sourcePackRow" key={pack.fingerprint.sha256}>
                <Tooltip content={pack.fingerprint.name} className="sourcePackNameTooltip">
                  <span>{pack.fingerprint.name}</span>
                </Tooltip>
                <div className="iconGroup">
                  <Tooltip content={t("Move up")}>
                    <button type="button" className="iconButton" onClick={() => moveSourcePack(index, -1)} aria-label={t("Move up")}>
                      <ArrowUp size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content={t("Move down")}>
                    <button type="button" className="iconButton" onClick={() => moveSourcePack(index, 1)} aria-label={t("Move down")}>
                      <ArrowDown size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content={t("Remove")}>
                    <button type="button" className="iconButton danger" onClick={() => removeSourcePack(index)} aria-label={t("Remove")}>
                      <Trash2 size={16} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
