import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { TodayPage } from "./pages/TodayPage";
import { UpcomingPage } from "./pages/UpcomingPage";
import { AllTasksPage } from "./pages/AllTasksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Layout } from "./components/Layout";
import { VoiceSessionProvider } from "./voice/VoiceSessionContext";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RouterContent() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <VoiceSessionProvider>
              <Layout />
            </VoiceSessionProvider>
          </RequireAuth>
        }
      >
        {/* Today is the day you open. Talk sheet stays over it. */}
        <Route path="/" element={<TodayPage />} />
        <Route path="/assistant" element={<Navigate to="/" replace />} />
        <Route path="/today" element={<Navigate to="/" replace />} />
        <Route path="/upcoming" element={<UpcomingPage />} />
        <Route path="/all" element={<AllTasksPage />} />
        <Route path="/buckets" element={<Navigate to="/account" replace />} />
        <Route path="/settings" element={<Navigate to="/account" replace />} />
        <Route path="/account" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RouterContent />
    </AuthProvider>
  );
}
