import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { branding } from "../config/branding";

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
          <NavLink to="/today">Today</NavLink>
          <NavLink to="/upcoming">Upcoming</NavLink>
          <NavLink to="/all">All</NavLink>
          <NavLink to="/buckets">Buckets</NavLink>
        </nav>
        <div className="user-area">
          <span>{user?.displayName}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
