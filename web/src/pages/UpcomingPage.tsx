import { Navigate } from "react-router-dom";

export function UpcomingPage() {
  return <Navigate to="/all?view=upcoming" replace />;
}
