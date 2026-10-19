/**
 * SPORT-RACE-01P (HPM 2026-10-19, option P) — where a V2 plan places the pre-event sessions of a race
 * (PROVISIONAL sport parameter, validation by a qualified coach required).
 *
 * The protocol is M1's T-X default framework (docs/04 §3, `head-coach-engine/src/rules/raceProtocol.ts`, the source
 * of truth): this table mirrors it for planning, equality locked by test. Only the formats that have a table are
 * planned; any other format (SWISS_CUP, UCI_WC, UCI_WORLDS, OTHER, no format) gets no pre-event session: its specific
 * preparation is not defined, and no generic protocol is assumed.
 *
 * The plan places an entry only when it has a V2 model and an EXISTING dose, so that M1 keeps it as is (same kind and
 * load, no duration the plan does not carry):
 * - T-7 upper-body Force, light: the taper week's Force dose (LIGHT, 45 min);
 * - T-6 DH technique: the taper week's DH dose (LIGHT, 60 min, 4 passes) — M1's MODERATE is capped to it
 *   (PLANNED_LOAD_CAP), never raised;
 * - T-4 and T-3 active recovery: the `recovery_active_v1` protocol, reserved at its declared minimum (20 min, = the
 *   T-X « court » of T-3, `recoveryActiveDurationRangeV2().min`).
 * Not placed: T-5 « endurance courte » (30 min in the protocol, no V2 endurance under 45 min), REST days and the
 * official activity of T-1 (IXS). A day keeps at most one session; a DH session the template put on a protocol day
 * of another kind moves to the protocol's DH day when that day is free and has a riding slot.
 */
import type { SessionKind, LoadProfile } from "../types/sharedVocabulary.js";

export const RACE_PROTOCOL_PLAN_POLICY_V2_VERSION = "race-protocol-plan-v1";

/** The race formats that have a pre-event T-X table (docs/04 §3). */
export type RaceProtocolFormatV2 = "HOT_TRAIL_2DAY" | "IXS_3DAY";

export interface RaceProtocolEntryV2 {
  kind: SessionKind | "REST" | "RACE_ACTIVITY";
  loadProfile?: LoadProfile;
  durationMin?: number;
}

const HOT_TRAIL_2DAY_PRE_EVENT: Readonly<Record<number, RaceProtocolEntryV2>> = {
  7: { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" },
  6: { kind: "DH_TECHNICAL", loadProfile: "MODERATE" },
  5: { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 30 },
  4: { kind: "RECOVERY_ACTIVE" },
  3: { kind: "RECOVERY_ACTIVE", durationMin: 20 },
  2: { kind: "REST" },
  1: { kind: "REST" },
};

/** M1's pre-event T-X tables, by days before the event (7 … 1). */
export const RACE_PROTOCOL_TABLES_V2: Readonly<Record<RaceProtocolFormatV2, Readonly<Record<number, RaceProtocolEntryV2>>>> = {
  HOT_TRAIL_2DAY: HOT_TRAIL_2DAY_PRE_EVENT,
  IXS_3DAY: { ...HOT_TRAIL_2DAY_PRE_EVENT, 1: { kind: "RACE_ACTIVITY" } },
};

export function isRaceProtocolFormatV2(format: string | null | undefined): format is RaceProtocolFormatV2 {
  return format === "HOT_TRAIL_2DAY" || format === "IXS_3DAY";
}

export const RACE_PROTOCOL_PLAN_POLICY_V2: {
  /** Days before the event whose protocol entry the plan places (the others stay without a planned session). */
  readonly placedDaysBefore: readonly number[];
  /** The protocol's DH day: where a template DH on another protocol day moves. */
  readonly dhDayBefore: number;
  readonly validationStatus: "PROVISIONAL";
} = {
  placedDaysBefore: [7, 6, 4, 3],
  dhDayBefore: 6,
  validationStatus: "PROVISIONAL",
};
