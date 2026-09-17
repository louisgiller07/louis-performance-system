import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { PrimaryButton } from "../components/PrimaryButton";

/** Same discipline as LoginPage.tsx/SignupPage.tsx — never raw `.message`, branch on the stable documented `.code`. */
function resetErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "email_address_invalid":
    case "validation_failed":
      return "Adresse email invalide.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Trop de tentatives. Réessaie dans quelques minutes.";
    default:
      return "Impossible d'envoyer le lien. Réessaie.";
  }
}

// Request phase of the password-reset flow: sends the reset email. The
// actual password change happens on /reset-password (ResetPasswordPage.tsx),
// reached via the link inside that email — this page never sees or sets a
// new password itself. Deliberately never reveals whether the email is
// actually registered (same message either way) — a distinct message for
// "unknown email" would let this form be used to enumerate accounts.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);

    if (resetError) {
      console.error("ForgotPasswordPage: reset request failed", resetError.code ?? resetError.name);
      setError(resetErrorMessage(resetError));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
        <p className="text-2xl font-bold uppercase tracking-[0.2em] text-gold">Nalynt</p>
        <p className="mt-6 max-w-sm text-ink">Check your email for a reset link.</p>
        <p className="mt-2 max-w-sm text-sm text-muted">
          If an account exists for <span className="text-ink">{email}</span>, we sent instructions to reset your password.
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

        <form
          onSubmit={handleSubmit}
          className="mt-8 flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-card p-6 shadow-xl"
        >
          <div>
            <p className="text-xl font-bold text-ink">Reset your password</p>
            <p className="mt-1 text-sm text-muted">We'll email you a reset link.</p>
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
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={submitting} className="min-h-12.5 text-base tracking-wide">
            {submitting ? "Sending…" : "Send reset link"}
          </PrimaryButton>

          <Link to="/login" className="text-center text-sm text-muted hover:text-gold">
            Back to login
          </Link>
        </form>
      </div>
    </div>
  );
}
