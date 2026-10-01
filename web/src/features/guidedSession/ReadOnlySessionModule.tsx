// UX-11C.1 — placeholder session module: the prescription in read only, a
// neutral note where the result entry of UX-11C.2+ will live. No input.
import { FinalPrescriptionV2Card } from "../finalPrescriptionV2/FinalPrescriptionV2Card";
import type { GuidedSessionModuleProps } from "./sessionModules";

export function ReadOnlySessionModule({ prescription }: GuidedSessionModuleProps) {
  return (
    <div className="flex flex-col gap-3">
      <FinalPrescriptionV2Card state={{ kind: "created", prescription }} />
      <p className="text-sm text-muted" data-testid="results-placeholder">
        La saisie de tes résultats arrive bientôt dans cette séance.
      </p>
    </div>
  );
}
