/**
 * PARTIAL-01 (HPM 2026-10-18) — the realisation of completed guided sessions on the real local Supabase (opt-in, local
 * only): two Force sessions recorded through the real record_session_execution, one with every prescribed work set,
 * one with a single set, both completed. Signed in as the rider (RLS), the web repositories read each execution's own
 * frozen prescription and active results: « complete » for the first, « partial » for the second, and the real
 * History detail says so. Signed in as another rider: nothing of the first rider is readable.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";
import { upsertPerformanceProfileFor } from "../../../../head-coach-engine/src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../../../head-coach-engine/src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../../../head-coach-engine/src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../../../head-coach-engine/src/supabase/acceptTrainingPlanVersion.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);

const { auth } = vi.hoisted(() => ({ auth: { athleteId: "" } }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: auth.athleteId }) }));

type Item = { kind: string; prescriptionItemId: string; sets?: number; measure: { type: string } };
type Structure = { blocks: { role: string; items: Item[] }[] };
const WORK_ROLES = ["main", "complementary"];

describe.skipIf(!INTEGRATION_ENABLED)("PARTIAL-01 — realisation of completed guided sessions (real local Supabase, RLS)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let Page: typeof import("../../pages/HistoryDetailPage").HistoryDetailPage;
  let history: typeof import("../history/historyRepo");
  let realisations: typeof import("./guidedRealisationRepo");
  const a = { athleteId: "", userId: "" };
  const b = { athleteId: "", userId: "" };
  const full = { day: "", decisionId: "", executionId: "", fpId: "" };
  const part = { day: "", decisionId: "", executionId: "", fpId: "" };

  async function signInAs(userId: string) {
    await userClient.auth.signOut();
    const { data: user } = await admin.auth.admin.getUserById(userId);
    const password = `P01${randomUUID().replace(/-/g, "").slice(0, 16)}aA1!`;
    await admin.auth.admin.updateUserById(userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  }

  /** A Force session of `target.day`, completed after recording every prescribed work set, or only the first one. */
  async function recordForce(target: typeof full, every: boolean) {
    await insertCheckin(admin, a.athleteId, target.day);
    const run = await runDailyFor(admin, a.athleteId, target.day);
    target.decisionId = run.persistence.decision_id;
    const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", target.decisionId).single();
    target.fpId = (fp as { id: string }).id;
    const work = (fp as { structure: Structure }).structure.blocks.filter((bl) => WORK_ROLES.includes(bl.role)).flatMap((bl) => bl.items.filter((i) => i.kind === "exercise"));
    target.executionId = randomUUID();
    const id = target.executionId;
    const rpc = async (payload: unknown) => (await admin.rpc("record_session_execution", { p_athlete_id: a.athleteId, p_payload: payload })).data as { status: string };
    expect(await rpc({ execution: { id, session_date: target.day, started_at: `${target.day}T17:00:00Z`, final_prescription_id: target.fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${target.day}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
    const slots = work.flatMap((item) => Array.from({ length: item.sets ?? 1 }, (_, i) => ({ item, n: i + 1 })));
    expect(slots.length).toBeGreaterThan(1);
    const sets = (every ? slots : slots.slice(0, 1)).map(({ item, n }, i) => ({
      id: randomUUID(),
      execution_id: id,
      prescription_item_id: item.prescriptionItemId,
      set_number: n,
      done: true,
      measure_type: item.measure.type,
      measure_value: item.measure.type === "duration" ? 30 : 8,
      load_kg: null,
      rpe_actual: 7,
      occurred_at: `${target.day}T17:${String(10 + (i % 40)).padStart(2, "0")}:00Z`,
    }));
    expect(await rpc({ sets })).toMatchObject({ status: "ok" });
    expect(await rpc({ events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${target.day}T18:00:00Z` }] })).toMatchObject({ status: "ok" });
  }

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    ({ HistoryDetailPage: Page } = await import("../../pages/HistoryDetailPage"));
    history = await import("../history/historyRepo");
    realisations = await import("./guidedRealisationRepo");

    Object.assign(a, await createTestAthlete(admin, "PARTIAL-01 A"));
    await setAthleteDiscipline(admin, a.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, a.athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, a.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: a.athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (plan.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, a.athleteId, plan.planVersionId, "2026-10-05", "2026-10-18");
    const { data: rows } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", a.athleteId).order("planned_date");
    const forceDays = (rows as { planned_date: string; intervention: { kind: string } | null }[])
      .filter((r) => r.intervention?.kind === "STRENGTH_LOWER" || r.intervention?.kind === "STRENGTH_UPPER")
      .map((r) => r.planned_date);
    if (forceDays.length < 2) throw new Error("two Force days expected in the plan");
    full.day = forceDays[0]!;
    part.day = forceDays[1]!;
    await recordForce(full, true);
    await recordForce(part, false);

    Object.assign(b, await createTestAthlete(admin, "PARTIAL-01 B"));
  }, 180_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the rider (RLS): every work set → complete, one set → partial, read from the persisted prescription and results", async () => {
    await signInAs(a.userId);
    const executions = await history.loadExecutionsForDates(a.athleteId, [full.day, part.day]);
    const byId = new Map(executions.map((e) => [e.executionId, e]));
    expect(byId.get(full.executionId)).toMatchObject({ events: expect.arrayContaining(["completed"]), realisation: "complete" });
    expect(byId.get(part.executionId)).toMatchObject({ events: expect.arrayContaining(["completed"]), realisation: "partial" });
  }, 30_000);

  it("the real History detail: the partial session says so, the full one stays « terminée »", async () => {
    await signInAs(a.userId);
    auth.athleteId = a.athleteId;
    const detail = (decisionId: string) =>
      render(
        <MemoryRouter initialEntries={[`/history/${decisionId}`]}>
          <Routes>
            <Route path="/history/:decisionId" element={<Page />} />
          </Routes>
        </MemoryRouter>
      );
    const partial = detail(part.decisionId);
    expect(await screen.findByTestId("history-guided-status", {}, { timeout: 15_000 })).toHaveTextContent("◐ Séance guidée partiellement réalisée");
    partial.unmount();
    detail(full.decisionId);
    expect(await screen.findByTestId("history-guided-status", {}, { timeout: 15_000 })).toHaveTextContent("✓ Séance guidée terminée");
  }, 45_000);

  it("another rider (RLS): no execution, prescription or result of the first rider is readable", async () => {
    await signInAs(b.userId);
    expect(await history.loadExecutionsForDates(a.athleteId, [full.day, part.day])).toEqual([]);
    const refs = [full, part].map((t) => ({ executionId: t.executionId, finalPrescriptionId: t.fpId }));
    expect((await realisations.loadGuidedRealisations(a.athleteId, refs)).size).toBe(0);
  }, 30_000);
});
