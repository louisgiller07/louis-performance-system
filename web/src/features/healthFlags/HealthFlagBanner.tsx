import { HEALTH_FLAG_TYPE_LABELS, formatFlagDate } from "./healthFlagLabels";
import type { OpenHealthFlag } from "./openHealthFlagsRepo";

/**
 * V0.3_006A1 — read-only, factual Safety transparency banner. Deliberately
 * scoped to `concussion_suspect` only: that is currently the sole
 * HealthFlagType with a persistent Safety-layer follow-up consumer
 * (rules/safety.ts A5). An open illness/injury_suspect/pain_persistent flag
 * has no engine-side follow-up at all today — surfacing a generic "still
 * active" banner for those would imply a persistent lifecycle the coach
 * doesn't actually track, creating a *new* product contradiction while
 * fixing the concussion one. See docs/11_DECISION_LOG.md V0.3_006A
 * (§Illness/pain controls) — recorded as known lifecycle debt, not
 * addressed here.
 *
 * States only WHAT is active and WHEN it was declared, and is explicit that
 * NALYNT has no in-app way to close it yet — never why a given activity is
 * or isn't medically safe, and never a resolution affordance (no such
 * workflow exists; see V0.3_006A2, deferred, requires a separate
 * Safety/medical-policy decision).
 */
export function HealthFlagBanner({ flags }: { flags: OpenHealthFlag[] }) {
  const concussionFlag = flags.find((flag) => flag.type === "concussion_suspect");
  if (!concussionFlag) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-800">Suivi santé actif</p>
      <p className="mt-1 text-xs text-amber-700">
        {HEALTH_FLAG_TYPE_LABELS.concussion_suspect} signalée le {formatFlagDate(concussionFlag.flagDate)}.
      </p>
      <p className="mt-1.5 text-xs text-amber-700">Ce signal reste actif même si tu réponds « Non » aujourd'hui.</p>
      <p className="mt-1.5 text-xs text-amber-700">NALYNT ne permet pas encore de clôturer ce suivi depuis l'application.</p>
    </div>
  );
}
