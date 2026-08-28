/**
 * V0.3_001A hardening — pure unit tests for
 * supabase/functions/get-insights/errorMapping.ts. No Docker, no Deno, no
 * network — same portable-TypeScript convention as
 * head-coach-engine/tests/edge/completedSession/validation.test.ts.
 */
import { describe, expect, it } from "vitest";
// Imported from dist, NOT src — errorMapping.ts's own `instanceof` checks
// are against the dist-loaded class identity (mirrors its own import), and
// `instanceof` requires exact module/class identity: a src-loaded instance
// of the same-named class would NOT satisfy dist's `instanceof` check.
import { UnsupportedPatternInsightProjectorError } from "../../../dist/index.js";
import { mapGetInsightsError } from "../../../../supabase/functions/get-insights/errorMapping.js";

const SENTINEL = "SENTINEL_POSTGRES_SECRET_SQL_MESSAGE";

describe("mapGetInsightsError — sanitized mapping, fails loudly with a typed code", () => {
  it("UnsupportedPatternInsightProjectorError -> 500 unsupported_insight_projector, sanitized message", () => {
    const err = new UnsupportedPatternInsightProjectorError("some_detector", "9.9.9");
    const mapped = mapGetInsightsError(err);
    expect(mapped).toEqual({ status: 500, code: "unsupported_insight_projector", message: "An unexpected error occurred while projecting insights." });
    expect(JSON.stringify(mapped)).not.toContain("some_detector");
  });

  it("a raw Error carrying a sentinel maps to the fixed generic message, sentinel never leaks", () => {
    const mapped = mapGetInsightsError(new Error(`pg error: ${SENTINEL}`));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("internal_error");
    expect(JSON.stringify(mapped)).not.toContain(SENTINEL);
  });

  it("a non-Error thrown value also maps to a sanitized message", () => {
    const mapped = mapGetInsightsError(SENTINEL);
    expect(JSON.stringify(mapped)).not.toContain(SENTINEL);
  });

  it("the full { error: {...} } HTTP body built from any mapping never contains the sentinel", () => {
    const mapped = mapGetInsightsError(new Error(SENTINEL));
    const httpBody = { error: { code: mapped.code, message: mapped.message } };
    expect(JSON.stringify(httpBody)).not.toContain(SENTINEL);
  });
});
