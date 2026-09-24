import { supabase } from "../../lib/supabase";
import { PRIVACY_NOTICE_VERSION } from "./privacyNotice";

export class HealthDataConsentError extends Error {
  constructor() {
    super("Impossible d'enregistrer ton consentement. Réessaie.");
    this.name = "HealthDataConsentError";
  }
}

/**
 * Records the athlete's explicit consent to the current privacy notice on their own
 * onboarding row (RLS: athlete_onboarding_profiles_own_data). Only the version is sent —
 * health_data_consent_at is set server-side by a trigger, never by the client.
 */
export async function recordHealthDataConsent(athleteId: string): Promise<void> {
  const { data, error } = await supabase
    .from("athlete_onboarding_profiles")
    .update({ privacy_notice_version: PRIVACY_NOTICE_VERSION })
    .eq("athlete_id", athleteId)
    .select("athlete_id");

  if (error || !data || data.length !== 1) {
    console.error("consentRepo.recordHealthDataConsent failed", error?.code ?? "no_row");
    throw new HealthDataConsentError();
  }
}
