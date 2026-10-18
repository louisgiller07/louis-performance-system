/**
 * PHYS-04 — where a V2 plan places a mobility session (PROVISIONAL sport parameter, validation by a qualified
 * coach required). Outside the Session Model V2 manifest: it ADDS a session of an existing kind (MOBILITY) on a
 * free day, its content is the catalogue protocol `mobility_routine_v1`, unchanged.
 *
 * Only when the plan is generated with the mobility option (server switch, off by default): without it, plans
 * are exactly the previous ones.
 */
import type { WeekProgressionRole } from "../types/planWeek.js";

export const MOBILITY_PLAN_POLICY_V2_VERSION = "mobility-plan-v1";

export const MOBILITY_PLAN_POLICY_V2: {
  /** The week roles that receive one mobility session: the consolidation (unload) week of each build cycle. */
  readonly weekRoles: readonly WeekProgressionRole[];
  readonly validationStatus: "PROVISIONAL";
} = {
  weekRoles: ["consolidation"],
  validationStatus: "PROVISIONAL",
};
