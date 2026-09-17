import { useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router-dom";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { PrimaryButton } from "../components/PrimaryButton";
import { GoogleAuthButton } from "./GoogleAuthButton";

/**
 * Never the raw provider `.message` (English, provider-authored — same
 * discipline as LoginPage.tsx/NAL-005), but `.code` is a stable, documented
 * part of the Supabase Auth API contract (auth-js error-codes.d.ts) — safe
 * to branch on, unlike matching against `.message` prose.
 */
function signupErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return "Un compte existe déjà avec cette adresse email.";
    case "weak_password":
      return "Mot de passe trop court (6 caractères minimum).";
    case "email_address_invalid":
    case "validation_failed":
      return "Adresse email invalide.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Trop de tentatives. Réessaie dans quelques minutes.";
    default:
      return "Impossible de créer le compte. Réessaie.";
  }
}

export function SignupPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // True once signUp succeeded but returned no session — Supabase Auth's
  // "Confirm email" setting is a project-level dashboard config this code
  // has no visibility into; it must handle either outcome correctly rather
  // than assume one. See docs/11_DECISION_LOG.md V1 Marketing→Signup flow.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // A session already means "signed in" (including right after a
  // just-completed signUp, once AuthContext's onAuthStateChange listener
  // picks it up) — same redirect pattern as LoginPage.tsx.
  if (session) {
    return <Navigate to="/today" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Client-side only — a typo-catching convenience, never sent to
    // Supabase and never a substitute for the server's own password policy
    // (weak_password below still applies after this check passes).
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);

    if (signUpError) {
      console.error("SignupPage: sign-up failed", signUpError.code ?? signUpError.name);
      setError(signupErrorMessage(signUpError));
      return;
    }

    if (!data.session) {
      // Email confirmation required — no session yet, nothing to redirect
      // to. This is the honest outcome, not a bug: never fabricate a
      // redirect the athlete isn't actually authenticated for.
      setAwaitingConfirmation(true);
    }
    // If a session WAS returned, `session` above will pick it up on the
    // next render (AuthContext's own auth-state listener) and redirect.
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
        <p className="text-2xl font-bold uppercase tracking-[0.2em] text-gold">Nalynt</p>
        <p className="mt-6 max-w-sm text-ink">Check your email to confirm your account.</p>
        <p className="mt-2 max-w-sm text-sm text-muted">
          We sent a confirmation link to <span className="text-ink">{email}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-4 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{ background: "radial-gradient(ellipse at top, rgba(212,175,55,0.08), transparent 70%)" }}
      />

      <div className="relative flex w-full max-w-105 flex-col items-center">
        <p className="text-3xl font-bold uppercase tracking-[0.3em] text-gold">Nalynt</p>

        <div className="mt-8 flex w-full flex-col gap-4">
          <GoogleAuthButton onError={setError} />

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Or</p>
            <div className="h-px flex-1 bg-white/10" />
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-4 flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-card p-6 shadow-xl"
        >
          <div>
            <p className="text-xl font-bold text-ink">Join NALYNT</p>
            <p className="mt-1 text-sm text-muted">Create your free athlete account</p>
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-white/10 bg-bg px-3 py-3 text-base text-ink normal-case placeholder:text-muted focus:border-gold focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded border border-white/10 bg-bg px-3 py-3 text-base text-ink normal-case placeholder:text-muted focus:border-gold focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Confirm password
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="rounded border border-white/10 bg-bg px-3 py-3 text-base text-ink normal-case placeholder:text-muted focus:border-gold focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={submitting} className="min-h-12.5 text-base tracking-wide">
            {submitting ? "Creating account…" : "Create account"}
          </PrimaryButton>

          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-gold hover:underline">
              Login
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
