/**
 * M5_006B pattern_evidence_lifecycle_transitions schema/RPC integration
 * suite — runs against a real local Supabase stack. See testDb.ts for the
 * required SUPABASE_SECRET_KEY env var.
 *
 * Covers: table constraints (predecessor-chain × 4 malformed cases,
 * active/withdrawn shape checks, append-only), least privilege,
 * transition_pattern_evidence_lifecycle's exact behavior matrix,
 * persist_active_pattern_evidence's composite behavior, the canonical
 * T1-T6 lifecycle (including the mandatory identical-content T5
 * reactivation), controlled concurrency orderings, and the two new views.
 *
 * No afterAll athlete cleanup in this file either (see
 * patternEvidenceSchema.integration.test.ts's own comment) —
 * pattern_evidence_identities.athlete_id is ON DELETE RESTRICT by design,
 * and this suite persists evidence for every athlete it creates.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertDecision, type TestAthlete } from "./testDb.js";

const DB_CONTAINER = "supabase_db_louis-performance-system";

function runPsqlChecked(sql: string, extraArgs: readonly string[] = []): { stdout: string; stderr: string } {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extraArgs], {
    input: sql,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    throw new Error(`runPsqlChecked: failed to spawn "docker exec ... psql": ${result.error.message}\nsql:\n${sql}`);
  }
  if (result.status !== 0) {
    throw new Error(`runPsqlChecked: psql exited with status ${String(result.status)}\nstdout:\n${stdout}\nstderr:\n${stderr}\nsql:\n${sql}`);
  }
  return { stdout, stderr };
}

interface TransitionResult {
  identity_id: string | null;
  transition_id: string | null;
  transition_number: number | null;
  state: "active" | "withdrawn" | null;
  action: "transitioned" | "unchanged" | "skipped_no_prior";
}

interface ActiveResult {
  identity_id: string;
  revision_id: string;
  revision_number: number;
  evidence_action: "inserted" | "superseded" | "unchanged";
  lifecycle_action: "transitioned" | "unchanged";
  lifecycle_transition_id: string | null;
  lifecycle_transition_number: number | null;
}

describe("pattern_evidence lifecycle — integration", () => {
  let client: SupabaseClient;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;
  let decisionId: string;

  beforeAll(async () => {
    client = createTestClient();
    athleteA = await createTestAthlete(client, "Pattern Evidence Lifecycle Test Athlete A");
    athleteB = await createTestAthlete(client, "Pattern Evidence Lifecycle Test Athlete B");
    decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-10", { final_session: "STRENGTH_A" });
  }, 60_000);

  const DETECTOR_ID = "lifecycle_test_detector";
  const DETECTOR_VERSION = "1.0.0";

  function baseProvenance(athleteDecisionId = decisionId) {
    return [{ role: "evaluation_decision", source_kind: "decision", source_id: athleteDecisionId }];
  }

  async function persistActive(overrides: {
    athleteId?: string;
    evaluationKey?: string;
    evidenceKey?: string;
    eventType?: string;
    eventDate?: string;
    observedValue?: unknown;
    provenance?: unknown;
  } = {}) {
    return client.rpc("persist_active_pattern_evidence", {
      p_athlete_id: overrides.athleteId ?? athleteA.athleteId,
      p_detector_rule_id: DETECTOR_ID,
      p_detector_rule_version: DETECTOR_VERSION,
      p_evaluation_key: overrides.evaluationKey ?? `decision:${decisionId}`,
      p_evidence_key: overrides.evidenceKey ?? `decision:${decisionId}`,
      p_event_type: overrides.eventType ?? "supporting",
      p_event_date: overrides.eventDate ?? "2026-08-10",
      p_observed_value: overrides.observedValue ?? { v: 1 },
      p_provenance: overrides.provenance ?? baseProvenance(),
    });
  }

  async function transition(overrides: {
    athleteId?: string;
    evidenceKey?: string;
    targetState?: string;
    reasonCode?: string | null;
    context?: unknown;
  } = {}) {
    return client.rpc("transition_pattern_evidence_lifecycle", {
      p_athlete_id: overrides.athleteId ?? athleteA.athleteId,
      p_detector_rule_id: DETECTOR_ID,
      p_detector_rule_version: DETECTOR_VERSION,
      p_evidence_key: overrides.evidenceKey ?? `decision:${decisionId}`,
      p_target_state: overrides.targetState ?? "withdrawn",
      p_reason_code: overrides.reasonCode === undefined ? "no_evidence_reason" : overrides.reasonCode,
      p_context: overrides.context ?? { x: 1 },
    });
  }

  function freshKey(label: string) {
    return `decision:${decisionId}:${label}:${randomUUID()}`;
  }

  // ==========================================================================
  // Schema hardening
  // ==========================================================================
  describe("schema — pattern_evidence_lifecycle_transitions", () => {
    it("enum values are exactly active, withdrawn", () => {
      const { stdout } = runPsqlChecked(
        `select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.pattern_evidence_lifecycle_state'::regtype;`,
        ["-t", "-A"]
      );
      expect(stdout.trim()).toBe("active,withdrawn");
    });

    it("predecessor chain: valid supersede accepted", async () => {
      const key = freshKey("predecessor-valid");
      await persistActive({ evidenceKey: key });
      const { data, error } = await transition({ evidenceKey: key, targetState: "withdrawn" });
      expect(error).toBeNull();
      expect((data as TransitionResult).transition_number).toBe(1);
    });

    it("predecessor chain: direct malformed insert (skip-revision) is rejected", async () => {
      const key = freshKey("predecessor-skip");
      await persistActive({ evidenceKey: key });
      const identityId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${key}';`,
        ["-t", "-A"]
      ).stdout.trim();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityId}', 2, null, 'withdrawn', 'r', '{}'::jsonb);`
        )
      ).toThrow(/must specify supersedes_id/i);
    });

    it("direct malformed insert (wrong identity's predecessor) is rejected", async () => {
      const keyA = freshKey("predecessor-wrong-identity-a");
      const keyB = freshKey("predecessor-wrong-identity-b");
      await persistActive({ evidenceKey: keyA });
      await persistActive({ evidenceKey: keyB });
      const { data: transA } = await transition({ evidenceKey: keyA, targetState: "withdrawn" });
      const identityBId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${keyB}';`,
        ["-t", "-A"]
      ).stdout.trim();
      const transAId = (transA as TransitionResult).transition_id;
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityBId}', 1, '${transAId}', 'withdrawn', 'r', '{}'::jsonb);`
        )
      ).toThrow(/must have supersedes_id NULL/i);
    });

    it("direct malformed insert (nonexistent predecessor) is rejected", async () => {
      const key = freshKey("predecessor-nonexistent");
      await persistActive({ evidenceKey: key });
      const identityId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${key}';`,
        ["-t", "-A"]
      ).stdout.trim();
      const fakeId = randomUUID();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityId}', 2, '${fakeId}', 'withdrawn', 'r', '{}'::jsonb);`
        )
      ).toThrow(/does not reference an existing transition/i);
    });

    it("transition 1 with non-null supersedes_id is rejected", async () => {
      const key = freshKey("predecessor-rev1-supersedes");
      await persistActive({ evidenceKey: key });
      const identityId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${key}';`,
        ["-t", "-A"]
      ).stdout.trim();
      const fakeId = randomUUID();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityId}', 1, '${fakeId}', 'withdrawn', 'r', '{}'::jsonb);`
        )
      ).toThrow(/must have supersedes_id NULL/i);
    });

    it("active shape: reason_code must be NULL and context must be {} when state=active", async () => {
      // Fresh identities with ZERO lifecycle rows, so transition_number=1/supersedes_id=null
      // satisfies pattern_evidence_lifecycle_transitions_supersedes_consistency trivially —
      // isolating the assertion to the active_shape constraint specifically.
      const keyReason = freshKey("active-shape-reason");
      await persistActive({ evidenceKey: keyReason });
      const identityReasonId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${keyReason}';`,
        ["-t", "-A"]
      ).stdout.trim();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityReasonId}', 1, null, 'active', 'not-null', '{}'::jsonb);`
        )
      ).toThrow(/pattern_evidence_lifecycle_transitions_active_shape/i);

      const keyContext = freshKey("active-shape-context");
      await persistActive({ evidenceKey: keyContext });
      const identityContextId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${keyContext}';`,
        ["-t", "-A"]
      ).stdout.trim();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityContextId}', 1, null, 'active', null, '{"x":1}'::jsonb);`
        )
      ).toThrow(/pattern_evidence_lifecycle_transitions_active_shape/i);
    });

    it("withdrawn shape: reason_code must be non-blank, 1-128 chars", async () => {
      const key = freshKey("withdrawn-shape-reason");
      await persistActive({ evidenceKey: key });
      const identityId = runPsqlChecked(
        `select id from public.pattern_evidence_identities where athlete_id = '${athleteA.athleteId}' and detector_rule_id = '${DETECTOR_ID}' and detector_rule_version = '${DETECTOR_VERSION}' and evidence_key = '${key}';`,
        ["-t", "-A"]
      ).stdout.trim();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_evidence_lifecycle_transitions (evidence_identity_id, transition_number, supersedes_id, state, reason_code, context) values ('${identityId}', 1, null, 'withdrawn', null, '{}'::jsonb);`
        )
      ).toThrow(/pattern_evidence_lifecycle_transitions_withdrawn_shape/i);
    });

    it("append-only: UPDATE is rejected", async () => {
      const key = freshKey("appendonly-update");
      await persistActive({ evidenceKey: key });
      const { data } = await transition({ evidenceKey: key, targetState: "withdrawn" });
      const transitionId = (data as TransitionResult).transition_id;
      const { error } = await client.from("pattern_evidence_lifecycle_transitions").update({ reason_code: "hacked" }).eq("id", transitionId);
      expect(error).not.toBeNull();
    });

    it("append-only: DELETE is rejected", async () => {
      const key = freshKey("appendonly-delete");
      await persistActive({ evidenceKey: key });
      const { data } = await transition({ evidenceKey: key, targetState: "withdrawn" });
      const transitionId = (data as TransitionResult).transition_id;
      const { error } = await client.from("pattern_evidence_lifecycle_transitions").delete().eq("id", transitionId);
      expect(error).not.toBeNull();
    });

    it("least privilege: service_role has exactly SELECT and INSERT, never UPDATE/DELETE/TRUNCATE", () => {
      const out = runPsqlChecked(
        `select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='pattern_evidence_lifecycle_transitions' and grantee='service_role' order by privilege_type;`,
        ["-t", "-A"]
      );
      const privs = out.stdout.trim().split("\n").filter(Boolean).sort();
      expect(privs).toEqual(["INSERT", "SELECT"]);
    });

    it("RLS is enabled", () => {
      const out = runPsqlChecked(
        `select relrowsecurity from pg_class where oid = 'public.pattern_evidence_lifecycle_transitions'::regclass;`,
        ["-t", "-A"]
      );
      expect(out.stdout.trim()).toBe("t");
    });
  });

  // ==========================================================================
  // transition_pattern_evidence_lifecycle behavior matrix
  // ==========================================================================
  describe("transition_pattern_evidence_lifecycle — behavior matrix", () => {
    it("target withdrawn + no identity -> skipped_no_prior", async () => {
      const { data, error } = await transition({ evidenceKey: freshKey("no-identity-withdraw"), targetState: "withdrawn" });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("skipped_no_prior");
      expect(result.identity_id).toBeNull();
      expect(result.transition_id).toBeNull();
      expect(result.transition_number).toBeNull();
    });

    it("target active + no identity -> structural error", async () => {
      const { data, error } = await transition({ evidenceKey: freshKey("no-identity-activate"), targetState: "active", reasonCode: null, context: {} });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_lifecycle_no_identity/i);
    });

    it("target active + implicit active (no lifecycle rows) -> unchanged, nullable transition fields", async () => {
      const key = freshKey("implicit-active");
      await persistActive({ evidenceKey: key });
      const { data, error } = await transition({ evidenceKey: key, targetState: "active", reasonCode: null, context: {} });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("unchanged");
      expect(result.state).toBe("active");
      expect(result.transition_id).toBeNull();
      expect(result.transition_number).toBeNull();
    });

    it("target active + explicit active -> unchanged", async () => {
      const key = freshKey("explicit-active");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn" });
      const { data: reactivated } = await transition({ evidenceKey: key, targetState: "active", reasonCode: null, context: {} });
      const { data, error } = await transition({ evidenceKey: key, targetState: "active", reasonCode: null, context: {} });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("unchanged");
      expect(result.transition_id).toBe((reactivated as TransitionResult).transition_id);
    });

    it("target active + withdrawn -> insert active transition", async () => {
      const key = freshKey("active-after-withdrawn");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn" });
      const { data, error } = await transition({ evidenceKey: key, targetState: "active", reasonCode: null, context: {} });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("transitioned");
      expect(result.state).toBe("active");
      expect(result.transition_number).toBe(2);
    });

    it("target withdrawn + active -> insert withdrawn transition", async () => {
      const key = freshKey("withdrawn-after-active");
      await persistActive({ evidenceKey: key });
      const { data, error } = await transition({ evidenceKey: key, targetState: "withdrawn" });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("transitioned");
      expect(result.state).toBe("withdrawn");
      expect(result.transition_number).toBe(1);
    });

    it("target withdrawn + withdrawn, same reason_code and jsonb-equal context -> unchanged", async () => {
      const key = freshKey("withdrawn-same");
      await persistActive({ evidenceKey: key });
      const { data: first } = await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonA", context: { a: 1, b: 2 } });
      // Reordered keys — still jsonb-equal.
      const { data, error } = await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonA", context: { b: 2, a: 1 } });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("unchanged");
      expect(result.transition_id).toBe((first as TransitionResult).transition_id);
    });

    it("target withdrawn + withdrawn, changed reason_code -> insert another withdrawn transition", async () => {
      const key = freshKey("withdrawn-changed-reason");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonA", context: { a: 1 } });
      const { data, error } = await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonB", context: { a: 1 } });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("transitioned");
      expect(result.transition_number).toBe(2);
    });

    it("target withdrawn + withdrawn, changed context -> insert another withdrawn transition", async () => {
      const key = freshKey("withdrawn-changed-context");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonA", context: { a: 1 } });
      const { data, error } = await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "reasonA", context: { a: 2 } });
      expect(error).toBeNull();
      const result = data as TransitionResult;
      expect(result.action).toBe("transitioned");
      expect(result.transition_number).toBe(2);
    });

    it("cross-athlete: an identity belonging to athlete A is never visible to a call scoped to athlete B", async () => {
      const key = freshKey("cross-athlete");
      await persistActive({ evidenceKey: key });
      const { data, error } = await transition({ athleteId: athleteB.athleteId, evidenceKey: key, targetState: "withdrawn" });
      expect(error).toBeNull();
      // athlete B has no identity with this evidence_key (identity is scoped by athlete_id in its natural key) -> skipped_no_prior, never athlete A's identity.
      expect((data as TransitionResult).action).toBe("skipped_no_prior");
    });
  });

  // ==========================================================================
  // persist_active_pattern_evidence — composite behavior
  // ==========================================================================
  describe("persist_active_pattern_evidence — composite", () => {
    it("first write: evidence inserted, lifecycle unchanged (implicit active), nullable transition fields", async () => {
      const key = freshKey("composite-first");
      const { data, error } = await persistActive({ evidenceKey: key });
      expect(error).toBeNull();
      const result = data as ActiveResult;
      expect(result.evidence_action).toBe("inserted");
      expect(result.revision_number).toBe(1);
      expect(result.lifecycle_action).toBe("unchanged");
      expect(result.lifecycle_transition_id).toBeNull();
      expect(result.lifecycle_transition_number).toBeNull();
    });

    it("re-persisting identical content after a withdrawal reactivates without touching the evidence revision", async () => {
      const key = freshKey("composite-reactivate");
      await persistActive({ evidenceKey: key, observedValue: { v: 1 } });
      await transition({ evidenceKey: key, targetState: "withdrawn" });
      const { data, error } = await persistActive({ evidenceKey: key, observedValue: { v: 1 } });
      expect(error).toBeNull();
      const result = data as ActiveResult;
      expect(result.evidence_action).toBe("unchanged");
      expect(result.revision_number).toBe(1);
      expect(result.lifecycle_action).toBe("transitioned");
      expect(result.lifecycle_transition_number).toBe(2);
    });

    it("new content after a withdrawal both supersedes the revision AND reactivates in one call", async () => {
      const key = freshKey("composite-supersede-reactivate");
      await persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } });
      await transition({ evidenceKey: key, targetState: "withdrawn" });
      const { data, error } = await persistActive({ evidenceKey: key, eventType: "contradicting", observedValue: { v: 2 } });
      expect(error).toBeNull();
      const result = data as ActiveResult;
      expect(result.evidence_action).toBe("superseded");
      expect(result.revision_number).toBe(2);
      expect(result.lifecycle_action).toBe("transitioned");
      expect(result.lifecycle_transition_number).toBe(2);
    });
  });

  // ==========================================================================
  // T1-T6 canonical lifecycle — mandatory, including identical-content T5
  // ==========================================================================
  describe("canonical lifecycle T1-T6", () => {
    it("full T1-T6 sequence matches the locked spec exactly", async () => {
      const key = freshKey("t1-t6");

      // T1: supporting inserted -> revisions=1, lifecycle rows=0, effective=rev1.
      const t1 = (await persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } })).data as ActiveResult;
      expect(t1.evidence_action).toBe("inserted");
      expect(t1.revision_number).toBe(1);
      expect(t1.lifecycle_action).toBe("unchanged");
      const rev1Id = t1.revision_id;

      // T2: identical supporting -> evidence unchanged, lifecycle rows=0, effective=rev1.
      const t2 = (await persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } })).data as ActiveResult;
      expect(t2.evidence_action).toBe("unchanged");
      expect(t2.revision_number).toBe(1);
      expect(t2.lifecycle_action).toBe("unchanged");

      // T3: no_evidence -> withdrawn transition #1, revisions=1, effective=NONE.
      const t3 = (await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "no_evidence", context: {} })).data as TransitionResult;
      expect(t3.action).toBe("transitioned");
      expect(t3.transition_number).toBe(1);

      // T4: identical no_evidence -> lifecycle unchanged, rows still=1, effective=NONE.
      const t4 = (await transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "no_evidence", context: {} })).data as TransitionResult;
      expect(t4.action).toBe("unchanged");
      expect(t4.transition_number).toBe(1);

      // T5 (MANDATORY): supporting content IDENTICAL to T1 -> evidence RPC = unchanged,
      // active transition #2, revisions STILL=1, lifecycle rows=2, effective=rev1 AGAIN.
      const t5 = (await persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } })).data as ActiveResult;
      expect(t5.evidence_action).toBe("unchanged");
      expect(t5.revision_number).toBe(1);
      expect(t5.revision_id).toBe(rev1Id);
      expect(t5.lifecycle_action).toBe("transitioned");
      expect(t5.lifecycle_transition_number).toBe(2);

      // T6: contradicting -> evidence revision #2, lifecycle already active -> unchanged, effective=rev2.
      const t6 = (await persistActive({ evidenceKey: key, eventType: "contradicting", observedValue: { v: 2 } })).data as ActiveResult;
      expect(t6.evidence_action).toBe("superseded");
      expect(t6.revision_number).toBe(2);
      expect(t6.lifecycle_action).toBe("unchanged");
      expect(t6.lifecycle_transition_number).toBe(2);

      const { data: revisionCount } = await client
        .from("pattern_evidence_revisions")
        .select("id", { count: "exact", head: true })
        .eq("evidence_identity_id", t6.identity_id);
      void revisionCount;
      const { count: revCount } = await client.from("pattern_evidence_revisions").select("id", { count: "exact", head: true }).eq("evidence_identity_id", t6.identity_id);
      expect(revCount).toBe(2);

      const { count: lifecycleCount } = await client
        .from("pattern_evidence_lifecycle_transitions")
        .select("id", { count: "exact", head: true })
        .eq("evidence_identity_id", t6.identity_id);
      expect(lifecycleCount).toBe(2);

      const { data: effective } = await client.from("pattern_evidence_current_effective").select("revision_id, event_type").eq("evidence_key", key).single();
      expect((effective as { revision_id: string; event_type: string }).revision_id).toBe(t6.revision_id);
      expect((effective as { revision_id: string; event_type: string }).event_type).toBe("contradicting");
    });

    it("effective view is empty for a withdrawn-only identity", async () => {
      const key = freshKey("withdrawn-only-effective");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn" });
      const { data } = await client.from("pattern_evidence_current_effective").select("revision_id").eq("evidence_key", key);
      expect(data).toEqual([]);
    });

    it("current_state view reports lifecycle_state=active with null transition fields when no transition exists", async () => {
      const key = freshKey("state-view-implicit");
      await persistActive({ evidenceKey: key });
      const { data } = await client.from("pattern_evidence_current_state").select("lifecycle_state, lifecycle_transition_id, lifecycle_transition_number").eq("evidence_key", key).single();
      const row = data as { lifecycle_state: string; lifecycle_transition_id: string | null; lifecycle_transition_number: number | null };
      expect(row.lifecycle_state).toBe("active");
      expect(row.lifecycle_transition_id).toBeNull();
      expect(row.lifecycle_transition_number).toBeNull();
    });
  });

  // ==========================================================================
  // Controlled concurrency orderings
  // ==========================================================================
  describe("concurrency", () => {
    it("concurrent withdrawal + withdrawal (same reason/context) -> exactly one transition, no fork", async () => {
      const key = freshKey("concurrent-withdraw-withdraw");
      await persistActive({ evidenceKey: key });
      const [r1, r2] = await Promise.all([
        transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "r", context: { a: 1 } }),
        transition({ evidenceKey: key, targetState: "withdrawn", reasonCode: "r", context: { a: 1 } }),
      ]);
      const results = [r1.data as TransitionResult, r2.data as TransitionResult];
      const transitioned = results.filter((r) => r.action === "transitioned");
      const unchanged = results.filter((r) => r.action === "unchanged");
      expect(transitioned).toHaveLength(1);
      expect(unchanged).toHaveLength(1);
      expect(transitioned[0]!.transition_number).toBe(1);
      expect(unchanged[0]!.transition_id).toBe(transitioned[0]!.transition_id);

      const { count } = await client.from("pattern_evidence_lifecycle_transitions").select("id", { count: "exact", head: true }).eq("evidence_identity_id", transitioned[0]!.identity_id!);
      expect(count).toBe(1);
    });

    it("concurrent evidence/reactivation then a separate withdrawal -> dense transition numbers, no fork, final state matches serialized order", async () => {
      const key = freshKey("concurrent-evidence-then-withdraw");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn" });

      // Two concurrent reactivations racing (both target active).
      const [a1, a2] = await Promise.all([
        persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } }),
        persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 1 } }),
      ]);
      const activeResults = [a1.data as ActiveResult, a2.data as ActiveResult];
      const transitionedActive = activeResults.filter((r) => r.lifecycle_action === "transitioned");
      const unchangedActive = activeResults.filter((r) => r.lifecycle_action === "unchanged");
      expect(transitionedActive).toHaveLength(1);
      expect(unchangedActive).toHaveLength(1);
      expect(transitionedActive[0]!.lifecycle_transition_number).toBe(2);

      // Then a withdrawal — must be transition 3, superseding transition 2, never a fork.
      const w = (await transition({ evidenceKey: key, targetState: "withdrawn" })).data as TransitionResult;
      expect(w.action).toBe("transitioned");
      expect(w.transition_number).toBe(3);

      const { count } = await client.from("pattern_evidence_lifecycle_transitions").select("id", { count: "exact", head: true }).eq("evidence_identity_id", w.identity_id!);
      expect(count).toBe(3);
      const { data: rows } = await client.from("pattern_evidence_lifecycle_transitions").select("transition_number").eq("evidence_identity_id", w.identity_id!).order("transition_number");
      expect((rows as { transition_number: number }[]).map((r) => r.transition_number)).toEqual([1, 2, 3]);
    });

    it("withdrawal then concurrent evidence/reactivation -> dense numbers, no fork, no duplicate semantic transitions", async () => {
      const key = freshKey("concurrent-withdraw-then-evidence");
      await persistActive({ evidenceKey: key });
      await transition({ evidenceKey: key, targetState: "withdrawn" });

      const [a1, a2] = await Promise.all([
        persistActive({ evidenceKey: key, eventType: "supporting", observedValue: { v: 9 } }),
        transition({ evidenceKey: key, targetState: "active", reasonCode: null, context: {} }),
      ]);
      void a1;
      void a2;

      const { data: identityRow } = await client
        .from("pattern_evidence_identities")
        .select("id")
        .eq("evidence_key", key)
        .single();
      const identityId = (identityRow as { id: string }).id;

      const { data: rows } = await client.from("pattern_evidence_lifecycle_transitions").select("transition_number, state").eq("evidence_identity_id", identityId).order("transition_number");
      const numbers = (rows as { transition_number: number; state: string }[]).map((r) => r.transition_number);
      // Dense, no gaps, no forks: exactly 1..N with no repeats.
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
      // No two consecutive rows both 'active' (that would mean a redundant duplicate semantic transition was inserted rather than collapsed to unchanged).
      const states = (rows as { state: string }[]).map((r) => r.state);
      for (let i = 1; i < states.length; i++) {
        expect(!(states[i] === "active" && states[i - 1] === "active")).toBe(true);
      }
    });
  });
});
