// P0-SAFE (HPM 2026-10-12) — the rider explicitly closes one of their own open health signals
// (injury / illness / persistent pain) through the health-flag-resolution Edge Function. The server
// resolves the athlete from the JWT (never an id sent from here), applies the closure policy (declaration;
// attested professional clearance for a grave signal; every zone confirmed for a multi-zone signal),
// refuses a concussion signal and records the closure on the signal itself. Never a medical validation.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export interface HealthFlagRequirements {
  /** Zone codes merged in this signal (pain_location_code or "unspecified"); empty for an illness. */
  zones: string[];
  /** Grave signal (A2 / A4): the rider must attest a professional authorised the return to training. */
  requiresProfessionalClearance: boolean;
}

export interface ResolveOpenHealthFlagInput {
  professionalConsulted: boolean;
  professionalClearance: boolean;
  confirmedZones: string[];
}

export type ResolveOpenHealthFlagResult = { ok: true } | { ok: false; message: string; requirements?: HealthFlagRequirements };

const MESSAGES: Record<string, string> = {
  health_flag_already_resolved: "Ce signal est déjà clôturé.",
  health_flag_not_found: "Ce signal n'existe plus.",
  medical_validation_required: "Ce signal ne peut être clôturé qu'après une validation médicale.",
  professional_clearance_required: "Ce signal ne peut être clôturé qu'avec l'autorisation de reprise d'un professionnel de santé.",
  zones_confirmation_required: "Confirme chacune des zones de ce signal pour le clôturer.",
  writes_suspended: "Les modifications sont temporairement indisponibles. Réessaie dans quelques instants.",
};
const FALLBACK = "Impossible de clôturer ce signal pour l'instant. Réessaie dans un instant.";

function isRequirements(value: unknown): value is HealthFlagRequirements {
  const v = value as HealthFlagRequirements | null;
  return !!v && Array.isArray(v.zones) && v.zones.every((z) => typeof z === "string") && typeof v.requiresProfessionalClearance === "boolean";
}

async function errorBody(error: unknown): Promise<{ code?: string; detail?: unknown } | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = (await (error.context as Response).json()) as { error?: { code?: string; detail?: unknown } };
    return body.error ?? null;
  } catch {
    return null;
  }
}

/** What closing this signal requires (zones to confirm, clearance attestation); null when unavailable. */
export async function inspectOpenHealthFlag(flagId: string): Promise<HealthFlagRequirements | null> {
  const { data, error } = await supabase.functions.invoke("health-flag-resolution", { body: { flagId, inspect: true } });
  if (error) return null;
  const requirements = (data as { requirements?: unknown } | null)?.requirements;
  return isRequirements(requirements) ? requirements : null;
}

export async function resolveOpenHealthFlag(flagId: string, input: ResolveOpenHealthFlagInput): Promise<ResolveOpenHealthFlagResult> {
  const { error } = await supabase.functions.invoke("health-flag-resolution", {
    body: { flagId, professionalConsulted: input.professionalConsulted, professionalClearance: input.professionalClearance, confirmedZones: input.confirmedZones },
  });
  if (!error) return { ok: true };
  const body = await errorBody(error);
  const code = body?.code;
  if (code && Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
    return { ok: false, message: MESSAGES[code]!, ...(isRequirements(body?.detail) ? { requirements: body.detail } : {}) };
  }
  return { ok: false, message: FALLBACK };
}
