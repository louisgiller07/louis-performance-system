/**
 * longitudinal-engine — M5 sibling package. See docs/11_DECISION_LOG.md
 * (M5_002A) for the architecture boundary this package enforces: never
 * imports head-coach-engine, implements no coaching logic, does not
 * influence daily-run.
 *
 * M5_002A scope only: source-domain types + a read-only Supabase adapter.
 * No calculators, no detectors, no pattern/evidence persistence, no jobs,
 * no Edge Functions, no UI live here yet.
 */
export * from "./types/index.js";
export * from "./supabase/index.js";
