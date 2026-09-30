import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { BrandLoading, BrandMessage } from "../components/BrandScreen";
import { AthleteBootstrap } from "../features/athleteBootstrap/AthleteBootstrap";
import { AthleteOnboarding } from "../features/athleteOnboarding/AthleteOnboarding";
import { ConsentGate } from "../features/privacy/ConsentGate";
import { PRIVACY_NOTICE_VERSION } from "../features/privacy/privacyNotice";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, athleteResolution } = useAuth();
  const { pathname } = useLocation();

  if (loading || (session && athleteResolution.status === "loading")) {
    return <BrandLoading />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // UX-09 — the whole first run lives on /start (welcome → who you are →
  // your training → your first plan), so it continues on one route with no
  // page in between: any other route sends a new athlete there first.
  const inFirstRun = athleteResolution.status === "no_athlete" || (athleteResolution.status === "resolved" && !athleteResolution.onboardingCompleted);
  if (inFirstRun && pathname !== "/start") {
    return <Navigate to="/start" replace />;
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
      <BrandMessage title="Profil introuvable" tone="error">
        Erreur de configuration : impossible de résoudre ton profil athlète. Contacte le support.
      </BrandMessage>
    );
  }

  return <>{children}</>;
}
