/**
 * Frozen M5_004 calculator identity. Never derived from package.json, a git
 * hash, the current date, or a source row revision (see
 * docs/11_DECISION_LOG.md, M5_004) — a source-row edit is never a reason to
 * bump this. Bump CALCULATOR_VERSION only when the calculation semantics
 * themselves change (a new/changed field, a redefined window, a redefined
 * predicate); OUTCOME_SCHEMA_VERSION mirrors the outcome_signals shape's own
 * revision, independent of calculation-logic changes.
 */
export const CALCULATOR_ID = "post_decision_snapshot";
export const CALCULATOR_VERSION = "1.0.0";
export const OUTCOME_SCHEMA_VERSION = 1;
