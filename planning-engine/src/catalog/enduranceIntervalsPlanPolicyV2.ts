/**
 * PHYS-02 — where a V2 plan places its intervals session (PROVISIONAL sport
 * parameter, coaching validation required).
 *
 * Outside the Session Model V2 manifest on purpose: it chooses a session
 * KIND for an aerobic slot (plan structure, like the week templates), never
 * the content of a prescription. The intervals content is the catalogue
 * protocol `endurance_intervals_3min`, unchanged (ADR UX-11A.5a.3 §5: 6 × 3
 * min at RPE 8, no 4 / 6 selector).
 *
 * Placement only when the plan is generated with the intervals option
 * (server switch, off by default): without it, plans are exactly the
 * previous ones.
 */
import type { WeekProgressionRole } from "../types/planWeek.js";

export const ENDURANCE_INTERVALS_PLAN_POLICY_V2_VERSION = "endurance-intervals-plan-v1";

export const ENDURANCE_INTERVALS_PLAN_POLICY_V2: {
  /** The week roles whose endurance session is the intervals session: the overload week of each build cycle. */
  readonly weekRoles: readonly WeekProgressionRole[];
  readonly validationStatus: "PROVISIONAL";
} = {
  weekRoles: ["build_plus"],
  validationStatus: "PROVISIONAL",
};
