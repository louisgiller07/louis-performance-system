import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sanitizeGetInsightsResponse } from "../../../tools/getInsightsCanary.js";

const SOURCE_PATH = fileURLToPath(new URL("../../../tools/getInsightsCanary.ts", import.meta.url));
const SOURCE_TEXT = readFileSync(SOURCE_PATH, "utf8");

const REAL_ATHLETE_ID = "004ccc83-0a88-42bd-b291-f2590626433f";
const REAL_JWT_FRAGMENT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRET_PAYLOAD.SIGNATURE";
const REAL_IDENTITY_ID = "dffeda3f-2135-47ad-a4b2-1ab1494937c1";

function realGetInsightsSuccessBody() {
  return {
    range: { fromDate: "1900-01-01", toDate: "9999-12-31" },
    candidates: [
      {
        snapshot: {
          insightKind: "recommendation_execution_alignment",
          athleteId: REAL_ATHLETE_ID,
          detectorRuleId: "recommendation_vs_actual_execution",
          detectorRuleVersion: "1.0.0",
          rangeFromDate: "1900-01-01",
          rangeToDate: "9999-12-31",
          direction: "supporting",
          title: "Exécution des recommandations",
          statement: "some statement text",
          caveats: [],
          evidenceCount: 1,
          supportingCount: 1,
          contradictingCount: 0,
          neutralCount: 0,
          directionalEvidenceCount: 1,
          supportingRatio: 1,
          contradictingRatio: 0,
          neutralRatio: 0,
          evidenceBalance: "supporting_only",
          firstEventDate: "2026-06-20",
          lastEventDate: "2026-06-20",
          sourceEvidenceRefs: [{ identityId: REAL_IDENTITY_ID, revisionId: "7d706c4c-f913-46c8-bf0e-0f9751bc87c0", revisionNumber: 1, evaluationKey: "decision:04b807a0", evidenceKey: "decision:04b807a0", eventType: "supporting", eventDate: "2026-06-20" }],
        },
        reviewState: "unreviewed",
        currentReview: null,
      },
    ],
  };
}

describe("sanitizeGetInsightsResponse — success path", () => {
  it("empty ledger -> range + zero candidates, exact shape", () => {
    const report = sanitizeGetInsightsResponse("headsha", 200, { range: { fromDate: "1900-01-01", toDate: "9999-12-31" }, candidates: [] });
    expect(report).toEqual({
      canonicalHead: "headsha",
      status: "success",
      httpStatus: 200,
      range: { fromDate: "1900-01-01", toDate: "9999-12-31" },
      candidateCount: 0,
      candidateKinds: [],
      errorCode: null,
    });
  });

  it("real-shaped success body: candidateCount/candidateKinds are correct, but NOTHING private leaks into the report", () => {
    const report = sanitizeGetInsightsResponse("headsha", 200, realGetInsightsSuccessBody());
    expect(report.candidateCount).toBe(1);
    expect(report.candidateKinds).toEqual(["recommendation_execution_alignment"]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(REAL_ATHLETE_ID);
    expect(serialized).not.toContain(REAL_IDENTITY_ID);
    expect(serialized).not.toContain("sourceEvidenceRefs");
    expect(serialized).not.toContain("statement");
    expect(serialized).not.toContain("some statement text");
  });

  it("candidateKinds contains only insightKind strings, never the rest of the snapshot", () => {
    const report = sanitizeGetInsightsResponse("headsha", 200, realGetInsightsSuccessBody());
    expect(report.candidateKinds.every((k) => typeof k === "string")).toBe(true);
    expect(Object.keys(report)).toEqual(["canonicalHead", "status", "httpStatus", "range", "candidateCount", "candidateKinds", "errorCode"]);
  });
});

describe("sanitizeGetInsightsResponse — failure path is sanitized", () => {
  it("a 4xx/5xx response maps to status http_error with only a safe error code, never the raw message text", () => {
    const report = sanitizeGetInsightsResponse("headsha", 403, { error: { code: "no_athlete_for_user", message: "No athlete record exists for the authenticated user." } });
    expect(report.status).toBe("http_error");
    expect(report.errorCode).toBe("no_athlete_for_user");
    expect(report.range).toBeNull();
    expect(report.candidateCount).toBe(0);
  });

  it("a malformed/unexpected error body never throws, falls back to a safe generic code", () => {
    expect(() => sanitizeGetInsightsResponse("headsha", 500, undefined)).not.toThrow();
    const report = sanitizeGetInsightsResponse("headsha", 500, undefined);
    expect(report.errorCode).toBe("unknown_error");
  });

  it("never echoes a JWT-shaped value that happened to appear in an error body", () => {
    const report = sanitizeGetInsightsResponse("headsha", 500, { error: { code: "internal_error", message: `token was ${REAL_JWT_FRAGMENT}` } });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(REAL_JWT_FRAGMENT);
  });
});

describe("getInsightsCanary.ts — structural source-level security invariants", () => {
  it("never references a service-role/admin configuration anywhere in this file", () => {
    // Deliberately NOT a bare /service_role/i scan — this file's own doc
    // comment legitimately explains, in prose, that get-insights has zero
    // service_role use; that mention is documentation, not a code smell.
    // The real risk surface is an actual credential/client reference.
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(SOURCE_TEXT).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(SOURCE_TEXT).not.toMatch(/supabaseAdmin/);
    expect(SOURCE_TEXT).not.toMatch(/role:\s*["']service_role["']/);
  });

  it("never reads or logs a raw access_token/session field — relies on functions.invoke's own session handling", () => {
    expect(SOURCE_TEXT).not.toMatch(/access_token/);
    expect(SOURCE_TEXT).not.toMatch(/console\.(log|error)\([^)]*session/i);
  });

  it("calls the repository guard before resolving Supabase config or signing in (source order, not just runtime behavior)", () => {
    const guardIndex = SOURCE_TEXT.indexOf("runRepositoryGuard()");
    const configIndex = SOURCE_TEXT.indexOf("resolveOperatorSupabaseConfig(");
    const signInIndex = SOURCE_TEXT.indexOf("signInInteractive(");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(configIndex);
    expect(guardIndex).toBeLessThan(signInIndex);
  });

  it("calls signOutBestEffort (which itself enforces local-only scope) rather than a raw client.auth.signOut", () => {
    expect(SOURCE_TEXT).toContain("signOutBestEffort(");
    expect(SOURCE_TEXT).not.toMatch(/client\.auth\.signOut\(/);
  });

  it("never prints the response's raw candidates array — only ever the sanitized report", () => {
    // The only console.log(JSON.stringify(...)) calls in this file must
    // serialize a `report` variable (the sanitized CanaryReport), never
    // `data`/`rawBody`/`candidates` directly.
    const logCalls = SOURCE_TEXT.match(/console\.log\(JSON\.stringify\(([^,)]+)/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).toContain("report");
    }
  });
});
