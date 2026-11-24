import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { CheckIcon } from "./icons";

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
}

const BUDGETS = [15, 30, 45];

interface Props {
  minutes: number;
  onMinutes: (minutes: number) => void;
  bucketId?: string;
  hideWork?: boolean;
  refreshToken?: number;
  hiddenIds?: string[];
  onComplete: (id: string) => void;
}

/** Short tasks that fit the time you actually have. Checking one off clears it here. */
export function EasyWinsStrip({
  minutes,
  onMinutes,
  bucketId = "",
  hideWork = false,
  refreshToken = 0,
  hiddenIds = [],
  onComplete,
}: Props) {
  const [easyWins, setEasyWins] = useState<EasyWin[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadEasyWins = useCallback(() => {
    const params = new URLSearchParams({ minutes: String(minutes) });
    if (bucketId) params.set("bucketId", bucketId);
    else if (hideWork) params.set("excludeBucketName", "Work");
    api
      .get<{ minutes: number; wins: EasyWin[] }>(`/assistant/easy-wins?${params.toString()}`)
      .then((r) => setEasyWins(r.wins))
      .catch(() => {
        /* non-fatal */
      })
      .finally(() => setLoaded(true));
  }, [minutes, bucketId, hideWork]);

  useEffect(() => {
    loadEasyWins();
  }, [loadEasyWins, refreshToken]);

  const visible = easyWins.filter((w) => !hiddenIds.includes(w.id));
  if (!loaded) return null;
  if (visible.length === 0) {
    return (
      <section className="easy-wins-strip" aria-label="Easy wins">
        <div className="easy-wins-head">
          <h2>Easy wins</h2>
          <BudgetChips minutes={minutes} onMinutes={onMinutes} />
        </div>
        <p className="muted small">Nothing that fits {minutes} minutes.</p>
      </section>
    );
  }

  return (
    <section className="easy-wins-strip" aria-label="Easy wins">
      <div className="easy-wins-head">
        <h2>Easy wins</h2>
        <BudgetChips minutes={minutes} onMinutes={onMinutes} />
      </div>
      <ul className="easy-wins-list">
        {visible.map((w) => (
          <li key={w.id}>
            <button type="button" className="easy-win-chip" onClick={() => onComplete(w.id)}>
              <span className="easy-win-check" aria-hidden>
                <CheckIcon />
              </span>
              <span className="easy-win-title">{w.title}</span>
              <span className="easy-win-meta">
                {w.estimateMinutes != null ? `~${w.estimateMinutes}m` : `~${w.assumedMinutes}m?`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BudgetChips({ minutes, onMinutes }: { minutes: number; onMinutes: (minutes: number) => void }) {
  return (
    <div className="easy-win-budgets" role="group" aria-label="Time available">
      {BUDGETS.map((n) => (
        <button
          key={n}
          type="button"
          className={`view-chip${minutes === n ? " active" : ""}`}
          aria-pressed={minutes === n}
          onClick={() => onMinutes(n)}
        >
          {n}m
        </button>
      ))}
    </div>
  );
}
