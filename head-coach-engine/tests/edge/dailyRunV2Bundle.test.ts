// UX-11A.5c.3.1 — the daily-run V2 Deno bundle runs the SAME source as Node.
// Run via `npm run test:edge` (builds dist + dist/edge/dailyRunV2.bundle.js first).
// The real Deno runtime is exercised by `npm run test:daily-run:v2:http`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePlanV2InMemory, sportFingerprint, type PlanInputSnapshotV2, type PlanSessionV2InMemory } from "planning-engine/session-model-v2";
import * as bundle from "../../dist/edge/dailyRunV2.bundle.js";
import { reconcileFinalPrescriptionV2 as nodeReconcile } from "../../src/supabase/dailyV2/reconcileFinalPrescriptionV2.js";
import type { DailyPlan } from "../../src/types/index.js";

const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};

const plan = (() => {
  let n = 0;
  const r = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
    snapshot: SNAPSHOT,
    mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  if (r.status !== "generated") throw new Error("expected a plan");
  return r.plan;
})();
const session = (kind: string) => plan.weeks.flatMap((w) => w.sessions).find((s) => s.kind === kind)!;

function input(s: PlanSessionV2InMemory) {
  const dailyPlan = {
    decision: "KEEP",
    final_session: { kind: s.kind, ...(s.loadProfile ? { load_profile: s.loadProfile } : {}), duration_min: s.durationMin },
  } as unknown as DailyPlan;
  return {
    client: {} as never,
    currentPlanVersionId: plan.planVersionId,
    decisionId: "decision-1",
    finalPrescriptionId: "final-1",
    dailyPlan,
    observation: {
      id: "ps-1",
      date: s.date,
      updatedAt: null,
      source: "generated",
      sourcePlanVersionId: plan.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      plannedSession: null,
    },
    // A04 — deterministic ids of a MODIFY / REPLACE document (each call gets a fresh, identical sequence).
    mintId: (() => {
      let n = 0;
      return () => `10000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })(),
  };
}
// Plan reads served from the in-memory plan (same rows for both runtimes); stored structures are plain JSON.
function reads(s: PlanSessionV2InMemory) {
  return {
    getGeneratedSessionOfVersion: async () => ({ id: s.generatedPlanSessionId, kind: s.kind, load_profile: s.loadProfile ?? null, duration_min: s.durationMin }),
    getPlannedPrescriptionRowOfVersion: async () => ({
      id: s.plannedPrescription.id,
      generated_plan_session_id: s.generatedPlanSessionId,
      schema_version: "v2",
      catalog_version: s.plannedPrescription.catalogVersion,
      structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)),
    }),
    getPlanInputSnapshotOfVersion: async () => ({ input_snapshot: JSON.parse(JSON.stringify(SNAPSHOT)), input_snapshot_schema_version: "v2" }),
  };
}

describe("daily-run V2 bundle — parity with the Node source", () => {
  it.each(["STRENGTH_LOWER", "DH_TECHNICAL", "AEROBIC_BASE"])("%s KEEP: same document, same preserved ids, same fingerprint", async (kind) => {
    const s = session(kind);
    const viaBundle = await bundle.reconcileFinalPrescriptionV2(input(s), reads(s));
    const viaNode = await nodeReconcile(input(s), reads(s));
    expect(viaBundle).toEqual(viaNode);
    expect(viaBundle.status).toBe("created");
    if (viaBundle.status !== "created") return;
    const ids = (p: typeof s.plannedPrescription.structure) => p.blocks.flatMap((b) => [b.blockId, ...b.items.map((i) => i.prescriptionItemId)]);
    expect(ids(viaBundle.finalPrescription.structure)).toEqual(ids(s.plannedPrescription.structure));
    expect(bundle.sportFingerprint(viaBundle.finalPrescription.structure)).toBe(sportFingerprint(s.plannedPrescription.structure));
  });

  it("A04 — MODIFY (week 2 build → LIGHT) and REPLACE (DH → Force, Force → recovery): same documents through the bundle", async () => {
    const week2 = (kind: string) => plan.weeks[1]!.sessions.find((x) => x.kind === kind)!;
    const cases = [
      { s: week2("STRENGTH_LOWER"), decision: "MODIFY", final: { kind: "STRENGTH_LOWER", load_profile: "LIGHT" } },
      { s: week2("DH_TECHNICAL"), decision: "MODIFY", final: { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 90 } },
      { s: session("DH_TECHNICAL"), decision: "REPLACE", final: { kind: "STRENGTH_UPPER", load_profile: "LIGHT" } },
      { s: session("STRENGTH_LOWER"), decision: "REPLACE", final: { kind: "RECOVERY_ACTIVE" } },
    ];
    for (const c of cases) {
      const base = input(c.s);
      const adapted = { ...base, dailyPlan: { ...base.dailyPlan, date: c.s.date, decision: c.decision, final_session: c.final } as unknown as DailyPlan };
      const viaBundle = await bundle.reconcileFinalPrescriptionV2({ ...adapted, mintId: input(c.s).mintId }, reads(c.s));
      const viaNode = await nodeReconcile({ ...adapted, mintId: input(c.s).mintId }, reads(c.s));
      expect(viaBundle.status, `${c.decision} ${c.final.kind}`).toBe("created");
      expect(viaBundle).toEqual(viaNode);
    }
  });

  it("blocked and REST outcomes are identical too", async () => {
    const s = session("STRENGTH_UPPER");
    const noLineage = { ...input(s), observation: null };
    expect(await bundle.reconcileFinalPrescriptionV2(noLineage, reads(s))).toEqual(await nodeReconcile(noLineage, reads(s)));
    const rest = { ...input(s), dailyPlan: { decision: "REST", final_session: { kind: "REST" } } as unknown as DailyPlan };
    expect(await bundle.reconcileFinalPrescriptionV2(rest, reads(s))).toEqual({ status: "none", reason: "rest" });
  });

  it("the bundle is Deno-resolvable and minimal: only node:* imports, no plan generation code (A04: session builders only)", () => {
    const text = readFileSync(new URL("../../dist/edge/dailyRunV2.bundle.js", import.meta.url), "utf8");
    const imports = [...text.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.every((spec) => spec!.startsWith("node:"))).toBe(true);
    expect(text).not.toMatch(/import\(/);
    // A04 — the daily builds MODIFY / REPLACE content with the V2 session builders; it never generates a plan.
    for (const symbol of ["generatePlanV2InMemory", "runPlanningPipeline", "PLAN_DOSE_POLICY_V2 ="]) {
      expect(text, symbol).not.toContain(symbol);
    }
    for (const symbol of ["buildFinalPrescriptionV2", "buildStrengthPrescriptionV2Content", "buildRecoveryActivePrescriptionV2Content"]) {
      expect(text, symbol).toContain(symbol);
    }
  });
});
