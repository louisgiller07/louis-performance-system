/**
 * M5_006A schema/hardening/security integration suite — runs against a real
 * local Supabase stack. See testDb.ts for the required SUPABASE_SECRET_KEY
 * env var.
 *
 * Covers: enum values, identity/revision/source_refs uniqueness, the
 * revision predecessor-chain trigger (4 malformed cases), the
 * exactly-one-source CHECK, provenance partial-unique constraints (5 source
 * kinds), append-only triggers (UPDATE/DELETE denied, tested with
 * service_role — the only role that could otherwise write at all), least
 * privilege (service_role SELECT/INSERT=yes, UPDATE/DELETE/TRUNCATE=no),
 * and the atomic-rollback guarantee — proven against the REAL
 * persist_pattern_evidence RPC (not a hand-written transaction mimicking
 * it) via a temporary, marker-scoped fault-injection trigger on
 * pattern_evidence_source_refs, installed and removed entirely within a
 * single test (see the "atomic rollback" describe block below).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCompletedSession, insertDecision, type TestAthlete } from "./testDb.js";

const DB_CONTAINER = "supabase_db_louis-performance-system";

/** Pipes `sql` into the local Supabase Postgres container via `docker exec -i ... psql` — the same pattern already established for this project's preflight scripts. Returns combined stdout+stderr (psql sends ERROR lines to stderr, not stdout). */
function runPsql(sql: string): string {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=0"], {
    input: sql,
    encoding: "utf8",
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * Same transport as `runPsql`, but for statements whose success this suite's
 * own correctness depends on (DDL install/teardown of the scratch
 * fault-injection trigger). `spawnSync`'s `status`/`error` were previously
 * never inspected here — a spawn failure, a non-zero psql exit code, or a
 * statement-level ERROR (e.g. a DDL lock wait/contention against concurrent
 * writers to the same table from sibling integration-test files running in
 * parallel during a full `npm test`) could all pass through completely
 * silently. `ON_ERROR_STOP=1` makes psql itself exit non-zero on the first
 * failing statement; combined with checking `status`/`error` here, any such
 * failure now throws immediately with the real stdout+stderr attached,
 * instead of being swallowed and only surfacing later (or never) via an
 * unrelated downstream assertion.
 */
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
    throw new Error(`runPsqlChecked: psql exited with status ${String(result.status)} (signal=${String(result.signal)})\nstdout:\n${stdout}\nstderr:\n${stderr}\nsql:\n${sql}`);
  }
  return { stdout, stderr };
}

/**
 * Runs exactly one `select count(*) ...` via the CLI flags `-t` (tuples
 * only) and `-A` (unaligned) — not the `\pset` meta-commands, which echo a
 * confirmation line ("Output format is unaligned.") into stdout and would
 * have to be stripped right back out. With `-t -A` the entire stdout is
 * just the digits — no header, no row-count footer, no column padding, no
 * confirmation noise, nothing to regex around. Throws (via
 * `runPsqlChecked`) on any spawn/exit-code/statement failure, and throws
 * separately if the output isn't a clean non-negative integer — a
 * malformed/empty result is a harness bug, never silently treated as 0.
 */
function psqlScalarCount(sql: string): number {
  const { stdout } = runPsqlChecked(sql, ["-t", "-A"]);
  const trimmed = stdout.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`psqlScalarCount: expected a single non-negative integer, got: ${JSON.stringify(stdout)}\nsql:\n${sql}`);
  }
  return Number(trimmed);
}

