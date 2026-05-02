import { Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { estimateRemainingTime } from "../app/helpers";
import type { TranslationProgress } from "../app/types";

export function TranslationProgressPanel({
  progress,
  pauseTranslationJob,
  resumeTranslationJob,
  stopTranslationJob,
}: {
  progress: TranslationProgress;
  pauseTranslationJob: () => void;
  resumeTranslationJob: () => void;
  stopTranslationJob: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const remaining = estimateRemainingTime(progress, now);
  const statusLabel =
    progress.status === "paused" ? "Paused" : progress.status === "stopping" ? "Stopping" : `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;

  return (
    <section className="translationProgressPanel" aria-label="LLM translation progress">
      <div className="progressHeader">
        <div>
          <strong>{progress.label}</strong>
          <span>{statusLabel}</span>
        </div>
        <span>{percent}%</span>
      </div>
      <div className="progressBar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} role="progressbar">
        <div className="progressBarFill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progressFooter">
        <div className="progressStats">
          <span>ETA {remaining}</span>
          {progress.warningCount ? <span>{progress.warningCount.toLocaleString()} warning(s)</span> : null}
        </div>
        <div className="progressControls">
          {progress.status === "paused" ? (
            <button type="button" onClick={resumeTranslationJob}>
              <Play size={16} />
              Resume
            </button>
          ) : (
            <button type="button" onClick={pauseTranslationJob} disabled={progress.status === "stopping"}>
              <Pause size={16} />
              Pause
            </button>
          )}
          <button type="button" className="danger" onClick={stopTranslationJob} disabled={progress.status === "stopping"}>
            <Square size={16} />
            Stop
          </button>
        </div>
      </div>
    </section>
  );
}
