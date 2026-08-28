/**
 * V0.3_001B — operator-only preview tooling. Deterministic fingerprint over
 * exactly the real, already-loaded `AthleteTimeline` content that drove a
 * preview run, plus the processing date used to build it. Purely a change
 * detector for the operator (has the source data or the processing date
 * moved since I approved this preview?) — this is NOT the M5_007 human-
 * review freshness token (`docs/06_ARCHITECTURE.md` §V0.3_001) and does not
 * alter that product contract in any way.
 *
 * Deliberately reuses the ALREADY-LOADED `timeline.days`/`decisionThreads`/
 * `healthFlagThreads` (the exact structures buildTimeline deterministically
 * assembled — see its own doc for the ordering/determinism guarantees this
 * relies on) rather than re-fetching raw source rows: this way the
 * fingerprint reflects precisely what the preview actually computed over,
 * with zero extra network calls and zero duplicated query logic.
 *
 * The raw canonical representation is never returned or logged — only the
 * final `sha256:<hex>` digest, which reveals nothing about its input.
 */
import { createHash } from "node:crypto";
import type { AthleteTimeline } from "../src/timeline/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function computeSourceFingerprint(processingDate: string, timeline: AthleteTimeline): string {
  const canonical = canonicalize({
    processingDate,
    days: timeline.days,
    decisionThreads: timeline.decisionThreads,
    healthFlagThreads: timeline.healthFlagThreads,
  });
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}
