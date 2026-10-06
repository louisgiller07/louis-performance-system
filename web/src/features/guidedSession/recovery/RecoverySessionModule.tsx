// A04 — guided active recovery (REPLACE → RECOVERY_ACTIVE): the prescription
// in full (very easy activity with its duration range and RPE, mobility,
// breathing) and nothing to measure. Completing it is the rider's own
// "done": no result is required, by the server either.
import { FinalPrescriptionV2Card } from "../../finalPrescriptionV2/FinalPrescriptionV2Card";
import type { FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { GuidedSessionModuleProps, ModuleCompletion } from "../sessionModules";

export const RECOVERY_COPY = {
  note: "Rien à mesurer : fais ta récupération à ton rythme, puis termine la séance.",
} as const;

export function isGuidedRecoveryPrescription(p: FinalPrescriptionV2View): boolean {
  return p.family === "recovery";
}

export function recoveryCompletion(): ModuleCompletion {
  return { canComplete: true, completionNeedsConfirmation: false, hint: "", confirmationMessage: "", pending: {} };
}

export function RecoverySessionModule({ prescription }: GuidedSessionModuleProps) {
  return (
    <div className="flex flex-col gap-3">
      <FinalPrescriptionV2Card state={{ kind: "created", prescription }} />
      <p className="text-sm text-muted" data-testid="recovery-note">
        {RECOVERY_COPY.note}
      </p>
    </div>
  );
}
