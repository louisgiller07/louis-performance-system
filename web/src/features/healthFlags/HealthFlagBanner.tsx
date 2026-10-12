import { useEffect, useState } from "react";
import { HEALTH_FLAG_TYPE_LABELS, formatFlagDate } from "./healthFlagLabels";
import type { OpenHealthFlag } from "./openHealthFlagsRepo";
import { inspectOpenHealthFlag, resolveOpenHealthFlag, type HealthFlagRequirements } from "./healthFlagResolutionClient";
import { PAIN_LOCATION_LABELS, type PainLocationCode } from "../checkin/checkinTypes";

/**
 * Safety transparency banner for every open health signal.
 *
 * V0.3_006A1 scoped it to `concussion_suspect`, the only signal then followed by the engine (A5).
 * P0-SAFE (HPM 2026-10-12): an open injury / illness / persistent-pain signal is followed too (SAFETY A7:
 * NALYNT suspends its training proposals while it is open), so the banner names it — every zone it groups —
 * and offers an explicit closure under the HPM policy:
 * - the rider declares the pain / symptoms fully gone (never NALYNT's medical judgment);
 * - a grave signal (Safety gravity criterion) also needs the rider's attestation that a health professional
 *   authorised the return to training — a consultation alone is not a clearance;
 * - a signal grouping several zones is closed only once every zone is confirmed, never one for all.
 * A concussion signal keeps the original wording and is never closable here (A5, V0.3_006A2 deferred).
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

/** "Genou droit" for a canonical zone code; "Zone non précisée" for a signal declared without location. */
export function zoneLabel(zone: string): string {
  if (zone in PAIN_LOCATION_LABELS) return PAIN_LOCATION_LABELS[zone as PainLocationCode];
  return "Zone non précisée";
}

/** "Genou droit" from the engine's declaration sentence ("… — knee_R"); null when absent or unknown. */
export function flagLocationLabel(description: string): string | null {
  const code = description.split(" — ").at(-1)?.trim();
  return code && code in PAIN_LOCATION_LABELS ? PAIN_LOCATION_LABELS[code as PainLocationCode] : null;
}

function FollowUpSignal({ flag, onResolved }: { flag: OpenHealthFlag; onResolved?: () => void }) {
  const [requirements, setRequirements] = useState<HealthFlagRequirements | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedZones, setConfirmedZones] = useState<string[]>([]);
  const [professionalClearance, setProfessionalClearance] = useState(false);
  const [professionalConsulted, setProfessionalConsulted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    inspectOpenHealthFlag(flag.id).then((value) => {
      if (!cancelled && value) setRequirements(value);
    });
    return () => {
      cancelled = true;
    };
  }, [flag.id]);

  const zones = requirements?.zones ?? [];
  const multiZone = zones.length > 1;
  const zonesText = zones.length > 0 ? zones.map(zoneLabel).join(", ") : flagLocationLabel(flag.description);
  const clearanceRequired = requirements?.requiresProfessionalClearance === true;
  const ready = requirements !== null && (!multiZone || zones.every((zone) => confirmedZones.includes(zone))) && (!clearanceRequired || professionalClearance);

  const toggleZone = (zone: string) => setConfirmedZones((current) => (current.includes(zone) ? current.filter((z) => z !== zone) : [...current, zone]));

  async function confirm() {
    if (sending || !ready) return;
    setSending(true);
    setError(null);
    const result = await resolveOpenHealthFlag(flag.id, { professionalConsulted, professionalClearance, confirmedZones: multiZone ? confirmedZones : [] });
    setSending(false);
    if (result.ok) {
      setConfirming(false);
      onResolved?.();
    } else {
      if (result.requirements) setRequirements(result.requirements);
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
        {zonesText ? ` (${zonesText.toLowerCase()})` : ""} signalée le {formatFlagDate(flag.flagDate)}.
      </p>
      <p className="mt-1.5 text-xs text-amber-100/80">
        Ce signal reste actif même si tu réponds « Non » aujourd'hui. Tant qu'il est ouvert, NALYNT suspend ses propositions d'entraînement.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={requirements === null}
          className="ux-press mt-3 min-h-11 rounded border border-amber-300/70 px-4 py-2 text-sm font-semibold text-amber-100 hover:border-amber-200 disabled:opacity-60"
        >
          Clôturer ce signal
        </button>
      ) : (
        <div className="mt-3 rounded border border-amber-300/40 p-3">
          <p className="text-sm text-amber-100">Clôture ce signal seulement si la douleur ou les symptômes ont entièrement disparu.</p>
          {multiZone && (
            <fieldset className="mt-3">
              <legend className="text-sm text-amber-100">Ce signal regroupe plusieurs zones. Confirme chacune :</legend>
              {zones.map((zone) => (
                <label key={zone} className="mt-2 flex min-h-11 items-center gap-3 text-sm text-amber-100">
                  <input type="checkbox" checked={confirmedZones.includes(zone)} onChange={() => toggleZone(zone)} className="h-5 w-5" />
                  {zoneLabel(zone)} : plus aucune douleur
                </label>
              ))}
            </fieldset>
          )}
          {clearanceRequired ? (
            <div className="mt-3">
              <p className="text-sm text-amber-100">
                Ce signal comportait un critère de gravité. Le clôturer demande l'autorisation de reprise d'un professionnel de santé.
              </p>
              <label className="mt-2 flex min-h-11 items-center gap-3 text-sm text-amber-100">
                <input type="checkbox" checked={professionalClearance} onChange={(event) => setProfessionalClearance(event.target.checked)} className="h-5 w-5" />
                Un professionnel de santé m'a autorisé à reprendre l'entraînement
              </label>
              <p className="mt-1 text-xs text-amber-100/80">NALYNT ne vérifie pas cette attestation et ne valide pas médicalement ta reprise.</p>
            </div>
          ) : (
            <div className="mt-3">
              <label className="flex min-h-11 items-center gap-3 text-sm text-amber-100">
                <input type="checkbox" checked={professionalConsulted} onChange={(event) => setProfessionalConsulted(event.target.checked)} className="h-5 w-5" />
                J'ai consulté un professionnel de santé
              </label>
              <p className="mt-1 text-xs text-amber-100/80">Une consultation n'est pas une autorisation de reprise. NALYNT ne valide pas médicalement ta reprise : en cas de doute, consulte un professionnel de santé.</p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={sending || !ready}
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
