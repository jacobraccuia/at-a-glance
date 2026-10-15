import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { branding } from "../config/branding";
import { primeTalkAudio } from "../hooks/useAssistantTts";
import { useVoiceSession } from "../voice/VoiceSessionContext";
import { MicIcon, ProfileIcon } from "./icons";
import { VoiceSheet } from "./VoiceSheet";

// Today is the day. Talk stays the big center button. All is the other list.
// Account lives on the profile icon, not in the tab bar.
const NAV_ITEMS = [
  {
    to: "/",
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
    label: "All",
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
      <header className="app-header">
        <span className="brand">{branding.appName}</span>
        <NavLink to="/account" className="header-profile" aria-label="Account" title="Account">
          <ProfileIcon />
        </NavLink>
      </header>
      {user?.isGuest && (
        <div className="guest-banner" role="status">
          Guest mode — sample data, nothing permanent. Tap Talk to try voice.
        </div>
      )}
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav">
        <NavLink to={NAV_ITEMS[0].to} end={NAV_ITEMS[0].end}>
          {NAV_ITEMS[0].icon}
          {NAV_ITEMS[0].label}
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
          <span>Talk</span>
        </button>
        <NavLink to={NAV_ITEMS[1].to} end={NAV_ITEMS[1].end}>
          {NAV_ITEMS[1].icon}
          {NAV_ITEMS[1].label}
        </NavLink>
      </nav>
      <VoiceSheet />
    </div>
  );
}
