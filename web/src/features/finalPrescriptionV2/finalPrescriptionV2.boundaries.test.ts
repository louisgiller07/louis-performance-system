import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UX-11A.5c.4 — the V2 final prescription feature is read only and stays
// inside the web boundary: no engine import at runtime, no execution path.
const DIR = dirname(fileURLToPath(import.meta.url));
const appFiles = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

describe("finalPrescriptionV2 feature boundaries", () => {
  it("app files never import engine sources (the texts are a generated mirror)", () => {
    for (const f of appFiles) expect(readFileSync(join(DIR, f), "utf8"), f).not.toMatch(/from\s+"[./]*(planning-engine|head-coach-engine|prescription-engine)/);
  });

  it("read only: no execution call, no execution table, no input or action", () => {
    for (const f of appFiles) {
      const text = readFileSync(join(DIR, f), "utf8");
      expect(text, f).not.toMatch(/record_session_execution|session-execution|session_executions|exercise_set_results|execution_events/);
      expect(text, f).not.toMatch(/<button|<input|<form|onClick|\.insert\(|\.update\(|\.rpc\(/);
    }
  });

  it("the restore reads only decision_final_prescriptions (never the planned prescription or planned_sessions)", () => {
    const text = readFileSync(join(DIR, "finalPrescriptionV2State.ts"), "utf8");
    expect(text).toMatch(/from\("decision_final_prescriptions"\)/);
    const tables = [...text.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(tables).toEqual(["decision_final_prescriptions"]);
  });
});
