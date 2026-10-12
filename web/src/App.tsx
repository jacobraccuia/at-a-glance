import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { TodayPage } from "./pages/TodayPage";
import { UpcomingPage } from "./pages/UpcomingPage";
import { AllTasksPage } from "./pages/AllTasksPage";
import { BucketsPage } from "./pages/BucketsPage";
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
        <Route path="/today" element={<TodayPage />} />
        <Route path="/upcoming" element={<UpcomingPage />} />
        <Route path="/all" element={<AllTasksPage />} />
        <Route path="/buckets" element={<BucketsPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
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
