import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { branding } from "../config/branding";

// Thin secondary nav. Home (the chat assistant) IS the app; lists are
// views you duck into, not peers of a separate "Assistant" tab.
const NAV_ITEMS = [
  {
    to: "/",
    label: "Home",
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
    to: "/upcoming",
    label: "Upcoming",
    end: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
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

  async function onLogout() {
    await logout();
    navigate("/login");
  }

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
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
