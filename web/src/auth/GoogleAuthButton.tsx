import { useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/** Same discipline as the other auth pages — never raw `.message`, branch on the stable documented `.code`. */
function googleAuthErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "over_request_rate_limit":
      return "Trop de tentatives. Réessaie dans quelques minutes.";
    case "provider_disabled":
      return "La connexion Google n'est pas disponible pour le moment.";
    default:
      return "Impossible de se connecter avec Google. Réessaie.";
  }
}

interface GoogleAuthButtonProps {
  onError: (message: string) => void;
}

// Shared by LoginPage.tsx and SignupPage.tsx — Google sign-in and sign-up
// are the exact same Supabase call (signInWithOAuth creates the account on
// first use), so one component covers both entry points. A successful call
// navigates the browser away to Google immediately; the code after it only
// ever runs for a failure that happens before that handoff (network error,
// provider misconfigured). A user cancelling on Google's own consent screen
// never re-enters this function — see LoginPage.tsx's oauth callback check
// for that case.
export function GoogleAuthButton({ onError }: GoogleAuthButtonProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      console.error("GoogleAuthButton: OAuth sign-in failed", error.code ?? error.name);
      onError(googleAuthErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting}
      className="flex min-h-11 items-center justify-center gap-2.5 rounded border border-white/10 bg-card px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-gold disabled:opacity-40"
    >
      <GoogleIcon />
      {submitting ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.96H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.04l3-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.96l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Supabase (GoTrue) appends `error`/`error_code` as query params to
 * redirectTo when the OAuth provider step fails — most commonly the user
 * cancelling on Google's own consent screen (`access_denied`). This never
 * touches Supabase state itself; it only reads the URL LoginPage just
 * landed on and cleans it up so a refresh doesn't re-show the message.
 */
export function readOAuthCallbackError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("error_code") ?? params.get("error");
  if (!code) {
    return null;
  }
  window.history.replaceState(null, "", window.location.pathname);
  return code === "access_denied" ? "Connexion Google annulée." : "Impossible de se connecter avec Google. Réessaie.";
}
