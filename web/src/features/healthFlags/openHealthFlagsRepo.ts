// V0.3_006A1 — read-only access to public.health_flags for the caller's own
// athlete. Since 20260909090000_v0_3_006a1_health_flags_select_only_security,
// health_flags_own_select is the sole RLS policy (SELECT only) and
// authenticated has no INSERT/UPDATE/DELETE grant at all — this module is
// the only web-side reader of the table, and it is deliberately read-only.
// P0-SAFE (HPM 2026-10-12): the only write is the rider's explicit closure, done
// server-side by the health-flag-resolution Edge Function
// (healthFlagResolutionClient.ts), never through this table. Never a service/secret key.
import { supabase } from "../../lib/supabase";
import type { HealthFlagType } from "../dailyPlan/dailyPlanTypes";

export interface OpenHealthFlag {
  /** P0-SAFE — the row id, only to close this signal (never displayed). */
  id: string;
  type: HealthFlagType;
  /** P0-SAFE — the engine's declaration sentence (may end with a raw pain-location code; sanitized at display). */
  description: string;
  /** The date the signal was first declared — "YYYY-MM-DD". Never the row id, status name, or any other internal field. */
  flagDate: string;
}

export class OpenHealthFlagsLoadError extends Error {
  constructor() {
    super("Impossible de charger ton suivi santé.");
    this.name = "OpenHealthFlagsLoadError";
  }
}

// health_flags_open_unique (M2_005) guarantees at most one open row per
// (athlete_id, flag_type) — this select can still return several rows if
// different flag types are simultaneously open (e.g. concussion + illness).
const HEALTH_FLAG_COLUMNS = "id, flag_type, flag_date, description";

interface HealthFlagRow {
  id: string;
  flag_type: HealthFlagType;
  flag_date: string;
  description: string;
}

/** Every currently open (status active/monitoring) health flag for the caller's own athlete, oldest first. */
export async function loadOpenHealthFlags(athleteId: string): Promise<OpenHealthFlag[]> {
  const { data, error } = await supabase
    .from("health_flags")
    .select(HEALTH_FLAG_COLUMNS)
    .eq("athlete_id", athleteId)
    .in("status", ["active", "monitoring"])
    .order("flag_date", { ascending: true });

  if (error) {
    console.error("openHealthFlagsRepo.loadOpenHealthFlags failed", error.code);
    throw new OpenHealthFlagsLoadError();
  }

  return ((data ?? []) as HealthFlagRow[]).map((row) => ({ id: row.id, type: row.flag_type, flagDate: row.flag_date, description: row.description }));
}
