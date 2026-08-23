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
 */
export * from "./types/index.js";
export * from "./supabase/index.js";
export * from "./timeline/index.js";
export * from "./calculators/index.js";
