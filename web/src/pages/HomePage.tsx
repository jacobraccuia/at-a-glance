import { Link } from "react-router-dom";
import { branding } from "../config/branding";
import { MicIcon } from "../components/icons";
import { useVoiceSession } from "../voice/VoiceSessionContext";

/** Quiet home. Conversation lives in the Talk sheet. */
export function HomePage() {
  const { openSession } = useVoiceSession();

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
