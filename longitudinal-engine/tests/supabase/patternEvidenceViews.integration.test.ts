/**
 * pattern_evidence_current / _history / _current_with_provenance view
 * integration suite — proves RLS actually applies through the views (not
 * merely that security_invoker=true is set, which the preflight/schema
 * suite already checks structurally) by querying as a real authenticated
 * user, not service_role.
 *
 * Requires SUPABASE_SECRET_KEY (service_role, for setup) and
 * SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY (to sign in as the
 * authenticated test user) — get both via `npx supabase status -o env`,
 * same convention as the head-coach-engine HTTP harnesses.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCompletedSession, insertDecision, type TestAthlete } from "./testDb.js";

const LOCAL_URL = "http://127.0.0.1:54321";

class MissingAnonKeyError extends Error {
  constructor() {
    super("Set SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY to the local stack's key before running this suite — get it via `npx supabase status -o env`.");
    this.name = "MissingAnonKeyError";
  }
}

async function createAuthenticatedTestAthlete(adminClient: SupabaseClient, name: string): Promise<{ athlete: TestAthlete; authClient: SupabaseClient }> {
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) throw new MissingAnonKeyError();

  const password = randomUUID();
  const email = `pe-views-test-${randomUUID()}@example.invalid`;
  const { data: userData, error: userError } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !userData.user) throw new Error(`createAuthenticatedTestAthlete: user creation failed: ${userError?.message}`);

  const athleteId = randomUUID();
  const { error: athleteError } = await adminClient.from("athletes").insert({ id: athleteId, user_id: userData.user.id, name });
  if (athleteError) throw new Error(`createAuthenticatedTestAthlete: athlete insert failed: ${athleteError.message}`);

  const authClient = createClient(LOCAL_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createAuthenticatedTestAthlete: sign-in failed: ${signInError.message}`);

  return { athlete: { athleteId, userId: userData.user.id }, authClient };
}

describe("pattern_evidence views — integration", () => {
  let admin: SupabaseClient;
  let athleteA: TestAthlete;
  let authClientA: SupabaseClient;
  let athleteB: TestAthlete;
  let decisionId: string;
  let sessionId: string;
  let revisionId: string;

  beforeAll(async () => {
    admin = createTestClient();
    const setupA = await createAuthenticatedTestAthlete(admin, "Pattern Evidence Views Test Athlete A");
    athleteA = setupA.athlete;
    authClientA = setupA.authClient;
    const setupB = await createAuthenticatedTestAthlete(admin, "Pattern Evidence Views Test Athlete B");
    athleteB = setupB.athlete;

    decisionId = await insertDecision(admin, athleteA.athleteId, "2026-08-10", { final_session: "STRENGTH_A" });
    sessionId = await insertCompletedSession(admin, athleteA.athleteId, "2026-08-10", {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "done",
    });

    const { data: rev1 } = await admin.rpc("persist_pattern_evidence", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: `decision:${decisionId}`,
      p_evidence_key: `decision:${decisionId}:completion:${sessionId}`,
      p_event_type: "contradicting",
      p_event_date: "2026-08-10",
      p_observed_value: { completionStatus: "skipped" },
      p_provenance: [
        { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
        { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
      ],
    });
    void rev1;

    const { data: rev2 } = await admin.rpc("persist_pattern_evidence", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: `decision:${decisionId}`,
      p_evidence_key: `decision:${decisionId}:completion:${sessionId}`,
      p_event_type: "supporting",
      p_event_date: "2026-08-10",
      p_observed_value: { completionStatus: "done" },
      p_provenance: [
        { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
        { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
      ],
    });
    revisionId = (rev2 as { revision_id: string }).revision_id;
  }, 60_000);

  describe("pattern_evidence_current", () => {
    it("exactly the highest revision per identity", async () => {
      const { data, error } = await authClientA.from("pattern_evidence_current").select("*").eq("revision_id", revisionId).single();
      expect(error).toBeNull();
      expect((data as { revision_number: number }).revision_number).toBe(2);
      expect((data as { event_type: string }).event_type).toBe("supporting");
    });

    it("athlete A sees their own row, athlete B's query for it returns nothing (RLS via the view)", async () => {
      const asA = await authClientA.from("pattern_evidence_current").select("identity_id").eq("revision_id", revisionId);
      expect(asA.data).toHaveLength(1);

      const setupB = await createAuthenticatedTestAthlete(admin, "Pattern Evidence Views RLS Probe Athlete B");
      const asB = await setupB.authClient.from("pattern_evidence_current").select("identity_id").eq("revision_id", revisionId);
      expect(asB.error).toBeNull();
      expect(asB.data).toEqual([]);
      void athleteB;
    });
  });

  describe("pattern_evidence_history", () => {
    it("returns all revisions for the identity, not only the current one", async () => {
      const { data, error } = await authClientA.from("pattern_evidence_history").select("revision_number, event_type").eq("evidence_key", `decision:${decisionId}:completion:${sessionId}`);
      expect(error).toBeNull();
      const rows = data as { revision_number: number; event_type: string }[];
      expect(rows.map((r) => r.revision_number).sort()).toEqual([1, 2]);
    });
  });

  describe("pattern_evidence_current_with_provenance", () => {
    it("current revision joined with its own provenance rows", async () => {
      const { data, error } = await authClientA.from("pattern_evidence_current_with_provenance").select("revision_id, role, source_decision_id, source_completed_session_id").eq("revision_id", revisionId);
      expect(error).toBeNull();
      const rows = data as { role: string; source_decision_id: string | null; source_completed_session_id: string | null }[];
      expect(rows).toHaveLength(2);
      const roles = rows.map((r) => r.role).sort();
      expect(roles).toEqual(["evaluation_decision", "linked_completed_session"]);
    });
  });

  describe("anon has no access", () => {
    it("anon key cannot select from pattern_evidence_current", async () => {
      const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
      const anonClient = createClient(LOCAL_URL, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anonClient.from("pattern_evidence_current").select("*");
      expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
      void error; // PostgREST may report this as an empty result (RLS with no policy for anon) rather than an explicit error, depending on grant vs RLS interaction — either way, zero rows are ever visible.
    });
  });
});
