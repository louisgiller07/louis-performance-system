import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { PrimaryButton } from "../components/PrimaryButton";

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    return <Navigate to="/today" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      // V0.3_005C (NAL-005) — never render the raw Supabase Auth provider
      // message (e.g. "Invalid login credentials") verbatim: it's English,
      // provider-authored, and not ours to guarantee the wording of. The
      // app doesn't currently distinguish auth failure reasons (no
      // existing branch to preserve), so one curated French message covers
      // every case. Name only in the log — never the message, same
      // discipline as historyRepo.ts/HistoryPage.tsx's console.error calls.
      console.error("LoginPage: sign-in failed", signInError.name);
      setError("Impossible de se connecter. Vérifie tes identifiants et réessaie.");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-4 py-8">
      {/* V0.3 UX PREMIUM — decorative only, no data: a very light gold
          radial glow behind the logo, per spec ("pas d'effet flashy"). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{ background: "radial-gradient(ellipse at top, rgba(212,175,55,0.08), transparent 70%)" }}
      />

      <div className="relative flex w-full max-w-105 flex-col items-center">
        <p className="text-3xl font-bold uppercase tracking-[0.3em] text-gold">Nalynt</p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted">Your AI Performance Coach</p>
        <p className="mt-4 max-w-70 text-center text-sm text-ink/70">
          Your AI coach for training, recovery and race performance.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-card p-6 shadow-xl"
        >
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
            Mot de passe
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded border border-white/10 bg-bg px-3 py-3 text-base text-ink normal-case placeholder:text-muted focus:border-gold focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={submitting} className="min-h-12.5 text-base tracking-wide">
            {submitting ? "Connexion…" : "Connexion"}
          </PrimaryButton>
        </form>

        <div className="mt-8 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Designed for</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/70">
            DH <span className="text-gold">•</span> Enduro <span className="text-gold">•</span> Gravity
          </p>
        </div>
      </div>
    </div>
  );
}
