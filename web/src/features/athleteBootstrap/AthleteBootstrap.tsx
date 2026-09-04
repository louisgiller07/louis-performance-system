import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
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
    <div className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Configurer ton profil</h1>
      <p className="mb-6 text-sm text-gray-600">Entre ton nom pour commencer.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Nom
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="rounded border border-gray-300 px-3 py-3 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Création…" : "Continuer"}
        </button>
      </form>
    </div>
  );
}
