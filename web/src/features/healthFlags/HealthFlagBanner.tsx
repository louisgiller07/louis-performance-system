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
    // UX-01 — same safety amber, same wording, on the dark palette (was a light amber-50 block).
    <div role="status" className="ux-enter rounded-lg border border-amber-400/60 bg-amber-950/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
        Suivi santé actif
      </p>
      <p className="mt-1.5 text-sm text-amber-100/90">
        {HEALTH_FLAG_TYPE_LABELS.concussion_suspect} signalée le {formatFlagDate(concussionFlag.flagDate)}.
      </p>
      <p className="mt-1.5 text-xs text-amber-100/80">Ce signal reste actif même si tu réponds « Non » aujourd'hui.</p>
      <p className="mt-1.5 text-xs text-amber-100/80">NALYNT ne permet pas encore de clôturer ce suivi depuis l'application.</p>
    </div>
  );
}
