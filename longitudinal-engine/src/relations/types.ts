/**
 * Shared decision/execution-relationship data shapes — `ExecutionSignal`
 * moved out of `calculators/types.ts` (M5_004) because M5_005's detector
 * layer consumes the exact same discriminated union. `calculators/types.ts`
 * re-exports this type verbatim for backward compatibility.
 *
 * A pure fact, exactly like types/sources.ts and calculators/types.ts's own
 * doc says: `execution.state === "same_day_session_unlinked"` is not
 * "non-adherent" — interpretation belongs to the M5_005 detector layer
 * (relations/** itself never interprets, only resolves raw relationships).
 */
import type { CompletionStatus, DbSessionType } from "../types/sources.js";

export type ExecutionSignal =
  | {
      readonly state: "explicit";
      readonly completedSessionId: string;
      readonly sessionType: DbSessionType;
      readonly completionStatus: CompletionStatus;
      readonly actualDurationMin: number | null;
      readonly rpe: number | null;
      readonly sessionLoad: number | null;
      readonly postLegFatigue: number | null;
      readonly postGripFatigue: number | null;
      readonly newPain: boolean;
    }
  | { readonly state: "no_completed_session" }
  | { readonly state: "same_day_session_unlinked" }
  | { readonly state: "same_day_session_linked_elsewhere" };
