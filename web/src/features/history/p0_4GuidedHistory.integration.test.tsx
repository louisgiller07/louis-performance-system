/**
 * P0-4 (HPM 2026-10-13) — History's detail on the real local Supabase (opt-in, local only): a guided Force session
 * recorded through the real record_session_execution (head-coach test helpers, test-only cross import), then the
 * REAL HistoryDetailPage rendered with the web repositories signed in as the rider (RLS): the completed status and
 * the recorded sets are shown, never "Pas de séance enregistrée". Signed in as another rider: the decision is not
 * found and none of the first rider's executions, results or prescription is readable.
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

type Item = { kind: string; prescriptionItemId: string; name?: string; sets?: number; measure: { type: string } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[] };

describe.skipIf(!INTEGRATION_ENABLED)("P0-4 — History detail of a guided V2 session (real local Supabase, RLS)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let Page: typeof import("../../pages/HistoryDetailPage").HistoryDetailPage;
  let executions: typeof import("../guidedSession/executionRepo");
  let history: typeof import("./historyRepo");
  const a = { athleteId: "", userId: "", decisionId: "", fpId: "", day: "", itemName: "" };
  const b = { athleteId: "", userId: "" };

  async function signInAs(userId: string) {
    await userClient.auth.signOut();
    const { data: user } = await admin.auth.admin.getUserById(userId);
    const password = `P04${randomUUID().replace(/-/g, "").slice(0, 16)}aA1!`;
    await admin.auth.admin.updateUserById(userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  }

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    ({ HistoryDetailPage: Page } = await import("../../pages/HistoryDetailPage"));
    executions = await import("../guidedSession/executionRepo");
    history = await import("./historyRepo");

    const athlete = await createTestAthlete(admin, "P0-4 history A");
    Object.assign(a, athlete);
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
    a.day = (rows as { planned_date: string; intervention: { kind: string } | null }[]).find((r) => r.intervention?.kind === "STRENGTH_LOWER" || r.intervention?.kind === "STRENGTH_UPPER")!.planned_date;
    await insertCheckin(admin, a.athleteId, a.day);
    const run = await runDailyFor(admin, a.athleteId, a.day);
    a.decisionId = run.persistence.decision_id;
    const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", a.decisionId).single();
    const structure = (fp as { id: string; structure: Structure }).structure;
    a.fpId = (fp as { id: string }).id;
    const item = structure.blocks.find((bl) => bl.role === "main")!.items.find((i) => i.kind === "exercise")!;
    a.itemName = item.name ?? "";
    const id = randomUUID();
    const rpc = async (payload: unknown) => (await admin.rpc("record_session_execution", { p_athlete_id: a.athleteId, p_payload: payload })).data as { status: string };
    expect(await rpc({ execution: { id, session_date: a.day, started_at: `${a.day}T17:00:00Z`, final_prescription_id: a.fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${a.day}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
    const set = (n: number) => ({ id: randomUUID(), execution_id: id, prescription_item_id: item.prescriptionItemId, set_number: n, done: true, measure_type: item.measure.type, measure_value: 8, load_kg: 20, rpe_actual: 7, occurred_at: `${a.day}T17:1${n}:00Z` });
    expect(await rpc({ sets: [set(1), set(2)], events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${a.day}T18:00:00Z` }] })).toMatchObject({ status: "ok" });

    Object.assign(b, await createTestAthlete(admin, "P0-4 history B"));
  }, 120_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the rider: the real detail page shows the completed guided session and its recorded sets", async () => {
    await signInAs(a.userId);
    auth.athleteId = a.athleteId;
    render(
      <MemoryRouter initialEntries={[`/history/${a.decisionId}`]}>
        <Routes>
          <Route path="/history/:decisionId" element={<Page />} />
        </Routes>
      </MemoryRouter>
    );
    // PARTIAL-01 — 2 sets of one exercise recorded out of the whole prescription: partial, never « terminée » alone.
    expect(await screen.findByTestId("history-guided-status", {}, { timeout: 15_000 })).toHaveTextContent("◐ Séance guidée partiellement réalisée");
    expect(screen.getAllByText(/^Réalisé : 8 répétitions/)).toHaveLength(2);
    expect(screen.getAllByText(a.itemName).length).toBeGreaterThan(0);
    expect(screen.queryByText("Pas de séance enregistrée.")).toBeNull();
  }, 30_000);

  it("another rider (RLS): the decision is not found, and none of the first rider's executions or prescription is readable", async () => {
    await signInAs(b.userId);
    expect(await history.loadDecisionById(b.athleteId, a.decisionId)).toBeNull();
    expect(await executions.loadDayExecutions(a.athleteId, a.day)).toEqual([]);
    expect(await executions.loadExecutionPrescription(a.fpId)).toEqual({ kind: "final_prescription_missing" });
  }, 30_000);
});
