// REV-015.5 — French copy shared by several auth pages (same idea as
// athleteOnboarding/onboardingCopy.ts). Page-specific wording stays inline in
// each page. Display text only: no Supabase call, validation, error-code
// mapping or redirect depends on these strings.

/** Divider between the Google button and the email form (rendered uppercase by CSS). */
export const AUTH_OR = "ou";

export const EMAIL_LABEL = "Adresse e-mail";

export const PASSWORD_LABEL = "Mot de passe";

/** Client-side check only (never sent to Supabase) — shown when the two password fields differ. */
export const PASSWORDS_MISMATCH = "Les mots de passe ne correspondent pas.";

export const GOOGLE_CONTINUE = "Continuer avec Google";

export const GOOGLE_REDIRECTING = "Redirection…";
