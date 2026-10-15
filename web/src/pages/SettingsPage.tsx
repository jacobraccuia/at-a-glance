import { useNavigate } from "react-router-dom";
import { PalettePicker } from "../components/PalettePicker";
import { useAuth } from "../auth/AuthContext";
import { BucketsPage } from "./BucketsPage";

/** Account: look, buckets, and sign-out at the bottom. */
export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="page settings-page">
      <h1>Account</h1>
      <p className="muted small account-who">{user?.isGuest ? "Guest" : user?.displayName}</p>
      <PalettePicker />
      <BucketsPage />
      <button type="button" className="account-logout" onClick={onLogout}>
        {user?.isGuest ? "End guest" : "Log out"}
      </button>
    </div>
  );
}
