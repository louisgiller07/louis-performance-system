import { useState } from "react";
import { HEALTH_FLAG_TYPE_LABELS, formatFlagDate } from "./healthFlagLabels";
import type { OpenHealthFlag } from "./openHealthFlagsRepo";
import { resolveOpenHealthFlag } from "./healthFlagResolutionClient";
import { PAIN_LOCATION_LABELS, type PainLocationCode } from "../checkin/checkinTypes";

/**
 * Safety transparency banner for every open health signal.
 *
 * V0.3_006A1 scoped it to `concussion_suspect`, the only signal then followed by the engine (A5).
 * P0-SAFE (HPM 2026-10-12): an open injury / illness / persistent-pain signal is now followed too
 * (SAFETY A7: no training while it is open), so the banner names it and offers the rider an explicit,
 * confirmed closure. Closing is a declaration (pain / symptoms gone), never a medical validation; a
 * concussion signal keeps the original wording and is never closable here (A5, V0.3_006A2 deferred).
 * States WHAT is open and WHEN it was declared — never why an activity would be medically safe.
 */
export function HealthFlagBanner({ flags, onResolved }: { flags: OpenHealthFlag[]; onResolved?: () => void }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {flags.map((flag) =>
        flag.type === "concussion_suspect" ? <ConcussionNotice key={flag.id} flag={flag} /> : <FollowUpSignal key={flag.id} flag={flag} onResolved={onResolved} />
      )}
    </div>
  );
}

function ConcussionNotice({ flag }: { flag: OpenHealthFlag }) {
  return (
    // UX-01 — same safety amber, same wording, on the dark palette (was a light amber-50 block).
    <div role="status" className="ux-enter rounded-lg border border-amber-400/60 bg-amber-950/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
        Suivi santé actif
      </p>
      <p className="mt-1.5 text-sm text-amber-100/90">
        {HEALTH_FLAG_TYPE_LABELS.concussion_suspect} signalée le {formatFlagDate(flag.flagDate)}.
      </p>
      <p className="mt-1.5 text-xs text-amber-100/80">Ce signal reste actif même si tu réponds « Non » aujourd'hui.</p>
      <p className="mt-1.5 text-xs text-amber-100/80">NALYNT ne permet pas encore de clôturer ce suivi depuis l'application.</p>
    </div>
  );
}

/** "Genou droit" from the engine's declaration sentence ("… — knee_R"); null when absent or unknown. */
export function flagLocationLabel(description: string): string | null {
  const code = description.split(" — ").at(-1)?.trim();
  return code && code in PAIN_LOCATION_LABELS ? PAIN_LOCATION_LABELS[code as PainLocationCode] : null;
}

function FollowUpSignal({ flag, onResolved }: { flag: OpenHealthFlag; onResolved?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [professionalConsulted, setProfessionalConsulted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = flagLocationLabel(flag.description);

  async function confirm() {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await resolveOpenHealthFlag(flag.id, professionalConsulted);
    setSending(false);
    if (result.ok) {
      setConfirming(false);
      onResolved?.();
    } else {
      setError(result.message);
    }
  }

  return (
    <div role="status" className="ux-enter rounded-lg border border-amber-400/60 bg-amber-950/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
        Suivi santé actif
      </p>
      <p className="mt-1.5 text-sm text-amber-100/90">
        {HEALTH_FLAG_TYPE_LABELS[flag.type]}
        {location ? ` (${location.toLowerCase()})` : ""} signalée le {formatFlagDate(flag.flagDate)}.
      </p>
      <p className="mt-1.5 text-xs text-amber-100/80">
        Ce signal reste actif même si tu réponds « Non » aujourd'hui. Tant qu'il est ouvert, NALYNT ne te propose pas d'entraînement.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="ux-press mt-3 min-h-11 rounded border border-amber-300/70 px-4 py-2 text-sm font-semibold text-amber-100 hover:border-amber-200"
        >
          Clôturer ce signal
        </button>
      ) : (
        <div className="mt-3 rounded border border-amber-300/40 p-3">
          <p className="text-sm text-amber-100">
            Clôture ce signal seulement si la douleur ou les symptômes ont disparu. NALYNT ne valide pas médicalement ta reprise : en cas de doute, consulte un
            professionnel de santé.
          </p>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-amber-100">
            <input type="checkbox" checked={professionalConsulted} onChange={(event) => setProfessionalConsulted(event.target.checked)} className="h-5 w-5" />
            J'ai consulté un professionnel de santé
          </label>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={sending}
              className="ux-press min-h-11 rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
            >
              {sending ? "Clôture…" : "Confirmer : je n'ai plus de douleur ni de symptôme"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={sending} className="ux-press min-h-11 rounded px-4 py-2 text-sm text-amber-100/90">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
