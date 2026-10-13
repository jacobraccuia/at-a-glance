import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { branding } from "../config/branding";
import { useVoiceSession } from "../voice/VoiceSessionContext";
import { MicIcon } from "./icons";
import { VoiceSheet } from "./VoiceSheet";

// Lists in the tab bar. Center mic opens the conversation sheet over
// whatever screen you're on — does not navigate away.
const NAV_ITEMS = [
  {
    to: "/",
    label: "Home",
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
    ),
  },
  {
    to: "/today",
    label: "Today",
    end: false,
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
  {
    to: "/buckets",
    label: "Buckets",
    end: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l2-3h14l2 3M3 7h18M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7" />
      </svg>
    ),
  },
] as const;

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { open, openSession, toggleSession } = useVoiceSession();

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  const left = NAV_ITEMS.slice(0, 2);
  const right = NAV_ITEMS.slice(2);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">{branding.appName}</span>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/upcoming">Upcoming</NavLink>
          <button type="button" className="header-talk" onClick={openSession}>
            Talk
          </button>
        </nav>
        <div className="user-area">
          <span>{user?.displayName}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav">
        {left.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-nav-mic${open ? " open" : ""}`}
          onClick={toggleSession}
          aria-label={open ? "Close conversation" : "Talk to assistant"}
          aria-pressed={open}
        >
          <MicIcon />
          <span>Talk</span>
        </button>
        {right.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <VoiceSheet />
    </div>
  );
}
