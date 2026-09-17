import { useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router-dom";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { PrimaryButton } from "../components/PrimaryButton";

/** Same discipline as LoginPage.tsx/SignupPage.tsx — never raw `.message`, branch on the stable documented `.code`. */
function updatePasswordErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "weak_password":
      return "Mot de passe trop court (6 caractères minimum).";
    case "same_password":
      return "Choisis un mot de passe différent de l'ancien.";
    default:
      return "Impossible de mettre à jour le mot de passe. Réessaie.";
  }
}

// Completion phase of the password-reset flow. Reached only via the link
// Supabase emails from ForgotPasswordPage.tsx's resetPasswordForEmail call
// — that link's token establishes a temporary session automatically
// (Supabase JS's own detectSessionInUrl), which is exactly what
// supabase.auth.updateUser needs. This page never generates or validates
// that token itself — it only acts once AuthContext already resolved a
// session from it. No RequireAuth wrapper: a bare `session` check here (not
// an athlete-resolution check) is the correct gate for this one purpose.
export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <Navigate to="/today" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      console.error("ResetPasswordPage: password update failed", updateError.code ?? updateError.name);
      setError(updatePasswordErrorMessage(updateError));
      return;
    }
    setDone(true);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Chargement…</div>;
  }

  // No session means the recovery link is missing, invalid, or already
  // expired/used — never show a password form with nothing to authorize it.
  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
        <p className="text-2xl font-bold uppercase tracking-[0.2em] text-gold">Nalynt</p>
        <p className="mt-6 max-w-sm text-ink">This reset link is invalid or has expired.</p>
        <Link to="/forgot-password" className="mt-4 text-sm font-medium text-gold hover:underline">
          Request a new link
        </Link>
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

        <form
          onSubmit={handleSubmit}
          className="mt-8 flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-card p-6 shadow-xl"
        >
          <div>
            <p className="text-xl font-bold text-ink">Set a new password</p>
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            New password
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
            Confirm new password
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
            {submitting ? "Updating…" : "Update password"}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
