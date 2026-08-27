/**
 * M5_007 pattern_insight review ledger schema/RPC/views integration suite —
 * runs against a real local Supabase stack. See testDb.ts for the required
 * SUPABASE_SECRET_KEY env var, and patternEvidenceViews.integration.test.ts
 * for the SUPABASE_ANON_KEY convention this file's RLS section reuses.
 *
 * Covers: table constraints (predecessor-chain × 4 malformed cases,
 * append-only × 2 tables), least privilege/RLS, persist_pattern_insight_review's
 * exact behavior matrix (insert/unchanged/supersede × 3 causes), controlled
 * concurrency orderings, the two new views, and the RPC's own security
 * properties (SECURITY INVOKER, no FOR UPDATE, advisory lock present,
 * service_role-only EXECUTE) via direct SQL introspection.
 *
 * No afterAll athlete cleanup (see patternEvidenceSchema.integration.test.ts's
 * own comment) — pattern_insight_identities.athlete_id is ON DELETE
 * RESTRICT by design, and this suite persists reviews for every athlete it
 * creates.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, type TestAthlete } from "./testDb.js";

const DB_CONTAINER = "supabase_db_louis-performance-system";
const LOCAL_URL = "http://127.0.0.1:54321";

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

interface ReviewResult {
  identity_id: string;
  review_id: string;
  review_number: number;
  action: "inserted" | "superseded" | "unchanged";
}

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
  const email = `pi-review-test-${randomUUID()}@example.invalid`;
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

describe("pattern_insight review ledger — integration", () => {
  let client: SupabaseClient;
  let athleteA: TestAthlete;

  const DETECTOR_ID = "sleep_quality_to_same_day_energy_correlation";
  const DETECTOR_VERSION = "1.0.0";
  const INSIGHT_KIND = "sleep_energy_same_day_association";

  beforeAll(async () => {
    client = createTestClient();
    athleteA = await createTestAthlete(client, "Pattern Insight Review Test Athlete A");
  }, 60_000);

  function fakeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      insightProjectorVersion: "1.0.0",
      athleteId: athleteA.athleteId,
      insightKind: INSIGHT_KIND,
      detectorRuleId: DETECTOR_ID,
      detectorRuleVersion: DETECTOR_VERSION,
      rangeFromDate: "2026-06-01",
      rangeToDate: "2026-06-30",
      direction: "supporting",
      title: "Sommeil et énergie",
      statement: "test statement",
      caveats: ["test caveat"],
      evidenceCount: 1,
      supportingCount: 1,
      contradictingCount: 0,
      neutralCount: 0,
      directionalEvidenceCount: 1,
      supportingRatio: 1,
      contradictingRatio: 0,
      neutralRatio: 0,
      evidenceBalance: "supporting_only",
      firstEventDate: "2026-06-10",
      lastEventDate: "2026-06-10",
      sourceEvidenceRefs: [],
      ...overrides,
    };
  }

  async function persistReview(overrides: {
    athleteId?: string;
    detectorRuleId?: string;
    detectorRuleVersion?: string;
    insightKind?: string;
    decision?: string;
    candidateSnapshot?: Record<string, unknown>;
    reviewerNote?: string | null;
  } = {}) {
    return client.rpc("persist_pattern_insight_review", {
      p_athlete_id: overrides.athleteId ?? athleteA.athleteId,
      p_detector_rule_id: overrides.detectorRuleId ?? DETECTOR_ID,
      p_detector_rule_version: overrides.detectorRuleVersion ?? DETECTOR_VERSION,
      p_insight_kind: overrides.insightKind ?? INSIGHT_KIND,
      p_decision: overrides.decision ?? "accepted_as_insight",
      p_candidate_snapshot: overrides.candidateSnapshot ?? fakeSnapshot(),
      p_reviewer_note: overrides.reviewerNote === undefined ? null : overrides.reviewerNote,
    });
  }

  function freshInsightKind(label: string): string {
    return `${INSIGHT_KIND}:${label}:${randomUUID()}`;
  }

  // ==========================================================================
  // RPC behavior matrix
  // ==========================================================================
  describe("persist_pattern_insight_review — behavior matrix", () => {
    it("missing identity -> creates identity, inserts review #1, action=inserted", async () => {
      const kind = freshInsightKind("insert");
      const { data, error } = await persistReview({ insightKind: kind });
      expect(error).toBeNull();
      const result = data as ReviewResult;
      expect(result.review_number).toBe(1);
      expect(result.action).toBe("inserted");
    });

    it("identical decision + snapshot + note against the current head -> unchanged", async () => {
      const kind = freshInsightKind("unchanged");
      const snapshot = fakeSnapshot({ insightKind: kind });
      const r1 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: "same note" })).data as ReviewResult;
      const r2 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: "same note" })).data as ReviewResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.review_id).toBe(r1.review_id);
      expect(r2.review_number).toBe(1);
    });

    it("identical decision + snapshot + both-null note -> unchanged (NULL=NULL counts as same)", async () => {
      const kind = freshInsightKind("unchanged-null-note");
      const snapshot = fakeSnapshot({ insightKind: kind });
      const r1 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: null })).data as ReviewResult;
      const r2 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: null })).data as ReviewResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.review_id).toBe(r1.review_id);
    });

    it("decision change -> supersedes (review #2)", async () => {
      const kind = freshInsightKind("decision-change");
      const snapshot = fakeSnapshot({ insightKind: kind });
      await persistReview({ insightKind: kind, candidateSnapshot: snapshot, decision: "accepted_as_insight" });
      const r2 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, decision: "dismissed" })).data as ReviewResult;
      expect(r2.action).toBe("superseded");
      expect(r2.review_number).toBe(2);
    });

    it("reviewer_note change -> supersedes (review #2)", async () => {
      const kind = freshInsightKind("note-change");
      const snapshot = fakeSnapshot({ insightKind: kind });
      await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: "first note" });
      const r2 = (await persistReview({ insightKind: kind, candidateSnapshot: snapshot, reviewerNote: "second note" })).data as ReviewResult;
      expect(r2.action).toBe("superseded");
      expect(r2.review_number).toBe(2);
    });

    it("candidate_snapshot content change -> supersedes (review #2)", async () => {
      const kind = freshInsightKind("snapshot-change");
      await persistReview({ insightKind: kind, candidateSnapshot: fakeSnapshot({ insightKind: kind, rangeToDate: "2026-06-30" }) });
      const r2 = (await persistReview({ insightKind: kind, candidateSnapshot: fakeSnapshot({ insightKind: kind, rangeToDate: "2026-07-31" }) })).data as ReviewResult;
      expect(r2.action).toBe("superseded");
      expect(r2.review_number).toBe(2);
    });

    it("three consecutive changes -> a dense 1,2,3 chain, each superseding its immediate predecessor", async () => {
      const kind = freshInsightKind("chain-three");
      const r1 = (await persistReview({ insightKind: kind, decision: "needs_more_evidence" })).data as ReviewResult;
      const r2 = (await persistReview({ insightKind: kind, decision: "dismissed" })).data as ReviewResult;
      const r3 = (await persistReview({ insightKind: kind, decision: "accepted_as_insight" })).data as ReviewResult;
      expect([r1.review_number, r2.review_number, r3.review_number]).toEqual([1, 2, 3]);

      const { data: rows } = await client
        .from("pattern_insight_reviews")
        .select("review_number, supersedes_id")
        .eq("insight_identity_id", r3.identity_id)
        .order("review_number", { ascending: true });
      const typed = rows as { review_number: number; supersedes_id: string | null }[];
      expect(typed[0]!.supersedes_id).toBeNull();
      expect(typed[1]!.supersedes_id).toBe(r1.review_id);
      expect(typed[2]!.supersedes_id).toBe(r2.review_id);
    });
  });

  // ==========================================================================
  // Schema hardening
  // ==========================================================================
  describe("schema — pattern_insight_reviews", () => {
    it("enum values are exactly accepted_as_insight, dismissed, needs_more_evidence", () => {
      const { stdout } = runPsqlChecked(
        `select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.pattern_insight_review_decision'::regtype;`,
        ["-t", "-A"]
      );
      expect(stdout.trim()).toBe("accepted_as_insight,dismissed,needs_more_evidence");
    });

    it("predecessor chain: valid supersede accepted", async () => {
      const kind = freshInsightKind("predecessor-valid");
      await persistReview({ insightKind: kind, decision: "dismissed" });
      const r2 = (await persistReview({ insightKind: kind, decision: "accepted_as_insight" })).data as ReviewResult;
      expect(r2.review_number).toBe(2);
    });

    it("direct malformed insert (skip-review) is rejected", async () => {
      const kind = freshInsightKind("predecessor-skip");
      const r1 = (await persistReview({ insightKind: kind })).data as ReviewResult;
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_insight_reviews (insight_identity_id, review_number, supersedes_id, decision, candidate_snapshot) values ('${r1.identity_id}', 3, null, 'dismissed', '{}'::jsonb);`
        )
      ).toThrow(/must specify supersedes_id/i);
    });

    it("direct malformed insert (wrong identity's predecessor) is rejected", async () => {
      const kindA = freshInsightKind("predecessor-wrong-a");
      const kindB = freshInsightKind("predecessor-wrong-b");
      const rA = (await persistReview({ insightKind: kindA })).data as ReviewResult;
      const rB = (await persistReview({ insightKind: kindB })).data as ReviewResult;
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_insight_reviews (insight_identity_id, review_number, supersedes_id, decision, candidate_snapshot) values ('${rB.identity_id}', 2, '${rA.review_id}', 'dismissed', '{}'::jsonb);`
        )
      ).toThrow(/belongs to a different insight_identity_id/i);
    });

    it("direct malformed insert (nonexistent predecessor) is rejected", async () => {
      const kind = freshInsightKind("predecessor-nonexistent");
      const r1 = (await persistReview({ insightKind: kind })).data as ReviewResult;
      const fakeId = randomUUID();
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_insight_reviews (insight_identity_id, review_number, supersedes_id, decision, candidate_snapshot) values ('${r1.identity_id}', 2, '${fakeId}', 'dismissed', '{}'::jsonb);`
        )
      ).toThrow(/does not reference an existing review/i);
    });

    it("review 1 with non-null supersedes_id is rejected", async () => {
      const kind = freshInsightKind("predecessor-rev1-supersedes");
      const identityIdSetup = (await persistReview({ insightKind: kind })).data as ReviewResult;
      // Fresh identity, second natural key so a genuine "review 1" insert attempt is possible.
      const kind2 = freshInsightKind("predecessor-rev1-supersedes-2");
      const setup2 = (await persistReview({ insightKind: kind2 })).data as ReviewResult;
      void identityIdSetup;
      expect(() =>
        runPsqlChecked(
          `insert into public.pattern_insight_reviews (insight_identity_id, review_number, supersedes_id, decision, candidate_snapshot) values ('${setup2.identity_id}', 1, '${setup2.review_id}', 'dismissed', '{}'::jsonb);`
        )
      ).toThrow(/pattern_insight_reviews_supersedes_consistency|must have supersedes_id NULL/i);
    });

    it("reviewer_note shape: leading/trailing whitespace is rejected", async () => {
      const { error } = await persistReview({ insightKind: freshInsightKind("note-shape-untrimmed"), reviewerNote: "  padded  " });
      expect(error).not.toBeNull();
    });

    it("reviewer_note shape: empty string is rejected", async () => {
      const { error } = await persistReview({ insightKind: freshInsightKind("note-shape-empty"), reviewerNote: "" });
      expect(error).not.toBeNull();
    });

    it("append-only: UPDATE on pattern_insight_reviews is rejected", async () => {
      const r1 = (await persistReview({ insightKind: freshInsightKind("appendonly-update-review") })).data as ReviewResult;
      const { error } = await client.from("pattern_insight_reviews").update({ decision: "dismissed" }).eq("id", r1.review_id);
      expect(error).not.toBeNull();
    });

    it("append-only: DELETE on pattern_insight_reviews is rejected", async () => {
      const r1 = (await persistReview({ insightKind: freshInsightKind("appendonly-delete-review") })).data as ReviewResult;
      const { error } = await client.from("pattern_insight_reviews").delete().eq("id", r1.review_id);
      expect(error).not.toBeNull();
    });

    it("append-only: UPDATE on pattern_insight_identities is rejected", async () => {
      const r1 = (await persistReview({ insightKind: freshInsightKind("appendonly-update-identity") })).data as ReviewResult;
      const { error } = await client.from("pattern_insight_identities").update({ insight_kind: "hacked" }).eq("id", r1.identity_id);
      expect(error).not.toBeNull();
    });

    it("append-only: DELETE on pattern_insight_identities is rejected", async () => {
      const r1 = (await persistReview({ insightKind: freshInsightKind("appendonly-delete-identity") })).data as ReviewResult;
      const { error } = await client.from("pattern_insight_identities").delete().eq("id", r1.identity_id);
      expect(error).not.toBeNull();
    });

    it("least privilege: service_role has exactly SELECT and INSERT on both tables, never UPDATE/DELETE/TRUNCATE", () => {
      for (const table of ["pattern_insight_identities", "pattern_insight_reviews"]) {
        const out = runPsqlChecked(
          `select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee='service_role' order by privilege_type;`,
          ["-t", "-A"]
        );
        const privs = out.stdout.trim().split("\n").filter(Boolean).sort();
        expect(privs, `service_role privileges on ${table}`).toEqual(["INSERT", "SELECT"]);
      }
    });

    it("least privilege: authenticated has exactly SELECT on both tables", () => {
      for (const table of ["pattern_insight_identities", "pattern_insight_reviews"]) {
        const out = runPsqlChecked(
          `select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee='authenticated' order by privilege_type;`,
          ["-t", "-A"]
        );
        const privs = out.stdout.trim().split("\n").filter(Boolean).sort();
        expect(privs, `authenticated privileges on ${table}`).toEqual(["SELECT"]);
      }
    });

    it("least privilege: anon has zero privileges on both tables", () => {
      for (const table of ["pattern_insight_identities", "pattern_insight_reviews"]) {
        const out = runPsqlChecked(
          `select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee='anon';`,
          ["-t", "-A"]
        );
        expect(out.stdout.trim(), `anon privilege count on ${table}`).toBe("0");
      }
    });

    it("RLS is enabled on both tables", () => {
      for (const table of ["pattern_insight_identities", "pattern_insight_reviews"]) {
        const out = runPsqlChecked(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass;`, ["-t", "-A"]);
        expect(out.stdout.trim(), `RLS on ${table}`).toBe("t");
      }
    });
  });

  // ==========================================================================
  // RPC security properties — direct SQL introspection
  // ==========================================================================
  describe("persist_pattern_insight_review — security properties", () => {
    it("SECURITY INVOKER (never DEFINER)", () => {
      const out = runPsqlChecked(`select prosecdef from pg_proc where proname = 'persist_pattern_insight_review';`, ["-t", "-A"]);
      expect(out.stdout.trim()).toBe("f"); // prosecdef=false means SECURITY INVOKER
    });

    it("EXECUTE is granted to service_role only (never anon/authenticated/public)", () => {
      // 'postgres' (the migration-owning superuser) always appears here as an implicit
      // ownership grant — never a client-facing role, so it is excluded from the assertion.
      const out = runPsqlChecked(
        `select grantee from information_schema.role_routine_grants where routine_name = 'persist_pattern_insight_review' and grantee <> 'postgres' order by grantee;`,
        ["-t", "-A"]
      );
      const grantees = out.stdout.trim().split("\n").filter(Boolean);
      expect(grantees).toEqual(["service_role"]);
    });

    it("function body never uses SELECT ... FOR UPDATE", () => {
      const out = runPsqlChecked(`select pg_get_functiondef(oid) from pg_proc where proname = 'persist_pattern_insight_review';`, ["-t", "-A"]);
      expect(out.stdout.toLowerCase()).not.toMatch(/for update/);
    });

    it("function body uses pg_advisory_xact_lock (transaction-scoped advisory lock)", () => {
      const out = runPsqlChecked(`select pg_get_functiondef(oid) from pg_proc where proname = 'persist_pattern_insight_review';`, ["-t", "-A"]);
      expect(out.stdout).toMatch(/pg_advisory_xact_lock/);
    });

    it("authenticated cannot call the RPC directly", async () => {
      const { authClient } = await createAuthenticatedTestAthlete(client, "Pattern Insight Review RPC-Auth Probe");
      const { error } = await authClient.rpc("persist_pattern_insight_review", {
        p_athlete_id: athleteA.athleteId,
        p_detector_rule_id: DETECTOR_ID,
        p_detector_rule_version: DETECTOR_VERSION,
        p_insight_kind: freshInsightKind("auth-direct-call"),
        p_decision: "accepted_as_insight",
        p_candidate_snapshot: fakeSnapshot(),
        p_reviewer_note: null,
      });
      expect(error).not.toBeNull();
    });
  });

  // ==========================================================================
  // Concurrency
  // ==========================================================================
  describe("concurrency", () => {
    it("concurrent IDENTICAL first reviews for a brand-new identity -> one logical review head only, no duplicate review_number", async () => {
      const kind = freshInsightKind("concurrent-identical");
      const snapshot = fakeSnapshot({ insightKind: kind });
      const [r1, r2] = await Promise.all([
        persistReview({ insightKind: kind, candidateSnapshot: snapshot }),
        persistReview({ insightKind: kind, candidateSnapshot: snapshot }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const results = [r1.data as ReviewResult, r2.data as ReviewResult];
      const actions = results.map((r) => r.action).sort();
      expect(actions).toEqual(["inserted", "unchanged"]);
      expect(results[0]!.review_id).toBe(results[1]!.review_id);

      const { count } = await client.from("pattern_insight_reviews").select("id", { count: "exact", head: true }).eq("insight_identity_id", results[0]!.identity_id);
      expect(count).toBe(1);
    });

    it("concurrent DIFFERENT first reviews for a brand-new identity -> serialized valid review #1/#2 chain, no unique violation", async () => {
      const kind = freshInsightKind("concurrent-differing");
      const [r1, r2] = await Promise.all([
        persistReview({ insightKind: kind, decision: "accepted_as_insight" }),
        persistReview({ insightKind: kind, decision: "dismissed" }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const numbers = [(r1.data as ReviewResult).review_number, (r2.data as ReviewResult).review_number].sort();
      expect(numbers).toEqual([1, 2]);

      const { data: rows } = await client
        .from("pattern_insight_reviews")
        .select("review_number, supersedes_id")
        .eq("insight_identity_id", (r1.data as ReviewResult).identity_id)
        .order("review_number", { ascending: true });
      const typed = rows as { review_number: number; supersedes_id: string | null }[];
      expect(typed).toHaveLength(2);
      expect(typed[0]!.supersedes_id).toBeNull();
      expect(typed[1]!.supersedes_id).not.toBeNull();
    });
  });

  // ==========================================================================
  // Views
  // ==========================================================================
  describe("pattern_insight_review_current / _history — views", () => {
    it("current view exposes exactly the latest review head", async () => {
      const kind = freshInsightKind("view-current-head");
      await persistReview({ insightKind: kind, decision: "needs_more_evidence" });
      const r2 = (await persistReview({ insightKind: kind, decision: "accepted_as_insight" })).data as ReviewResult;

      const { data, error } = await client.from("pattern_insight_review_current").select("review_id, review_number, decision").eq("identity_id", r2.identity_id).single();
      expect(error).toBeNull();
      const row = data as { review_id: string; review_number: number; decision: string };
      expect(row.review_id).toBe(r2.review_id);
      expect(row.review_number).toBe(2);
      expect(row.decision).toBe("accepted_as_insight");
    });

    it("history view returns every review in the chain, not only the current head", async () => {
      const kind = freshInsightKind("view-history-sequence");
      const r1 = (await persistReview({ insightKind: kind, decision: "needs_more_evidence" })).data as ReviewResult;
      const r2 = (await persistReview({ insightKind: kind, decision: "dismissed" })).data as ReviewResult;
      const r3 = (await persistReview({ insightKind: kind, decision: "accepted_as_insight" })).data as ReviewResult;

      const { data, error } = await client
        .from("pattern_insight_review_history")
        .select("review_number, decision")
        .eq("identity_id", r3.identity_id)
        .order("review_number", { ascending: true });
      expect(error).toBeNull();
      const rows = data as { review_number: number; decision: string }[];
      expect(rows.map((r) => r.review_number)).toEqual([1, 2, 3]);
      expect(rows.map((r) => r.decision)).toEqual(["needs_more_evidence", "dismissed", "accepted_as_insight"]);
      void r1;
      void r2;
    });

    it("both views are security_invoker=true", () => {
      for (const view of ["pattern_insight_review_current", "pattern_insight_review_history"]) {
        const out = runPsqlChecked(`select relrowsecurity, (select option_value from pg_options_to_table(reloptions) where option_name = 'security_invoker') from pg_class where oid = 'public.${view}'::regclass;`, ["-t", "-A"]);
        expect(out.stdout.trim().split("|")[1], `${view} security_invoker`).toBe("true");
      }
    });
  });

  // ==========================================================================
  // RLS — real authenticated/anon clients
  // ==========================================================================
  describe("RLS — real clients", () => {
    it("authenticated user sees their own review, cannot INSERT directly", async () => {
      const { athlete, authClient } = await createAuthenticatedTestAthlete(client, "Pattern Insight Review RLS Athlete A");
      const kind = freshInsightKind("rls-own-select");
      const r1 = (await persistReview({ athleteId: athlete.athleteId, insightKind: kind })).data as ReviewResult;

      const { data, error } = await authClient.from("pattern_insight_review_current").select("review_id").eq("identity_id", r1.identity_id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { error: insertError } = await authClient.from("pattern_insight_reviews").insert({
        insight_identity_id: r1.identity_id,
        review_number: 2,
        supersedes_id: r1.review_id,
        decision: "dismissed",
        candidate_snapshot: {},
      });
      expect(insertError).not.toBeNull();
    });

    it("cross-athlete: athlete B's query for athlete A's review returns nothing", async () => {
      const { athlete: athleteA2, authClient: authClientA2 } = await createAuthenticatedTestAthlete(client, "Pattern Insight Review RLS Athlete A2");
      const kind = freshInsightKind("rls-cross-athlete");
      const r1 = (await persistReview({ athleteId: athleteA2.athleteId, insightKind: kind })).data as ReviewResult;

      const { authClient: authClientB } = await createAuthenticatedTestAthlete(client, "Pattern Insight Review RLS Athlete B");
      const { data, error } = await authClientB.from("pattern_insight_review_current").select("review_id").eq("identity_id", r1.identity_id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon has no access to the current view", async () => {
      const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
      const anonClient = createClient(LOCAL_URL, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await anonClient.from("pattern_insight_review_current").select("*");
      expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
    });
  });
});
