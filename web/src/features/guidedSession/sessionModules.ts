// UX-11C.1 — contract between the guided-session shell and the per-family
// session modules. The shell knows only `canComplete` and renders `Content`;
// everything sport-specific (sets, passes, activitySelection) belongs to the
// modules of UX-11C.2+ (Force, DH, Endurance). Until then every family uses
// the read-only placeholder: the prescription, no result entry, and
// canComplete = false (completion is never forced: the backend requires the
// results, e.g. the activity of an endurance session).
import type { ComponentType } from "react";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import { ReadOnlySessionModule } from "./ReadOnlySessionModule";

export interface GuidedSessionModuleProps {
  prescription: FinalPrescriptionV2View;
  executionId: string | null;
}

export interface GuidedSessionModule {
  /** The prescription family this module handles (strength, dh_technical, endurance, …). */
  kind: string;
  /** True only once the module holds every result the backend requires to complete. */
  canComplete: boolean;
  Content: ComponentType<GuidedSessionModuleProps>;
}

export function resolveSessionModule(prescription: FinalPrescriptionV2View): GuidedSessionModule {
  return { kind: prescription.family, canComplete: false, Content: ReadOnlySessionModule };
}
