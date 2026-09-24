import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AthleteBootstrap } from "../features/athleteBootstrap/AthleteBootstrap";
import { AthleteOnboarding } from "../features/athleteOnboarding/AthleteOnboarding";
import { ConsentGate } from "../features/privacy/ConsentGate";
import { PRIVACY_NOTICE_VERSION } from "../features/privacy/privacyNotice";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, athleteResolution } = useAuth();

  if (loading || (session && athleteResolution.status === "loading")) {
    return <div className="p-6 text-center text-sm text-gray-500">Chargement…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (athleteResolution.status === "no_athlete") {
    return <AthleteBootstrap />;
  }

  if (athleteResolution.status === "resolved" && !athleteResolution.onboardingCompleted) {
    return <AthleteOnboarding />;
  }

  // Explicit health-data consent for the current notice — never inferred for existing accounts.
  if (athleteResolution.status === "resolved" && athleteResolution.acceptedPrivacyNoticeVersion !== PRIVACY_NOTICE_VERSION) {
    return <ConsentGate />;
  }

  if (athleteResolution.status === "config_error") {
    return (
      <div className="p-6 text-center text-sm text-red-600">
        Erreur de configuration : impossible de résoudre ton profil athlète. Contacte le support.
      </div>
    );
  }

  return <>{children}</>;
}
