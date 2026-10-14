import { PalettePicker } from "../components/PalettePicker";
import { BucketsPage } from "./BucketsPage";

/**
 * Settings home. Buckets live here now (not a primary tab). More account
 * settings can stack under this page later.
 */
export function SettingsPage() {
  return (
    <div className="page settings-page">
      <h1>Settings</h1>
      <PalettePicker />
      <BucketsPage />
    </div>
  );
}
