import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { primeTalkAudio } from "../hooks/useAssistantTts";
import { useVoiceSession } from "../voice/VoiceSessionContext";
import { MicIcon } from "./icons";
import { VoiceSheet } from "./VoiceSheet";
import { LiveSheet } from "./LiveSheet";

// Today is the day. Talk stays the big center button. All is the other list.
// Account lives on the profile icon, not in the tab bar.
const NAV_ITEMS = [
  {
    to: "/today",
    label: "Today",
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    to: "/all",
    label: "Everything",
    end: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
] as const;

export function Layout() {
  const { user } = useAuth();
  const { open, toggleSession } = useVoiceSession();

  return (
    <div className="app-shell">
      {user?.isGuest && (
        <div className="guest-banner" role="status">
          Guest mode — sample data, nothing permanent. Tap Talk to try voice.
        </div>
      )}
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Task views">
        <NavLink to="/today" className={({ isActive }) => (isActive ? "active" : "")} aria-label="Today">
          {NAV_ITEMS[0].icon}
        </NavLink>
        <button
          type="button"
          className={`bottom-nav-mic${open ? " open" : ""}`}
          onClick={() => {
            primeTalkAudio();
            toggleSession();
          }}
          aria-label={open ? "Close conversation" : "Talk to assistant"}
          aria-pressed={open}
        >
          <MicIcon />
        </button>
        <NavLink to="/all" className={({ isActive }) => (isActive ? "active" : "")} aria-label="Everything">
          {NAV_ITEMS[1].icon}
        </NavLink>
      </nav>
      <VoiceSheet />
      <LiveSheet />
    </div>
  );
}
