/**
 * V2-DH-UNIT-01 (HPM 2026-10-26), BETA-V2-TECH-01 T2 (candidate, ADR pending approval) — the daily run ALWAYS requires
 * a reliable DH unit for a V2 document: no executable DH count without its drill's signed unit, whatever the
 * document's origin (KEEP, MODIFY, REPLACE, manual) and whatever the generation switch.
 *
 * The V2 generation secret (NALYNT_V2_PLAN_GENERATION_ENABLED) only allows NEW V2 plans: turning it off, the emergency
 * cut, never lifts this protection from the V2 plans already accepted. V1 documents are not concerned (the requirement
 * is read by the V2 reconciliation only).
 *
 * Never imports planning-engine: the daily-run Edge Function loads this module from the unbundled dist.
 */
export const DAILY_DH_UNIT_REQUIREMENT: { readonly dhUnit: "required" } = Object.freeze({ dhUnit: "required" });
