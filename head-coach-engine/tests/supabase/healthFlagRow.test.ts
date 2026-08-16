import { describe, it, expect } from "vitest";
import { mapHealthFlagRow, InvalidHealthFlagRowError } from "../../src/supabase/mapping/healthFlagRow.js";

describe("M2 read path — mapHealthFlagRow", () => {
  it("maps an active flag", () => {
    const flag = mapHealthFlagRow({ flag_type: "concussion_suspect", status: "active" });

    expect(flag).toEqual({ type: "concussion_suspect", status: "active" });
  });

  it("maps a monitoring flag", () => {
    const flag = mapHealthFlagRow({ flag_type: "injury_suspect", status: "monitoring" });

    expect(flag).toEqual({ type: "injury_suspect", status: "monitoring" });
  });

  it("rejects an unknown flag_type", () => {
    expect(() => mapHealthFlagRow({ flag_type: "not_a_real_type", status: "active" })).toThrow(
      InvalidHealthFlagRowError
    );
  });

  it("rejects a missing status", () => {
    expect(() => mapHealthFlagRow({ flag_type: "illness" })).toThrow(InvalidHealthFlagRowError);
  });
});
