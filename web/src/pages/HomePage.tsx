import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { branding } from "../config/branding";
import { MicIcon } from "../components/icons";
import { useVoiceSession } from "../voice/VoiceSessionContext";

interface EasyWin {
  id: string;
  title: string;
  estimateMinutes: number | null;
  assumedMinutes: number;
}

/**
 * Quiet home: glance + easy wins. Tap a win to open its details on All
 * (not auto-complete). Conversation lives in the Talk sheet.
 */
export function HomePage() {
  const { openSession } = useVoiceSession();
  const [easyWins, setEasyWins] = useState<EasyWin[]>([]);
  const [easyWinsMinutes, setEasyWinsMinutes] = useState(25);
  const [loading, setLoading] = useState(true);

  const loadEasyWins = useCallback((minutes = 25) => {
    api
      .get<{ minutes: number; wins: EasyWin[] }>(`/assistant/easy-wins?minutes=${minutes}`)
      .then((r) => {
        setEasyWins(r.wins);
        setEasyWinsMinutes(r.minutes);
      })
      .catch(() => {
        /* non-fatal */
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadEasyWins(25);
  }, [loadEasyWins]);

  return (
    <div className="page home-page">
      <header className="home-hero">
        <h1>{branding.appName}</h1>
        <p className="orientation">Talk to your assistant. Then come back here to see what's left.</p>
        <button type="button" className="home-talk-cta" onClick={openSession}>
          <MicIcon />
          Talk
        </button>
      </header>

      {loading && <p className="muted">Loading…</p>}

      {!loading && easyWins.length > 0 && (
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
      )}

      <p className="muted small home-links">
        <Link to="/today">Today</Link>
        {" · "}
        <Link to="/all">All tasks</Link>
        {" · "}
        <Link to="/account">Account</Link>
      </p>
    </div>
  );
}
