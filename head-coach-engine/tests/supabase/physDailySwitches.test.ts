/**
 * V2-PHYS-INTEGRATION-01 (HPM 2026-10-18) — the PHYS switches of the daily run, from the Edge secrets: only the exact
 * value "true" turns one on (same parsing as the generation secrets); the performance guidance never works without
 * the PHYS daily switch; nothing set = every switch off = the production behaviour.
 */
import { describe, expect, it } from "vitest";
import { physSwitchesFromEnv, V2_PHYS_DAILY_FLAG, V2_PHYS_PERFORMANCE_GUIDANCE_FLAG } from "../../src/supabase/dailyV2/physDailySwitches.js";
import { V2_ENDURANCE_INTERVALS_FLAG, V2_MOBILITY_SESSIONS_FLAG, V2_POWER_SESSIONS_FLAG } from "../../src/generation/planningModelRollout.js";

const env = (values: Record<string, string>) => (name: string) => values[name];
const OFF = { daily: false, performanceGuidance: false, intervals: false, power: false, mobility: false };

describe("V2-PHYS-INTEGRATION-01 — physSwitchesFromEnv", () => {
  it("the secret names: the daily ones are new, the family ones are the generation secrets of PHYS-02 / 03 / 04", () => {
    expect([V2_PHYS_DAILY_FLAG, V2_PHYS_PERFORMANCE_GUIDANCE_FLAG, V2_ENDURANCE_INTERVALS_FLAG, V2_POWER_SESSIONS_FLAG, V2_MOBILITY_SESSIONS_FLAG]).toEqual([
      "NALYNT_V2_PHYS_DAILY_ENABLED",
      "NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED",
      "NALYNT_V2_ENDURANCE_INTERVALS_ENABLED",
      "NALYNT_V2_POWER_ENABLED",
      "NALYNT_V2_MOBILITY_ENABLED",
    ]);
  });

  it("nothing set → every switch off (the production behaviour)", () => {
    expect(physSwitchesFromEnv(env({}))).toEqual(OFF);
  });

  it.each(["TRUE", "True", "1", "yes", "on", " true", "true ", ""])("%j is not \"true\": off", (value) => {
    const all = Object.fromEntries([V2_PHYS_DAILY_FLAG, V2_PHYS_PERFORMANCE_GUIDANCE_FLAG, V2_ENDURANCE_INTERVALS_FLAG, V2_POWER_SESSIONS_FLAG, V2_MOBILITY_SESSIONS_FLAG].map((n) => [n, value]));
    expect(physSwitchesFromEnv(env(all))).toEqual(OFF);
  });

  it("each switch alone", () => {
    expect(physSwitchesFromEnv(env({ [V2_PHYS_DAILY_FLAG]: "true" }))).toEqual({ ...OFF, daily: true });
    expect(physSwitchesFromEnv(env({ [V2_ENDURANCE_INTERVALS_FLAG]: "true" }))).toEqual({ ...OFF, intervals: true });
    expect(physSwitchesFromEnv(env({ [V2_POWER_SESSIONS_FLAG]: "true" }))).toEqual({ ...OFF, power: true });
    expect(physSwitchesFromEnv(env({ [V2_MOBILITY_SESSIONS_FLAG]: "true" }))).toEqual({ ...OFF, mobility: true });
  });

  it("the performance guidance needs the PHYS daily switch (docs/03 §10: to stay off)", () => {
    expect(physSwitchesFromEnv(env({ [V2_PHYS_PERFORMANCE_GUIDANCE_FLAG]: "true" }))).toEqual(OFF);
    expect(physSwitchesFromEnv(env({ [V2_PHYS_DAILY_FLAG]: "true", [V2_PHYS_PERFORMANCE_GUIDANCE_FLAG]: "true" }))).toEqual({ ...OFF, daily: true, performanceGuidance: true });
  });
});
