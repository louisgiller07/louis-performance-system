import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AthleteBootstrap } from "../features/athleteBootstrap/AthleteBootstrap";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, athleteResolution } = useAuth();

  if (loading || (session && athleteResolution.status === "loading")) {
    return <div className="p-6 text-center text-sm text-gray-500">Loading…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (athleteResolution.status === "no_athlete") {
    return <AthleteBootstrap />;
  }

  if (athleteResolution.status === "config_error") {
    return (
      <div className="p-6 text-center text-sm text-red-600">
        Configuration error: unable to resolve your athlete profile. Contact support.
      </div>
    );
  }

  return <>{children}</>;
}
