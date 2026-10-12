// P0-SAFE (HPM 2026-10-12) — the rider explicitly closes one of their own open health signals
// (injury / illness / persistent pain) through the health-flag-resolution Edge Function. The server
// resolves the athlete from the JWT (never an id sent from here), refuses a concussion signal and
// records the closure on the signal itself. Never a medical validation.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export type ResolveOpenHealthFlagResult = { ok: true } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  health_flag_already_resolved: "Ce signal est déjà clôturé.",
  health_flag_not_found: "Ce signal n'existe plus.",
  medical_validation_required: "Ce signal ne peut être clôturé qu'après une validation médicale.",
  writes_suspended: "Les modifications sont temporairement indisponibles. Réessaie dans quelques instants.",
};
const FALLBACK = "Impossible de clôturer ce signal pour l'instant. Réessaie dans un instant.";

export async function resolveOpenHealthFlag(flagId: string, professionalConsulted: boolean): Promise<ResolveOpenHealthFlagResult> {
  const { error } = await supabase.functions.invoke("health-flag-resolution", { body: { flagId, professionalConsulted } });
  if (!error) return { ok: true };
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: { code?: string } };
      const code = body.error?.code;
      if (code && Object.prototype.hasOwnProperty.call(MESSAGES, code)) return { ok: false, message: MESSAGES[code]! };
    } catch {
      // Unreadable body: generic message below.
    }
  }
  return { ok: false, message: FALLBACK };
}
