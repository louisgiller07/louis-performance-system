import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { PrimaryButton } from "../../components/PrimaryButton";
import { createOwnAthlete, AthleteBootstrapError } from "./athleteBootstrapRepo";
import { validateAthleteName } from "./athleteBootstrapValidation";

/**
 * V0.3_004B — shown by RequireAuth when an authenticated user has zero
 * athlete rows. Athlete bootstrap only, not onboarding: exactly the one
 * field the DB actually requires (`athletes.name`, NOT NULL/no default).
 * Every other column keeps its DB default (see athleteBootstrapRepo.ts).
 */
export function AthleteBootstrap() {
  const { user, refreshAthlete } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const validated = validateAthleteName(name);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    if (!user) {
      // Session disappeared mid-flight (e.g. token expiry) — RequireAuth
      // will redirect to /login on its own next render; this message is
      // only for the brief window before that happens.
      setError("Ta session a expiré. Reconnecte-toi.");
      return;
    }

    setSubmitting(true);
    let insertError: unknown = null;
    try {
      await createOwnAthlete(user.id, validated.name);
    } catch (err) {
      insertError = err;
    }

    // Always re-resolve, even after a failed insert: a double click, two
    // open tabs, or a retried request can legitimately race a UNIQUE
    // (user_id) conflict while still leaving a real, usable athlete row
    // behind (created by whichever attempt won). Never trust the raw
    // insert result/error alone — only the re-resolved state decides
    // whether this is actually a dead end.
    const result = await refreshAthlete();
    setSubmitting(false);

    if (result.status === "resolved") return; // RequireAuth now renders the normal app on its next render.

    if (insertError) {
      setError(insertError instanceof AthleteBootstrapError ? insertError.message : "Une erreur inattendue s'est produite. Réessaie.");
    } else {
      setError("Impossible de vérifier la création de ton profil. Réessaie.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-105">
        <p className="text-center text-2xl font-bold uppercase tracking-[0.2em] text-gold">Nalynt</p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-card p-6 shadow-xl"
        >
          <div>
            <h1 className="text-xl font-bold text-ink">Bienvenue sur NALYNT</h1>
            <p className="mt-1 text-sm text-muted">Créons ton profil d'athlète.</p>
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Nom
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              className="rounded border border-white/10 bg-bg px-3 py-3 text-base text-ink normal-case placeholder:text-muted focus:border-gold focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={submitting} className="min-h-12.5 text-base tracking-wide">
            {submitting ? "Création…" : "Continuer"}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}
