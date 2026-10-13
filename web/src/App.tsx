import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { TodayPage } from "./pages/TodayPage";
import { UpcomingPage } from "./pages/UpcomingPage";
import { AllTasksPage } from "./pages/AllTasksPage";
import { BucketsPage } from "./pages/BucketsPage";
import { HomePage } from "./pages/HomePage";
import { Layout } from "./components/Layout";

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
            <Layout />
          </RequireAuth>
        }
      >
        {/* The app IS the assistant. Lists are secondary views. */}
        <Route path="/" element={<HomePage />} />
        <Route path="/assistant" element={<Navigate to="/" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/upcoming" element={<UpcomingPage />} />
        <Route path="/all" element={<AllTasksPage />} />
        <Route path="/buckets" element={<BucketsPage />} />
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
