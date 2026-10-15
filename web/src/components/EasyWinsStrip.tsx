import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
}

/** Short tasks that fit a small pocket of time. Opens details, does not complete. */
export function EasyWinsStrip() {
  const [easyWins, setEasyWins] = useState<EasyWin[]>([]);
  const [easyWinsMinutes, setEasyWinsMinutes] = useState(25);

  const loadEasyWins = useCallback((minutes = 25) => {
    api
      .get<{ minutes: number; wins: EasyWin[] }>(`/assistant/easy-wins?minutes=${minutes}`)
      .then((r) => {
        setEasyWins(r.wins);
        setEasyWinsMinutes(r.minutes);
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  useEffect(() => {
    loadEasyWins(25);
  }, [loadEasyWins]);

  if (easyWins.length === 0) return null;

  return (
    <section className="easy-wins-strip" aria-label="Easy wins">
      <div className="easy-wins-head">
        <h2>Easy wins</h2>
        <span className="muted small">~{easyWinsMinutes} min</span>
      </div>
      <ul className="easy-wins-list">
        {easyWins.map((w) => (
          <li key={w.id}>
            <Link className="easy-win-chip" to={`/all?task=${w.id}`} title="Open details">
              <span className="easy-win-title">{w.title}</span>
              <span className="easy-win-meta">
                {w.estimateMinutes != null ? `~${w.estimateMinutes}m` : `~${w.assumedMinutes}m?`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
