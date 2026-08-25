/**
 * longitudinal-engine — M5 sibling package. See docs/11_DECISION_LOG.md
 * (M5_002A/M5_002B) for the architecture boundary this package enforces:
 * never imports head-coach-engine, implements no coaching logic, does not
 * influence daily-run.
 *
 * M5_002A: source-domain types + a read-only Supabase adapter.
 * M5_002B: a pure, deterministic AthleteTimeline builder over those source
 * facts (src/timeline/**) — still no interpretation, no detectors, no
 * pattern/evidence persistence, no jobs, no Edge Functions, no UI.
 * M5_004: a pure, deterministic post-decision outcome calculator
 * (src/calculators/**) plus a thin service-role persistence orchestrator
 * (src/supabase/outcomeOrchestrator.ts) — still no detector/pattern
 * semantics (that remains M5_005+), no scheduler, no trigger.
 * M5_005: a pure, deterministic recommendation-vs-actual-execution
 * detector (src/detectors/**), built on a shared decision/execution
 * relationship resolver (src/relations/**, extracted from M5_004's own
 * calculator with zero semantic change) — still no pattern/evidence
 * persistence, no aggregation, no learned patterns, no daily-run
 * influence. `relations/**` is this package's internal shared kernel
 * between `calculators/**` and `detectors/**` — not re-exported from this
 * top-level barrel (its shared error/type identities are already reachable
 * via `calculators/index.js`'s existing re-exports; a second `export *`
 * for the same names would create an ambiguous star-export collision).
 * M5_006A: append-only evidence persistence for M5_005's detector
 * (pattern_evidence_identities/_revisions/_source_refs +
 * persist_pattern_evidence RPC), plus the M5_005-specific persistence
 * adapter (src/persistence/**) — DB interaction confined to that
 * directory; detectors/** and relations/** remain pure. Still no
 * aggregation, no learned patterns, no scheduler/trigger, no other
 * detector's persistence adapter.
 */
export * from "./types/index.js";
export * from "./supabase/index.js";
export * from "./timeline/index.js";
export * from "./calculators/index.js";
export * from "./detectors/index.js";
export * from "./persistence/index.js";
