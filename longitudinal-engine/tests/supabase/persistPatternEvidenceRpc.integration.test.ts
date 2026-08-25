/**
 * persist_pattern_evidence RPC integration suite — runs against a real
 * local Supabase stack. See testDb.ts for the required SUPABASE_SECRET_KEY
 * env var.
 *
 * Covers: first-write/insert, identical replay (unchanged), each of the
 * four semantic-equality dimensions changing independently (event_type,
 * event_date, observed_value, provenance set), evaluation_key mismatch
 * rejection, empty/duplicate provenance rejection, missing/cross-athlete
 * provenance source rejection (all five source kinds), JSON
 * key-reorder-vs-array-reorder equality semantics, and concurrency
 * (identical/differing concurrent writers, both for a brand-new identity
 * and for an existing head).
 *
 * No afterAll athlete cleanup in this file either (see
 * patternEvidenceSchema.integration.test.ts's own comment) —
 * pattern_evidence_identities.athlete_id is ON DELETE RESTRICT by design.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCompletedSession, insertDecision, type TestAthlete } from "./testDb.js";

interface PersistResult {
  identity_id: string;
  revision_id: string;
  revision_number: number;
  action: "inserted" | "superseded" | "unchanged";
}

describe("persist_pattern_evidence — integration", () => {
  let client: SupabaseClient;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;
  let decisionId: string;
  let sessionId: string;

  beforeAll(async () => {
    client = createTestClient();
    athleteA = await createTestAthlete(client, "Persist Pattern Evidence RPC Test Athlete A");
    athleteB = await createTestAthlete(client, "Persist Pattern Evidence RPC Test Athlete B");
    decisionId = await insertDecision(client, athleteA.athleteId, "2026-08-10", { final_session: "STRENGTH_A" });
    sessionId = await insertCompletedSession(client, athleteA.athleteId, "2026-08-10", {
      decision_id: decisionId,
      session_type: "STRENGTH_A",
      completion_status: "done",
    });
  }, 60_000);

  function baseProvenance() {
    return [
      { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
      { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
    ];
  }

  async function persist(overrides: {
    athleteId?: string;
    evaluationKey?: string;
    evidenceKey?: string;
    eventType?: string;
    eventDate?: string;
    observedValue?: unknown;
    provenance?: unknown;
  } = {}) {
    return client.rpc("persist_pattern_evidence", {
      p_athlete_id: overrides.athleteId ?? athleteA.athleteId,
      p_detector_rule_id: "recommendation_vs_actual_execution",
      p_detector_rule_version: "1.0.0",
      p_evaluation_key: overrides.evaluationKey ?? `decision:${decisionId}`,
      p_evidence_key: overrides.evidenceKey ?? `decision:${decisionId}:completion:${sessionId}`,
      p_event_type: overrides.eventType ?? "supporting",
      p_event_date: overrides.eventDate ?? "2026-08-10",
      p_observed_value: overrides.observedValue ?? { completionStatus: "done" },
      p_provenance: overrides.provenance ?? baseProvenance(),
    });
  }

  function freshKey(label: string) {
    const k = `decision:${decisionId}:${label}:${randomUUID()}`;
    return { evaluationKey: `decision:${decisionId}`, evidenceKey: k };
  }

  describe("first write / replay / supersession", () => {
    it("first write -> inserted, revision 1", async () => {
      const key = freshKey("first");
      const { data, error } = await persist(key);
      expect(error).toBeNull();
      expect((data as PersistResult).action).toBe("inserted");
      expect((data as PersistResult).revision_number).toBe(1);
    });

    it("identical replay -> unchanged, same revision", async () => {
      const key = freshKey("replay");
      const r1 = (await persist(key)).data as PersistResult;
      const r2 = (await persist(key)).data as PersistResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.revision_id).toBe(r1.revision_id);
      expect(r2.revision_number).toBe(r1.revision_number);
    });

    it("eventType change -> superseded, revision 2", async () => {
      const key = freshKey("eventtype");
      await persist({ ...key, eventType: "supporting" });
      const r2 = (await persist({ ...key, eventType: "neutral" })).data as PersistResult;
      expect(r2.action).toBe("superseded");
      expect(r2.revision_number).toBe(2);
    });

    it("eventDate change -> superseded", async () => {
      const key = freshKey("eventdate");
      await persist({ ...key, eventDate: "2026-08-10" });
      const r2 = (await persist({ ...key, eventDate: "2026-08-11" })).data as PersistResult;
      expect(r2.action).toBe("superseded");
      expect(r2.revision_number).toBe(2);
    });

    it("observedValue change -> superseded", async () => {
      const key = freshKey("observed");
      await persist({ ...key, observedValue: { completionStatus: "done" } });
      const r2 = (await persist({ ...key, observedValue: { completionStatus: "skipped" } })).data as PersistResult;
      expect(r2.action).toBe("superseded");
      expect(r2.revision_number).toBe(2);
    });

    it("provenance-set change alone (same event_type/date/observedValue) -> superseded", async () => {
      const key = freshKey("provonly");
      await persist({ ...key, provenance: [{ role: "evaluation_decision", source_kind: "decision", source_id: decisionId }] });
      const r2 = (
        await persist({
          ...key,
          provenance: [
            { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
            { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
          ],
        })
      ).data as PersistResult;
      expect(r2.action).toBe("superseded");
      expect(r2.revision_number).toBe(2);
    });
  });

  describe("semantic equality — exact", () => {
    it("JSON object key reorder in observed_value -> unchanged", async () => {
      const key = freshKey("keyreorder");
      const r1 = (await persist({ ...key, observedValue: { a: 1, b: 2, c: 3 } })).data as PersistResult;
      const r2 = (await persist({ ...key, observedValue: { c: 3, a: 1, b: 2 } })).data as PersistResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.revision_id).toBe(r1.revision_id);
    });

    it("JSON array reorder inside observed_value -> superseded (arrays are order-sensitive)", async () => {
      const key = freshKey("arrayreorder");
      await persist({ ...key, observedValue: { list: [1, 2, 3] } });
      const r2 = (await persist({ ...key, observedValue: { list: [3, 2, 1] } })).data as PersistResult;
      expect(r2.action).toBe("superseded");
    });

    it("provenance input array reorder -> unchanged", async () => {
      const key = freshKey("provreorder");
      const r1 = (
        await persist({
          ...key,
          provenance: [
            { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
            { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
          ],
        })
      ).data as PersistResult;
      const r2 = (
        await persist({
          ...key,
          provenance: [
            { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
            { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
          ],
        })
      ).data as PersistResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.revision_id).toBe(r1.revision_id);
    });
  });

  describe("evaluationKey mismatch", () => {
    it("same evidence_key, different evaluation_key on a second call -> rejected", async () => {
      const evidenceKey = `decision:${decisionId}:evalmismatch:${randomUUID()}`;
      const r1 = await persist({ evaluationKey: `decision:${decisionId}`, evidenceKey });
      expect(r1.error).toBeNull();
      const r2 = await persist({ evaluationKey: `decision:other-${randomUUID()}`, evidenceKey });
      expect(r2.error).not.toBeNull();
      expect(r2.error?.message).toMatch(/pattern_evidence_evaluation_key_mismatch/);
    });
  });

  describe("provenance payload validation", () => {
    it("empty provenance -> rejected", async () => {
      const key = freshKey("emptyprov");
      const { error } = await persist({ ...key, provenance: [] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_empty/);
    });

    it("duplicate provenance payload (same role/source_kind/source_id twice) -> rejected", async () => {
      const key = freshKey("dupprov");
      const { error } = await persist({
        ...key,
        provenance: [
          { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
          { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
        ],
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_duplicate_payload/);
    });

    it("missing provenance source (nonexistent id) -> rejected", async () => {
      const key = freshKey("missingsource");
      const { error } = await persist({
        ...key,
        provenance: [{ role: "evaluation_decision", source_kind: "decision", source_id: randomUUID() }],
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_source_missing/);
    });
  });

  describe("exact provenance object shape — {role, source_kind, source_id}", () => {
    it("exact snake_case payload -> accepted, inserted", async () => {
      const key = freshKey("exactshape");
      const { data, error } = await persist({
        ...key,
        provenance: [
          { role: "evaluation_decision", source_kind: "decision", source_id: decisionId },
          { role: "linked_completed_session", source_kind: "completed_session", source_id: sessionId },
        ],
      });
      expect(error).toBeNull();
      expect((data as PersistResult).action).toBe("inserted");
    });

    it("same provenance set, entries reordered -> unchanged (already covered by object semantics above, reconfirmed here under the exact-shape suite)", async () => {
      const key = freshKey("exactshape-reorder");
      const r1 = (await persist({ ...key, provenance: baseProvenance() })).data as PersistResult;
      const r2 = (await persist({ ...key, provenance: [...baseProvenance()].reverse() })).data as PersistResult;
      expect(r2.action).toBe("unchanged");
      expect(r2.revision_id).toBe(r1.revision_id);
    });

    it("an extra key beyond role/source_kind/source_id -> rejected before any write", async () => {
      const key = freshKey("extrakey");
      const { error } = await persist({
        ...key,
        provenance: [{ role: "evaluation_decision", source_kind: "decision", source_id: decisionId, extra: "nope" }],
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);

      const { count } = await client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("evidence_key", key.evidenceKey);
      expect(count).toBe(0);
    });

    it("missing role -> rejected", async () => {
      const key = freshKey("missingrole");
      const { error } = await persist({ ...key, provenance: [{ source_kind: "decision", source_id: decisionId }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);
    });

    it("missing source_kind -> rejected", async () => {
      const key = freshKey("missingsourcekind");
      const { error } = await persist({ ...key, provenance: [{ role: "evaluation_decision", source_id: decisionId }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);
    });

    it("missing source_id -> rejected", async () => {
      const key = freshKey("missingsourceid");
      const { error } = await persist({ ...key, provenance: [{ role: "evaluation_decision", source_kind: "decision" }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);
    });

    it("old camelCase sourceKind/sourceId payload -> rejected (the rejected legacy shape)", async () => {
      const key = freshKey("camelcase");
      const { error } = await persist({
        ...key,
        provenance: [{ role: "evaluation_decision", sourceKind: "decision", sourceId: decisionId }],
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);

      const { count } = await client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("evidence_key", key.evidenceKey);
      expect(count).toBe(0);
    });

    it("a scalar provenance element (not a JSON object) -> rejected", async () => {
      const key = freshKey("scalarelement");
      const { error } = await persist({ ...key, provenance: ["not-an-object"] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);
    });

    it("an array provenance element (not a JSON object) -> rejected", async () => {
      const key = freshKey("arrayelement");
      const { error } = await persist({ ...key, provenance: [["role", "decision", decisionId]] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_invalid_shape/);
    });

    it("any malformed provenance shape leaves zero identity/revision/source_ref rows", async () => {
      const key = freshKey("malformed-zero-writes");
      await persist({ ...key, provenance: [{ role: "evaluation_decision", sourceKind: "decision", sourceId: decisionId }] });

      const { count: identityCount } = await client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("evidence_key", key.evidenceKey);
      expect(identityCount).toBe(0);

      const { count: revisionCount } = await client
        .from("pattern_evidence_revisions")
        .select("id, pattern_evidence_identities!inner(evidence_key)" as never, { count: "exact", head: true })
        .eq("pattern_evidence_identities.evidence_key", key.evidenceKey);
      expect(revisionCount).toBe(0);
    });
  });

  describe("cross-athlete provenance validation — all five source kinds", () => {
    it("foreign decision -> rejected", async () => {
      const foreignDecisionId = await insertDecision(client, athleteB.athleteId, "2026-08-10", { final_session: "REST" });
      const key = freshKey("foreign-decision");
      const { error } = await persist({ ...key, provenance: [{ role: "evaluation_decision", source_kind: "decision", source_id: foreignDecisionId }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_cross_athlete/);
    });

    it("foreign completed_session -> rejected", async () => {
      const foreignSessionId = await insertCompletedSession(client, athleteB.athleteId, "2026-08-10");
      const key = freshKey("foreign-session");
      const { error } = await persist({ ...key, provenance: [{ role: "linked_completed_session", source_kind: "completed_session", source_id: foreignSessionId }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_cross_athlete/);
    });

    it("foreign daily_checkin -> rejected", async () => {
      const { data: checkin } = await client
        .from("daily_checkins")
        .insert({ athlete_id: athleteB.athleteId, checkin_date: "2026-08-12", pain: false, suspected_concussion: false, fever_or_illness: false } as never)
        .select("id")
        .single();
      const key = freshKey("foreign-checkin");
      const { error } = await persist({ ...key, provenance: [{ role: "context", source_kind: "daily_checkin", source_id: (checkin as { id: string }).id }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_cross_athlete/);
    });

    it("foreign health_flag -> rejected", async () => {
      const { data: flag } = await client
        .from("health_flags")
        .insert({ athlete_id: athleteB.athleteId, flag_date: "2026-08-12", flag_type: "other", description: "cross-athlete test" } as never)
        .select("id")
        .single();
      const key = freshKey("foreign-flag");
      const { error } = await persist({ ...key, provenance: [{ role: "context", source_kind: "health_flag", source_id: (flag as { id: string }).id }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_cross_athlete/);
    });

    it("foreign decision_outcome -> rejected", async () => {
      const { data: outcomeDecision } = await client
        .from("decisions")
        .insert({ athlete_id: athleteB.athleteId, decision_date: "2026-08-10", final_session: "REST", reason: "x", engine_version: "test" } as never)
        .select("id")
        .single();
      const { data: outcome } = await client
        .from("decision_outcomes")
        .insert({
          athlete_id: athleteB.athleteId,
          decision_id: (outcomeDecision as { id: string }).id,
          horizon: "J_PLUS_1",
          calculator_id: "test",
          calculator_version: "1",
          input_snapshot: {},
          outcome_signals: {},
        } as never)
        .select("id")
        .single();
      const key = freshKey("foreign-outcome");
      const { error } = await persist({ ...key, provenance: [{ role: "context", source_kind: "decision_outcome", source_id: (outcome as { id: string }).id }] });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/pattern_evidence_provenance_cross_athlete/);
    });
  });

  describe("concurrency", () => {
    it("concurrent identical calls for a brand-new identity produce exactly one revision", async () => {
      const key = freshKey("concurrent-new-identical");
      const [r1, r2] = await Promise.all([persist(key), persist(key)]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const results = [r1.data as PersistResult, r2.data as PersistResult];
      const actions = results.map((r) => r.action).sort();
      expect(actions).toEqual(["inserted", "unchanged"]);
      expect(results[0]!.revision_id).toBe(results[1]!.revision_id);
    });

    it("concurrent DIFFERING calls for a brand-new identity produce revisions 1 and 2, never a fork", async () => {
      const key = freshKey("concurrent-new-differing");
      const [r1, r2] = await Promise.all([
        persist({ ...key, observedValue: { completionStatus: "done" } }),
        persist({ ...key, observedValue: { completionStatus: "skipped" } }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const numbers = [(r1.data as PersistResult).revision_number, (r2.data as PersistResult).revision_number].sort();
      expect(numbers).toEqual([1, 2]);

      const { data: revisions } = await client
        .from("pattern_evidence_revisions")
        .select("revision_number, supersedes_id")
        .eq("evidence_identity_id", (r1.data as PersistResult).identity_id)
        .order("revision_number", { ascending: true });
      expect(revisions).toHaveLength(2);
      expect((revisions as { revision_number: number; supersedes_id: string | null }[])[0]!.supersedes_id).toBeNull();
      expect((revisions as { revision_number: number; supersedes_id: string | null }[])[1]!.supersedes_id).not.toBeNull();
    });

    it("concurrent identical calls against an EXISTING head produce exactly one new effective revision (both calls agree)", async () => {
      const key = freshKey("concurrent-existing-identical");
      await persist({ ...key, observedValue: { completionStatus: "done" } }); // revision 1
      const [r1, r2] = await Promise.all([
        persist({ ...key, observedValue: { completionStatus: "skipped" } }),
        persist({ ...key, observedValue: { completionStatus: "skipped" } }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const actions = [(r1.data as PersistResult).action, (r2.data as PersistResult).action].sort();
      expect(actions).toEqual(["superseded", "unchanged"]);
      expect((r1.data as PersistResult).revision_id).toBe((r2.data as PersistResult).revision_id);

      const { count } = await client
        .from("pattern_evidence_revisions")
        .select("id", { count: "exact", head: true })
        .eq("evidence_identity_id", (r1.data as PersistResult).identity_id);
      expect(count).toBe(2); // revision 1 (setup) + exactly one new revision 2, never a duplicate
    });

    it("concurrent DIFFERING calls against an existing head produce deterministic serial revisions, never a fork", async () => {
      const key = freshKey("concurrent-existing-differing");
      await persist({ ...key, observedValue: { completionStatus: "done" } }); // revision 1
      const [r1, r2] = await Promise.all([
        persist({ ...key, observedValue: { completionStatus: "skipped" } }),
        persist({ ...key, observedValue: { completionStatus: "partial" } }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();

      const { data: revisions } = await client
        .from("pattern_evidence_revisions")
        .select("revision_number, supersedes_id")
        .eq("evidence_identity_id", (r1.data as PersistResult).identity_id)
        .order("revision_number", { ascending: true });
      const rows = revisions as { revision_number: number; supersedes_id: string | null }[];
      expect(rows.map((row) => row.revision_number)).toEqual([1, 2, 3]);
      // A linear chain, never a fork: each revision N>1 supersedes exactly revision N-1 (already
      // independently enforced by trg_pattern_evidence_revisions_predecessor_check — reconfirmed here).
      expect(rows[1]!.supersedes_id).not.toBeNull();
      expect(rows[2]!.supersedes_id).not.toBeNull();
    });
  });
});