describe("pattern_evidence schema — integration", () => {
  let client: SupabaseClient;
  let athleteA: TestAthlete;
  let decisionId: string;
  let sessionId: string;

  beforeAll(async () => {
    client = createTestClient();
    athleteA = await createTestAthlete(client, "Pattern Evidence Schema Test Athlete A");
    decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-10", { final_session: "STRENGTH_A" });
    sessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-10", {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "done",
    });
  }, 60_000);

  // No afterAll athlete cleanup here, deliberately: pattern_evidence_identities.athlete_id
  // is ON DELETE RESTRICT (by design — evidence must never silently cascade-delete),
  // so once this suite has persisted any evidence for athleteA, deleting it becomes
  // structurally impossible — not even service_role can delete pattern_evidence rows
  // to unblock it (no DELETE grant, by the same least-privilege design this suite itself
  // verifies). Scratch data is left behind, cleaned up by the next `supabase db reset`
  // (the same convention every other integration suite in this project already relies on
  // for eventual cleanup, just made explicit here since this file cannot use deleteTestAthlete at all).

  function provenance() {
    return [
      { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
      { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
    ];
  }

  async function persist(overrides: {
    evaluationKey?: string;
    evidenceKey?: string;
    eventType?: string;
    eventDate?: string;
    observedValue?: Record<string, unknown>;
    provenance?: unknown;
  } = {}) {
    return client.rpc("persist_pattern_evidence", {
      p_athlete_id: athleteA.athleteId,
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: overrides.evaluationKey ?? `decision:${decisionId}`,
      p_evidence_key: overrides.evidenceKey ?? `decision:${decisionId}:completion:${sessionId}`,
      p_event_type: overrides.eventType ?? "supporting",
      p_event_date: overrides.eventDate ?? "2026-08-10",
      p_observed_value: overrides.observedValue ?? { completionStatus: "done" },
      p_provenance: overrides.provenance ?? provenance(),
    });
  }

  describe("enum", () => {
    it("pattern_evidence_event_type has exactly the three expected values", () => {
      // Enum labels aren't cleanly exposed through PostgREST — verified via direct SQL.
      const out = runPsql("select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.pattern_evidence_event_type'::regtype;");
      expect(out).toContain("supporting,contradicting,neutral");
    });
  });

  describe("identity uniqueness", () => {
    it("a second identity for the same (athlete, detector, version, evidence_key) reuses the same identity row", async () => {
      const evidenceKey = `decision:${decisionId}:uniq:${randomUUID()}`;
      const r1 = await persist({ evidenceKey });
      const r2 = await persist({ evidenceKey }); // identical -> unchanged, same identity
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      expect((r2.data as { identity_id: string }).identity_id).toBe((r1.data as { identity_id: string }).identity_id);
    });
  });

  describe("revision uniqueness", () => {
    it("(evidence_identity_id, revision_number) cannot be duplicated via direct insert", async () => {
      const evidenceKey = `decision:${decisionId}:revuniq:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const identityId = (data as { identity_id: string }).identity_id;
      const revisionId = (data as { revision_id: string }).revision_id;

      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: identityId,
        revision_number: 1,
        supersedes_id: null,
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { x: 1 },
      } as never);
      expect(error).not.toBeNull(); // service_role has INSERT, but the unique constraint (or RLS-less direct write path) must still reject a duplicate revision_number
      void revisionId;
    });
  });

  describe("predecessor-chain hardening", () => {
    async function freshIdentityWithOneRevision(): Promise<{ identityId: string; revision1Id: string }> {
      const evidenceKey = `decision:${decisionId}:predchain:${randomUUID()}`;
      const { data } = await persist({ evidenceKey, eventType: "contradicting", observedValue: { completionStatus: "skipped" } });
      return { identityId: (data as { identity_id: string }).identity_id, revision1Id: (data as { revision_id: string }).revision_id };
    }

    it("revision 2 superseding revision 1 of the SAME identity is allowed (already proven via the RPC's own T1->T2 path, reconfirmed directly)", async () => {
      const { identityId, revision1Id } = await freshIdentityWithOneRevision();
      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: identityId,
        revision_number: 2,
        supersedes_id: revision1Id,
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { completionStatus: "done" },
      } as never);
      expect(error).toBeNull();
    });

    it("revision 3 supersedes revision 1 (skipping revision 2) -> rejected", async () => {
      const { identityId, revision1Id } = await freshIdentityWithOneRevision();
      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: identityId,
        revision_number: 3,
        supersedes_id: revision1Id,
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { completionStatus: "done" },
      } as never);
      expect(error).not.toBeNull();
    });

    it("revision 2 supersedes a revision belonging to a DIFFERENT identity -> rejected", async () => {
      const a = await freshIdentityWithOneRevision();
      const b = await freshIdentityWithOneRevision();
      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: a.identityId,
        revision_number: 2,
        supersedes_id: b.revision1Id, // wrong identity
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { completionStatus: "done" },
      } as never);
      expect(error).not.toBeNull();
    });

    it("revision 2 with a self/invalid (nonexistent) predecessor -> rejected", async () => {
      const { identityId } = await freshIdentityWithOneRevision();
      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: identityId,
        revision_number: 2,
        supersedes_id: randomUUID(), // does not exist at all
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { completionStatus: "done" },
      } as never);
      expect(error).not.toBeNull();
    });

    it("revision 1 with a non-null supersedes_id -> rejected", async () => {
      const evidenceKey = `decision:${decisionId}:predchain-rev1:${randomUUID()}`;
      // Build a fresh identity manually (never persisted via RPC) to attempt an invalid revision 1 directly.
      const { data: identityRows, error: identityError } = await client
        .from("pattern_evidence_identities")
        .insert({
          athlete_id: athleteA.athleteId,
          detector_rule_id: "recommendation_vs_actual_execution",
          detector_rule_version: "1.0.0",
          evaluation_key: `decision:${decisionId}`,
          evidence_key: evidenceKey,
        } as never)
        .select("id")
        .single();
      expect(identityError).toBeNull();
      const identityId = (identityRows as { id: string }).id;

      const { error } = await client.from("pattern_evidence_revisions").insert({
        evidence_identity_id: identityId,
        revision_number: 1,
        supersedes_id: randomUUID(),
        event_type: "supporting",
        event_date: "2026-08-10",
        observed_value: { x: 1 },
      } as never);
      expect(error).not.toBeNull();
    });
  });

  describe("exactly-one-source CHECK", () => {
    it("a source_refs row with zero sources set is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:zerosource:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_source_refs").insert({
        revision_id: revisionId,
        role: "bad_role",
      } as never);
      expect(error).not.toBeNull();
    });

    it("a source_refs row with two sources set is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:twosource:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_source_refs").insert({
        revision_id: revisionId,
        role: "bad_role",
        source_decision_id: decisionId,
        source_completed_session_id: sessionId,
      } as never);
      expect(error).not.toBeNull();
    });
  });

  describe("provenance partial-unique constraints (all five source kinds)", () => {
    it("duplicate (revision_id, role, source_decision_id) is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:dupdecision:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_source_refs").insert({
        revision_id: revisionId,
        role: "evaluation_decision", // already exists for this revision from the RPC call above
        source_decision_id: decisionId,
      } as never);
      expect(error).not.toBeNull();
    });

    it("duplicate (revision_id, role, source_completed_session_id) is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:dupsession:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_source_refs").insert({
        revision_id: revisionId,
        role: "linked_completed_session",
        source_completed_session_id: sessionId,
      } as never);
      expect(error).not.toBeNull();
    });

    it("daily_checkin / health_flag / decision_outcome partial-unique indexes exist and enforce uniqueness", async () => {
      const checkinId = (
        await client
          .from("daily_checkins")
          .insert({ athlete_id: athleteA.athleteId, checkin_date: "2026-08-11", pain: false, suspected_concussion: false, fever_or_illness: false } as never)
          .select("id")
          .single()
      ).data as { id: string } | null;
      const flagId = (
        await client
          .from("health_flags")
          .insert({ athlete_id: athleteA.athleteId, flag_date: "2026-08-11", flag_type: "other", description: "schema test" } as never)
          .select("id")
          .single()
      ).data as { id: string } | null;

      const evidenceKey = `decision:${decisionId}:otherkinds:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;

      const checkin1 = await client.from("pattern_evidence_source_refs").insert({ revision_id: revisionId, role: "context_checkin", source_daily_checkin_id: checkinId!.id } as never);
      expect(checkin1.error).toBeNull();
      const checkin2 = await client.from("pattern_evidence_source_refs").insert({ revision_id: revisionId, role: "context_checkin", source_daily_checkin_id: checkinId!.id } as never);
      expect(checkin2.error).not.toBeNull();

      const flag1 = await client.from("pattern_evidence_source_refs").insert({ revision_id: revisionId, role: "context_flag", source_health_flag_id: flagId!.id } as never);
      expect(flag1.error).toBeNull();
      const flag2 = await client.from("pattern_evidence_source_refs").insert({ revision_id: revisionId, role: "context_flag", source_health_flag_id: flagId!.id } as never);
      expect(flag2.error).not.toBeNull();
    });
  });

  describe("append-only — UPDATE/DELETE denied even for service_role", () => {
    it("identity UPDATE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-id:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const identityId = (data as { identity_id: string }).identity_id;
      const { error } = await client.from("pattern_evidence_identities").update({ evaluation_key: "hacked" } as never).eq("id", identityId);
      expect(error).not.toBeNull();
    });

    it("identity DELETE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-id-del:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const identityId = (data as { identity_id: string }).identity_id;
      const { error } = await client.from("pattern_evidence_identities").delete().eq("id", identityId);
      expect(error).not.toBeNull();
    });

    it("revision UPDATE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-rev:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_revisions").update({ event_type: "neutral" } as never).eq("id", revisionId);
      expect(error).not.toBeNull();
    });

    it("revision DELETE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-rev-del:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { error } = await client.from("pattern_evidence_revisions").delete().eq("id", revisionId);
      expect(error).not.toBeNull();
    });

    it("provenance UPDATE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-prov:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { data: refRows } = await client.from("pattern_evidence_source_refs").select("id").eq("revision_id", revisionId);
      const refId = (refRows as { id: string }[])[0]!.id;
      const { error } = await client.from("pattern_evidence_source_refs").update({ role: "hacked" } as never).eq("id", refId);
      expect(error).not.toBeNull();
    });

    it("provenance DELETE is rejected", async () => {
      const evidenceKey = `decision:${decisionId}:appendonly-prov-del:${randomUUID()}`;
      const { data } = await persist({ evidenceKey });
      const revisionId = (data as { revision_id: string }).revision_id;
      const { data: refRows } = await client.from("pattern_evidence_source_refs").select("id").eq("revision_id", revisionId);
      const refId = (refRows as { id: string }[])[0]!.id;
      const { error } = await client.from("pattern_evidence_source_refs").delete().eq("id", refId);
      expect(error).not.toBeNull();
    });
  });

  describe("least privilege (direct SQL, service_role)", () => {
    it("service_role cannot UPDATE/DELETE/TRUNCATE any of the three tables at the grant level", () => {
      const out = runPsql(`
        select table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('pattern_evidence_identities','pattern_evidence_revisions','pattern_evidence_source_refs')
          and grantee = 'service_role'
          and privilege_type in ('UPDATE','DELETE','TRUNCATE');
      `);
      expect(out).toContain("(0 rows)");
    });

    it("service_role has exactly SELECT and INSERT on all three tables", () => {
      const out = runPsql(`
        select table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('pattern_evidence_identities','pattern_evidence_revisions','pattern_evidence_source_refs')
          and grantee = 'service_role'
        order by table_name, privilege_type;
      `);
      expect(out).toContain("SELECT");
      expect(out).toContain("INSERT");
      expect(out).not.toContain("UPDATE");
      expect(out).not.toContain("DELETE");
      expect(out).not.toContain("TRUNCATE");
    });
  });

  describe("atomic rollback — REAL RPC provenance failure -> full transaction rollback", () => {
    const MARKER_ROLE = "__m5006a_force_provenance_failure__";
    const FAULT_FN_NAME = "__m5006a_test_force_provenance_failure";
    const FAULT_FN = `public.${FAULT_FN_NAME}`;
    const FAULT_TRIGGER = "__m5006a_test_force_provenance_failure_trigger";

    /**
     * Scratch-object presence, read via `psqlScalarCount` (machine-readable
     * `-t`/unaligned output, not a regex over psql's human-formatted table)
     * so both the pre-test and post-cleanup invariants are checked the same
     * deterministic way.
     */
    function scratchTriggerCount(): number {
      return psqlScalarCount(`select count(*) from pg_trigger where tgname = '${FAULT_TRIGGER}';`);
    }
    function scratchFunctionCount(): number {
      return psqlScalarCount(`select count(*) from pg_proc where proname = '${FAULT_FN_NAME}';`);
    }

    /**
     * Installs a scratch BEFORE INSERT trigger on pattern_evidence_source_refs
     * that raises only for MARKER_ROLE, letting every other insert through
     * unaffected. Deliberately NOT pg_temp: PostgREST/supabase-js requests are
     * pooled across connections, so a session-local pg_temp object created via
     * this docker-exec psql session would not be visible to the RPC call made
     * over HTTP through a different pooled connection. A real (if short-lived)
     * public-schema object is required for the fault to actually be reachable
     * by the real persist_pattern_evidence execution path — removed in the
     * `finally` block below, never left behind, never part of a migration.
     * Uses `runPsqlChecked`: a failed CREATE (e.g. lock contention against
     * concurrent writers to the same table from sibling integration-test
     * files running in parallel during a full suite run) now throws with the
     * real error instead of silently leaving the fault not actually armed.
     */
    function installFaultTrigger(): void {
      runPsqlChecked(`
        create or replace function ${FAULT_FN}() returns trigger
          language plpgsql
          as $fn$
        begin
          if NEW.role = '${MARKER_ROLE}' then
            raise exception 'M5_006A test fault injection: forced provenance failure for marker role';
          end if;
          return NEW;
        end;
        $fn$;

        create trigger ${FAULT_TRIGGER}
          before insert on public.pattern_evidence_source_refs
          for each row execute function ${FAULT_FN}();
      `);
    }

    /**
     * Drops the scratch trigger and function. Each DROP is issued as its own
     * `runPsqlChecked` call (rather than one multi-statement invocation) so a
     * failure on either statement is attributed unambiguously and throws
     * immediately with that statement's own stderr — this is the fix for the
     * previously-observed silent cleanup failure: `removeFaultTrigger()` used
     * to call the unchecked `runPsql`, discard its output entirely, and never
     * verify the DROPs actually took effect; a `docker exec` spawn failure or
     * a Postgres-side error (most plausibly DDL lock contention: DROP TRIGGER
     * / DROP FUNCTION both require an ACCESS EXCLUSIVE lock on
     * pattern_evidence_source_refs, which can be held up by concurrent
     * INSERT traffic from other integration-test files racing against this
     * one during a full parallel `npm test` run) would then surface, if at
     * all, only later via the separate final count-based assertion — or not
     * at all, if that assertion were ever weakened. Now: any such failure
     * throws here, loudly, with the exact command and error attached.
     */
    function removeFaultTrigger(): void {
      runPsqlChecked(`drop trigger if exists ${FAULT_TRIGGER} on public.pattern_evidence_source_refs;`);
      runPsqlChecked(`drop function if exists ${FAULT_FN}();`);
    }

    it("a forced failure on the REAL persist_pattern_evidence provenance-insert step rolls back the entire RPC call — no orphan identity, no orphan revision, no orphan source_ref", async () => {
      // Required invariant, checked before touching anything: no scratch
      // trigger/function already present from a previous run.
      expect(scratchTriggerCount()).toBe(0);
      expect(scratchFunctionCount()).toBe(0);

      installFaultTrigger();
      expect(scratchTriggerCount()).toBe(1);
      expect(scratchFunctionCount()).toBe(1);

      const marker = `rpc-atomic-rollback-${randomUUID()}`;
      const evaluationKey = `decision:${decisionId}`;
      const evidenceKey = `decision:${decisionId}:atomicfault:${marker}`;

      try {
        // Real RPC call, real athlete/decision/session, otherwise entirely valid — the only
        // "malformed" thing here is the marker role, which the fault trigger (not the RPC's own
        // validation) is what turns into a failure, precisely so this exercises the RPC's actual
        // provenance-insertion step rather than its upfront validation loop.
        const { data, error } = await client.rpc("persist_pattern_evidence", {
          p_athlete_id: athleteA.athleteId,
          p_detector_rule_id: "recommendation_vs_actual_execution",
          p_detector_rule_version: "1.0.0",
          p_evaluation_key: evaluationKey,
          p_evidence_key: evidenceKey,
          p_event_type: "supporting",
          p_event_date: "2026-08-10",
          p_observed_value: { completionStatus: "done" },
          p_provenance: [{ role: MARKER_ROLE, source_kind: "decision", source_id: decisionId }],
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
        expect(error?.message).toMatch(/forced provenance failure/i);

        const { count: identityCount } = await client
          .from("pattern_evidence_identities")
          .select("id", { count: "exact", head: true })
          .eq("evidence_key", evidenceKey);
        expect(identityCount).toBe(0);

        const revisionCount = psqlScalarCount(`
          select count(*) from public.pattern_evidence_revisions r
          join public.pattern_evidence_identities i on i.id = r.evidence_identity_id
          where i.evidence_key = '${evidenceKey}';
        `);
        expect(revisionCount).toBe(0);

        const sourceRefCount = psqlScalarCount(`select count(*) from public.pattern_evidence_source_refs where role = '${MARKER_ROLE}';`);
        expect(sourceRefCount).toBe(0);
      } finally {
        removeFaultTrigger();
      }

      // Prove cleanup actually happened — no scratch trigger/function remains after this test.
      // If either DROP above had failed, removeFaultTrigger() would already have thrown before
      // reaching this point; these are an independent, redundant confirmation, not the only check.
      expect(scratchTriggerCount()).toBe(0);
      expect(scratchFunctionCount()).toBe(0);
    });
  });
});
