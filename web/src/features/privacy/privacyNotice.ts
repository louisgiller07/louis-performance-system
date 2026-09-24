/**
 * Version of the privacy notice shown at /privacy. Bump it whenever the notice text
 * changes materially: every athlete whose accepted version differs is asked to consent
 * again (athlete_onboarding_profiles.privacy_notice_version).
 */
export const PRIVACY_NOTICE_VERSION = "2026-09-24";

/** Official contact already published by NALYNT (marketing site). */
export const PRIVACY_CONTACT_EMAIL = "contact@nalynt.ch";

/** Operator (data controller) identity, as approved in PILOT_013. A natural person, not a company. */
export const PRIVACY_OPERATOR: { name: string; addressLines: readonly string[] } = {
  name: "Louis Giller",
  addressLines: ["Clos de la Cure 1", "1609 St-Martin", "Suisse"],
};
