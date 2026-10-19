/**
 * SPORT-RACE-01P (HPM 2026-10-19, option P) — the pre-event days of a race follow its protocol in the plan
 * (RACE_PROTOCOL_PLAN_POLICY_V2, PROVISIONAL). Runs after the shared pipeline, on the planned weeks:
 *
 * 1. a DH session the week template put on a protocol day of another kind (e.g. T-7 « upper-body Force ») moves to the
 *    protocol's DH day (T-6) when that day is free and has a riding slot long enough — so M1's T-X keeps it instead of
 *    replacing it;
 * 2. a session on a protocol REST day (or IXS T-1, the official activity) is removed: the protocol rests that day
 *    (SPORT-RACE-01P.2 AR-C: the rest is kept, the session is never moved to another day without an approved rule);
 * 3. a session of another kind on a protocol day whose own session that day's slots cannot host (T-7 Force on a
 *    riding-only day, T-6 DH without a riding slot) is removed: M1 would replace it by a session the day cannot host
 *    (AR-A: M1 is never bypassed, no session on an incompatible day); otherwise it stays (M1 decides that day);
 * 4. on a free protocol day the plan places the entry when it has a V2 model and an existing dose (T-7 Force upper
 *    LIGHT 45, T-6 DH LIGHT 60 / 4 passes, T-4 and T-3 active recovery), on a slot of the right activity only.
 * A removed session is identifiable: a `placement_shortfall` relaxed constraint of the plan version (its domain, its
 * date, reason `race_protocol_rest_day` or `race_protocol_incompatible_day`), shown in the programme review.
 *
 * Only A+, A and B races with a format that has a protocol (A09: a C race never shapes the plan); a format without a
 * protocol (or none) gets nothing. Never on a race day or the two days after a race (M1: race activity, post-event
 * recovery), never on a locked or unavailable date, never a second session on a day. Day-based (T-7 … T-1), so the
 * window can span the taper and the race weeks. Every changed week is traced (reason, policy, phrase).
 */
import type { OrchestratedSession, OrchestratedWeek } from "../../pipeline/planningPipelineOrchestrator.js";
import { availabilityByDate } from "../../pipeline/availabilityActivity.js";
import type { PlanInputAvailability, PlanInputLockedDate } from "../../types/planInputSnapshot.js";
import type { SessionDoseTarget } from "../../types/generatedSession.js";
import type { RelaxedConstraint } from "../../types/planVersion.js";
import { PLAN_ROLE_DOSES_V2 } from "../../catalog/planDosePolicyV2.js";
import {
  RACE_PROTOCOL_PLAN_POLICY_V2,
  RACE_PROTOCOL_PLAN_POLICY_V2_VERSION,
  RACE_PROTOCOL_TABLES_V2,
  isRaceProtocolFormatV2,
} from "../../catalog/raceProtocolPlanPolicyV2.js";
import { recoveryActiveDurationRangeV2 } from "../builders/recoveryActivePrescriptionV2.js";
import type { PlanInputRaceV2 } from "../planInputSnapshotV2.js";
import { BLOCK_PROGRESSION_PHRASES_V2 } from "./blockProgressionV2.js";

export interface RaceProtocolPlacementInputV2 {
  races: readonly PlanInputRaceV2[];
  availability: PlanInputAvailability;
  lockedDates: readonly PlanInputLockedDate[];
}

type Domain = "strength" | "dh_technical" | "aerobic" | "recovery";

/** SPORT-RACE-01P.2 — why a template session left the plan (the version's relaxed constraints). */
export type RaceProtocolRemovalReasonV2 = "race_protocol_rest_day" | "race_protocol_incompatible_day";

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function domainOf(session: OrchestratedSession): Domain {
  if (session.kind === "RECOVERY_ACTIVE") return "recovery";
  return session.domain as Domain;
}

