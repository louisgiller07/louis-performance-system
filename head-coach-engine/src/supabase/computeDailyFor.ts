/**
 * `computeDailyFor` — M2 applicative entry point. See
 * docs/06_ARCHITECTURE.md §Découpage ("computeDailyFor(client, athleteId,
 * today) → construit RawContext, appelle buildDailyPlan, retourne
 * {rawContext, dailyPlan}. Zéro écriture.") and §Contraintes canoniques
 * ("computeDailyFor et runDailyFor sont deux opérations distinctes. Le
 * dry-run est computeDailyFor.").
 *
 * Behaviour is strictly: (1) build RawContext from the DB, (2) call the
 * unmodified M1 engine, (3) return exactly its DailyPlan. No coaching
 * post-processing, no write, no call to `persist_daily_run` — that is
 * `runDailyFor`, out of scope here (docs/06_ARCHITECTURE.md
 * §computeDailyFor/runDailyFor).
 *
 * The documented return shape `{ rawContext, dailyPlan }` is extended
 * additively with `warnings`: M1's frozen `DailyPlan` has no field for
 * the adapter-level reconstruction warnings `buildRawContext` may produce
 * (e.g. an ambiguous legacy planned session), and this task does not
 * modify M1 to add one. Surfacing them as a sibling field is the minimal
 * way to avoid silently dropping them while keeping `dailyPlan` itself
 * byte-for-byte what M1 produced.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyPlan, RawContext } from "../types/index.js";
import { buildDailyPlan } from "../engine/buildDailyPlan.js";
import { buildRawContext } from "./buildRawContext.js";

export interface ComputeDailyForResult {
  rawContext: RawContext;
  dailyPlan: DailyPlan;
  /** Adapter-level reconstruction warnings — see buildRawContext.ts. */
  warnings: string[];
}

/**
 * Builds `RawContext` from Supabase for `athleteId` on `today`, runs the
 * unmodified M1 engine, and returns its `DailyPlan`. Zero write.
 */
export async function computeDailyFor(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<ComputeDailyForResult> {
  const { rawContext, warnings } = await buildRawContext(client, athleteId, today);
  const dailyPlan = buildDailyPlan(rawContext);
  return { rawContext, dailyPlan, warnings };
}
