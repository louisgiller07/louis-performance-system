import { describe, expect, it } from "vitest";
import { allowedActivities, formatDistance, formatDuration, formFromActivity, kmToMeters, mainBlockRpe, minutesToSeconds, plannedMinutes, validateActivityForm } from "./enduranceActivity";
import { activeActivityResult } from "../results/activeResults";
import { prescriptionView } from "../../../test/guidedSessionFakeBackend";
import type { ActivityResultRow } from "../executionState";

const ENDURANCE = prescriptionView("AEROBIC_BASE");
const ALLOWED = allowedActivities(ENDURANCE)!;
const form = (over: Partial<{ activityId: string | null; minutes: string; km: string; rpe: string }> = {}) => ({ activityId: "mtb_rolling", minutes: "43", km: "", rpe: "", ...over });
const row = (id: string, extra: Partial<ActivityResultRow> = {}): ActivityResultRow => ({ id, activity_id: "mtb_rolling", duration_seconds: 2580, distance_m: null, rpe_actual: null, supersedes_id: null, occurred_at: "t", recorded_at: "t", ...extra });

describe("enduranceActivity — pure model (UX-11C.4)", () => {
  it("the allowed activities come from the prescription, in order, with their mirror labels", () => {
    expect(ALLOWED).toEqual([
      { id: "road_bike", label: "Vélo de route" },
      { id: "mtb_rolling", label: "VTT roulant" },
      { id: "home_trainer", label: "Home-trainer" },
      { id: "running", label: "Course à pied" },
    ]);
    expect(allowedActivities(prescriptionView("STRENGTH_LOWER"))).toBeNull();
  });

  it("planned duration = sum of the blocks (10 + 30 + 5); prescribed RPE of the main block", () => {
    expect(plannedMinutes(ENDURANCE)).toEqual({ min: 45, max: 45 });
    expect(mainBlockRpe(ENDURANCE)).toEqual({ min: 3, max: 4 });
  });

  it("units: minutes → seconds; km → meters rounded to the meter (no floating-point noise)", () => {
    expect(minutesToSeconds(43)).toBe(2580);
    expect(kmToMeters(18.4)).toBe(18400);
    expect(kmToMeters(1.005)).toBe(1005); // 1.005 × 1000 = 1004.9999999999999 in IEEE-754
    expect(validateActivityForm(ALLOWED, form({ km: "1.005" }))).toMatchObject({ ok: true, value: { distance_m: 1005 } });
    expect(validateActivityForm(ALLOWED, form({ km: "0" }))).toMatchObject({ ok: true, value: { distance_m: 0 } });
    expect(formatDuration(2580)).toBe("43 min");
    expect(formatDuration(2590)).toBe("43 min 10 s");
    expect(formatDistance(18400)).toBe("18,4 km");
  });

  it("validation: activity in the prescription's list; whole minutes > 0; distance ≥ 0 with ≤ 3 decimals; RPE 1–10 with ≤ 1 decimal; never coerced", () => {
    expect(validateActivityForm(ALLOWED, form())).toEqual({ ok: true, value: { activity_id: "mtb_rolling", duration_seconds: 2580, distance_m: null, rpe_actual: null } });
    expect(validateActivityForm(ALLOWED, form({ activityId: null })).ok).toBe(false);
    expect(validateActivityForm(ALLOWED, form({ activityId: "swimming" })).ok).toBe(false);
    for (const minutes of ["", "0", "-5", "4.5", "1e3", " ", "Infinity", "NaN"]) expect(validateActivityForm(ALLOWED, form({ minutes })).ok, minutes).toBe(false);
    for (const km of ["-1", "1.2345", "abc", "Infinity", "1e2"]) expect(validateActivityForm(ALLOWED, form({ km })).ok, km).toBe(false);
    for (const rpe of ["0", "11", "7.25", "NaN", "abc"]) expect(validateActivityForm(ALLOWED, form({ rpe })).ok, rpe).toBe(false);
    expect(validateActivityForm(ALLOWED, form({ rpe: "7,5" }))).toMatchObject({ ok: true, value: { rpe_actual: 7.5 } });
  });

  it("correction prefill: recorded values back as entry values; a non-whole-minute duration is left to re-enter (never rounded silently)", () => {
    expect(formFromActivity(row("a", { distance_m: 18400, rpe_actual: 4 }))).toEqual({ activityId: "mtb_rolling", minutes: "43", km: "18.4", rpe: "4" });
    expect(formFromActivity(row("a", { duration_seconds: 2590 })).minutes).toBe("");
  });

  it("one active activity per execution: the correction when there is one; two active rows fail closed", () => {
    expect(activeActivityResult([])).toBeNull();
    expect(activeActivityResult([row("a"), row("b", { supersedes_id: "a" })])?.id).toBe("b");
    expect(() => activeActivityResult([row("a"), row("b")])).toThrow(/several active results/);
  });
});
