import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { FirstRunShell } from "../firstRun/FirstRunShell";
import { WELCOME } from "../firstRun/firstRunPresentation";
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

  async function handleSubmit() {
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

  // UX-09 — the first screen of the first run: the promise before any
  // question, then the one thing needed to create the profile.
  return (
    <FirstRunShell
      chapter={0}
      title={WELCOME.kicker}
      onNext={() => void handleSubmit()}
      nextLabel={submitting ? WELCOME.creating : WELCOME.start}
      busy={submitting}
      error={error}
      stepKey="welcome"
    >
      <div className="rounded-2xl border border-gold/40 bg-card p-5">
        <p className="font-display text-3xl font-extrabold uppercase leading-none text-ink">
          {WELCOME.title[0]}
          <br />
          <span className="text-gold">{WELCOME.title[1]}</span>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">{WELCOME.promise}</p>
        <p className="mt-4 text-sm text-ink/70">{WELCOME.inMinutes}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {WELCOME.essentials.map((item) => (
            <li key={item} className="flex items-center gap-3 text-sm text-ink/90">
              <span className="text-gold" aria-hidden="true">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-3 font-display text-lg font-extrabold uppercase leading-tight text-gold">{WELCOME.builds}</p>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-base text-ink">{WELCOME.nameQuestion}</span>
        <input
          type="text"
          aria-label={WELCOME.nameLabel}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          className="rounded-lg border border-line bg-card px-4 py-3.5 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none"
        />
      </label>
    </FirstRunShell>
  );
}
