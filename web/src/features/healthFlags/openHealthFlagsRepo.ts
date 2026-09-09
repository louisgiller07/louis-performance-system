// V0.3_006A1 — read-only access to public.health_flags for the caller's own
// athlete. Since 20260909090000_v0_3_006a1_health_flags_select_only_security,
// health_flags_own_select is the sole RLS policy (SELECT only) and
// authenticated has no INSERT/UPDATE/DELETE grant at all — this module is
// the only web-side reader of the table, and it is deliberately read-only:
// there is no resolution/write path here, and none should be added without
// a separate Safety policy decision (see docs/11_DECISION_LOG.md V0.3_006A).
// Never a service/secret key.
import { supabase } from "../../lib/supabase";
import type { HealthFlagType } from "../dailyPlan/dailyPlanTypes";

export interface OpenHealthFlag {
  type: HealthFlagType;
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
const HEALTH_FLAG_COLUMNS = "flag_type, flag_date";

interface HealthFlagRow {
  flag_type: HealthFlagType;
  flag_date: string;
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

  return ((data ?? []) as HealthFlagRow[]).map((row) => ({ type: row.flag_type, flagDate: row.flag_date }));
}