export function placeRaceProtocolSessionsV2(weeks: readonly OrchestratedWeek[], input: RaceProtocolPlacementInputV2): OrchestratedWeek[] {
  const protocolRaces = input.races
    .filter((race) => race.priority !== "C" && isRaceProtocolFormatV2(race.raceFormat))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (protocolRaces.length === 0 || weeks.length === 0) return [...weeks];

  const horizonStart = weeks[0]!.startDate;
  const horizonEnd = weeks[weeks.length - 1]!.endDate;
  // Race days and the two days after any race (C races included: M1 reads them live).
  const blocked = new Set<string>();
  for (const race of input.races) {
    for (let d = race.startDate; d <= race.endDate; d = addDays(d, 1)) blocked.add(d);
    blocked.add(addDays(race.endDate, 1));
    blocked.add(addDays(race.endDate, 2));
  }

  const sessions = weeks.map((week) => [...week.sessions]);
  const deltas = weeks.map(() => ({ changed: false, strength: 0, dh: 0, aerobic: 0, sessions: 0, minutes: 0, physicalMinutes: 0, ridingMinutes: 0 }));
  const removals = weeks.map((): RelaxedConstraint[] => []);
  const weekIndexOf = (date: string) => weeks.findIndex((w) => w.startDate <= date && date <= w.endDate);
  const sessionOn = (date: string) => {
    const i = weekIndexOf(date);
    return i < 0 ? undefined : sessions[i]!.find((s) => s.date === date);
  };
  const count = (i: number, session: OrchestratedSession, sign: 1 | -1) => {
    const delta = deltas[i]!;
    const domain = domainOf(session);
    delta.changed = true;
    delta.sessions += sign;
    delta.minutes += sign * session.durationMin;
    if (domain === "strength") {
      delta.strength += sign;
      delta.physicalMinutes += sign * session.durationMin;
    } else if (domain === "dh_technical") {
      delta.dh += sign;
      delta.ridingMinutes += sign * session.durationMin;
    } else if (domain === "aerobic") {
      delta.aerobic += sign;
      delta.physicalMinutes += sign * session.durationMin;
    }
  };
  const remove = (session: OrchestratedSession, reason?: RaceProtocolRemovalReasonV2) => {
    const i = weekIndexOf(session.date);
    sessions[i] = sessions[i]!.filter((s) => s !== session);
    count(i, session, -1);
    if (reason !== undefined) removals[i]!.push({ constraintId: "placement_shortfall", reason, domain: session.domain, date: session.date });
  };
  const add = (session: OrchestratedSession) => {
    const i = weekIndexOf(session.date);
    sessions[i] = [...sessions[i]!, session].sort((a, b) => a.date.localeCompare(b.date));
    count(i, session, 1);
  };
  const capacity = (date: string) => availabilityByDate([date], input.availability, input.lockedDates)[0]!;
  // null = an exceptional availability without a window: the day is open.
  const fits = (minutes: number | null | undefined, needed: number) => minutes === null || (typeof minutes === "number" && minutes >= needed);
  const usable = (date: string) => date >= horizonStart && date <= horizonEnd && !blocked.has(date);
  // The activity the protocol's own session needs that day (endurance and recovery fit any slot).
  const hosts = (kind: string, date: string) => {
    const slots = capacity(date);
    if (kind === "DH_TECHNICAL") return fits(slots.riding, 1);
    if (kind === "STRENGTH_UPPER" || kind === "STRENGTH_LOWER") return fits(slots.physical, 1);
    return fits(slots.physical, 1) || fits(slots.riding, 1);
  };
  const phrase = BLOCK_PROGRESSION_PHRASES_V2.race_protocol_sessions;
  const rationaleOf = (date: string) => `${weeks[weekIndexOf(date)]!.rationale} ${phrase}`;

  const taper = PLAN_ROLE_DOSES_V2.taper;
  const strengthDoseTarget: SessionDoseTarget | undefined = weeks.flatMap((w) => w.sessions).find((s) => s.doseTarget.domain === "strength")?.doseTarget;
  const planHasDh = weeks.some((w) => w.sessions.some((s) => s.kind === "DH_TECHNICAL"));
  const recoveryMin = recoveryActiveDurationRangeV2().min;

  for (const race of protocolRaces) {
    const table = RACE_PROTOCOL_TABLES_V2[race.raceFormat as keyof typeof RACE_PROTOCOL_TABLES_V2];
    const dayBefore = (x: number) => addDays(race.startDate, -x);
    const dhDay = dayBefore(RACE_PROTOCOL_PLAN_POLICY_V2.dhDayBefore);

    // 1–3. Template sessions on the protocol days.
    for (let x = 7; x >= 1; x--) {
      const date = dayBefore(x);
      if (!usable(date)) continue;
      const session = sessionOn(date);
      const entry = table[x];
      if (session === undefined || entry === undefined) continue;
      if (session.kind === "DH_TECHNICAL" && entry.kind !== "DH_TECHNICAL" && usable(dhDay) && sessionOn(dhDay) === undefined && fits(capacity(dhDay).riding, session.durationMin)) {
        remove(session);
        add({ ...session, date: dhDay, rationale: `${session.rationale} ${phrase}` });
        continue;
      }
      if (entry.kind === "REST" || entry.kind === "RACE_ACTIVITY") remove(session, "race_protocol_rest_day");
      else if (entry.kind !== session.kind && !hosts(entry.kind, date)) remove(session, "race_protocol_incompatible_day");
    }

    // 4. The protocol's own sessions on free days.
    for (const x of RACE_PROTOCOL_PLAN_POLICY_V2.placedDaysBefore) {
      const date = dayBefore(x);
      const entry = table[x];
      if (entry === undefined || !usable(date) || sessionOn(date) !== undefined) continue;
      const slots = capacity(date);
      if (entry.kind === "STRENGTH_UPPER" && strengthDoseTarget !== undefined && fits(slots.physical, taper.forceDurationMin)) {
        add({ date, domain: "strength", kind: "STRENGTH_UPPER", loadProfile: taper.forceLoad, durationMin: taper.forceDurationMin, doseTarget: strengthDoseTarget, rationale: rationaleOf(date) });
      } else if (entry.kind === "DH_TECHNICAL" && planHasDh && fits(slots.riding, taper.dhDurationMin)) {
        add({
          date,
          domain: "dh_technical",
          kind: "DH_TECHNICAL",
          loadProfile: taper.dhLoad,
          durationMin: taper.dhDurationMin,
          doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: taper.dhFocusedPasses },
          rationale: rationaleOf(date),
        });
      } else if (entry.kind === "RECOVERY_ACTIVE" && (fits(slots.physical, recoveryMin) || fits(slots.riding, recoveryMin))) {
        // Like the PHYS-04 mobility session: a fixed-load kind outside the three planning domains.
        add({ date, domain: "strength", kind: "RECOVERY_ACTIVE", durationMin: recoveryMin, doseTarget: { domain: "recovery" }, rationale: rationaleOf(date) } as unknown as OrchestratedSession);
      }
    }
  }

  return weeks.map((week, i) => {
    const delta = deltas[i]!;
    if (!delta.changed) return week;
    const progression = week.doseSummary.progression;
    const weekSessions = sessions[i]!;
    const hasKind = (kind: string) => weekSessions.some((s) => s.kind === kind);
    return {
      ...week,
      rationale: week.rationale.includes(phrase) ? week.rationale : `${week.rationale} ${phrase}`,
      sessions: weekSessions,
      relaxedConstraints: [...week.relaxedConstraints, ...removals[i]!],
      doseSummary: {
        ...week.doseSummary,
        plannedStrengthSessionCount: week.doseSummary.plannedStrengthSessionCount + delta.strength,
        plannedDhTechnicalSessionCount: week.doseSummary.plannedDhTechnicalSessionCount + delta.dh,
        plannedAerobicSessionCount: week.doseSummary.plannedAerobicSessionCount + delta.aerobic,
        plannedRestOrRecoveryDayCount: week.doseSummary.plannedRestOrRecoveryDayCount - delta.sessions,
        totalPlannedMinutes: week.doseSummary.totalPlannedMinutes + delta.minutes,
        ...(progression !== undefined
          ? {
              progression: {
                ...progression,
                // A race week gets the taper week's targets for what the protocol placed (null = nothing of that domain).
                targets: {
                  ...progression.targets,
                  ...(hasKind("STRENGTH_UPPER") && progression.targets.forceDoseStep === null ? { forceDoseStep: "LIGHT" as const, forceDurationMin: taper.forceDurationMin } : {}),
                  ...(hasKind("DH_TECHNICAL") && progression.targets.dhPasses === null ? { dhDurationMin: taper.dhDurationMin, dhPasses: taper.dhFocusedPasses } : {}),
                },
                sessionCount: progression.sessionCount + delta.sessions,
                physicalMinutes: progression.physicalMinutes + delta.physicalMinutes,
                ridingMinutes: progression.ridingMinutes + delta.ridingMinutes,
                reasonCodes: progression.reasonCodes.includes("race_protocol_sessions") ? progression.reasonCodes : [...progression.reasonCodes, "race_protocol_sessions" as const],
                raceProtocolPolicy: RACE_PROTOCOL_PLAN_POLICY_V2_VERSION,
              },
            }
          : {}),
      },
    };
  });
}
