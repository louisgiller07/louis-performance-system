// P0-3 (HPM 2026-10-13) — Today's entry into the guided session (see daySessionEntry.ts for which one).
import { Link } from "react-router-dom";
import type { DaySessionEntryKind } from "./daySessionEntry";
import type { SessionRealisation } from "../completion/guidedRealisation";

const GOLD_LINK =
  "ux-press flex min-h-12 items-center justify-center rounded bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-bg hover:bg-gold-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light";
const TEXT_LINK = "ux-press inline-flex min-h-12 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline";

/** PARTIAL-01 — the completed session recorded only part of its prescription (no reason is ever guessed). */
export const PARTIAL_SESSION_NOTE = "Partiellement réalisée : une partie de la séance prévue n'a pas été enregistrée.";

export function DaySessionEntryCard({ kind, realisation }: { kind: DaySessionEntryKind; realisation?: SessionRealisation }) {
  switch (kind) {
    case "resume":
      return (
        <Link to="/today/session" className={GOLD_LINK} data-testid="guided-session-resume">
          Reprendre la séance guidée
        </Link>
      );
    case "suspended":
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-red-400/60 bg-card p-4" data-testid="guided-session-suspended">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-red-400">Séance suspendue</p>
          <p className="text-sm text-ink/80">Un signal de santé suspend l'entraînement : la séance ne reprend pas. Tes résultats déjà enregistrés sont conservés.</p>
          <Link to="/today/session" className={TEXT_LINK}>
            Consulter la séance
          </Link>
        </div>
      );
    case "completed":
      // UX-11R.9 (F-5) — a guided session completed today reads as done; the guided page stays reachable read-only.
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-gold/50 bg-card p-4" data-testid="guided-session-done">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-gold">Séance terminée</p>
          {realisation === "partial" && <p className="text-sm text-ink/80">{PARTIAL_SESSION_NOTE}</p>}
          <Link to="/today/session" className={TEXT_LINK}>
            Consulter
          </Link>
        </div>
      );
    case "start":
      return (
        <Link to="/today/session" className={GOLD_LINK}>
          Ouvrir la séance guidée
        </Link>
      );
    default:
      return null;
  }
}
