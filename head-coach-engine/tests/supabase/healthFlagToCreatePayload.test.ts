import { describe, it, expect } from "vitest";
import { mapHealthFlagToCreatePayload } from "../../src/supabase/mapping/healthFlagToCreatePayload.js";
import type { HealthFlagToCreate } from "../../src/types/index.js";

describe("M2 write path — mapHealthFlagToCreatePayload", () => {
  it("maps type to flag_type exactly", () => {
    const flag: HealthFlagToCreate = { type: "concussion_suspect", reason: "Suspicion de commotion" };

    const payload = mapHealthFlagToCreatePayload(flag, "2026-08-16");

    expect(payload.flag_type).toBe("concussion_suspect");
  });

  it("maps reason to description exactly", () => {
    const flag: HealthFlagToCreate = { type: "injury_suspect", reason: "Douleur nouvelle sévère (7/10)" };

    const payload = mapHealthFlagToCreatePayload(flag, "2026-08-16");

    expect(payload.description).toBe("Douleur nouvelle sévère (7/10)");
  });

  it("maps the run date to flag_date exactly", () => {
    const flag: HealthFlagToCreate = { type: "illness", reason: "Fièvre déclarée" };

    const payload = mapHealthFlagToCreatePayload(flag, "2026-09-01");

    expect(payload.flag_date).toBe("2026-09-01");
  });

  it("produces exactly the three documented fields — no additional DB field invented", () => {
    const flag: HealthFlagToCreate = { type: "pain_persistent", reason: "Douleur persistante" };

    const payload = mapHealthFlagToCreatePayload(flag, "2026-08-16");

    expect(Object.keys(payload).sort()).toEqual(["description", "flag_date", "flag_type"]);
  });
});
