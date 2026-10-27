import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { dhUnitRefusalMessage, mapGenerateTrainingPlanError } from "./generateTrainingPlanErrors";
import { REASON_BLOCKED_MESSAGES } from "../finalPrescriptionV2/finalPrescriptionV2Copy";

// V2-DH-ATTRIBUTION-01 (HPM 2026-10-26) — a V2 plan refused because a DH drill has no validated repetition unit is
// NALYNT's own gap: the message says so, names the priority, and never asks the rider to change a profile.

const refusal = (code: string, detail: Record<string, unknown>) => new FunctionsHttpError(new Response(JSON.stringify({ error: { code, message: "x", detail } }), { status: 422 }));

describe("V2-DH-ATTRIBUTION-01 · generation refused for a DH unit", () => {
  it("unit unknown: explicit message with the priority, nothing for the rider to change (config issue, not user-fixable)", async () => {
    const mapped = await mapGenerateTrainingPlanError(refusal("dh_repetition_unit_unknown", { skill: "braking", dhTechnicalTier: "intermediate", drillId: "braking_late_entry" }));
    expect(mapped).toEqual({
      code: "dh_repetition_unit_unknown",
      message:
        "Ton programme ne peut pas encore être créé. L'exercice technique prévu pour « Freinage » à ton niveau n'a pas encore d'unité validée (section ou descente complète) : NALYNT ne fixe pas de nombre de passages sans elle. Ton profil n'est pas en cause : tu n'as rien à modifier.",
      retryable: false,
      action: "config_issue",
    });
    expect(mapped.message).not.toMatch(/configuration athlète est incomplète/);
  });

  it("full run without the track's descent time; an unknown skill still gives a clear message", async () => {
    expect((await mapGenerateTrainingPlanError(refusal("dh_full_run_needs_track_data", { skill: "race_execution" }))).message).toMatch(/se répète en descentes complètes, et NALYNT ne connaît pas encore la durée de descente de ta piste/);
    expect(dhUnitRefusalMessage("dh_repetition_unit_unknown", { skill: "unknown_skill" })).toMatch(/^Ton programme ne peut pas encore être créé\. Un exercice technique de ton programme/);
  });

  it("today's card: a DH count without a validated unit, a full run without track data and a non-compliant frozen prescription have their own reason", () => {
    expect(REASON_BLOCKED_MESSAGES.dh_repetition_unit_unknown).toMatch(/n'affiche pas de nombre de passages/);
    expect(REASON_BLOCKED_MESSAGES.dh_full_run_needs_track_data).toMatch(/durée de descente/);
    expect(REASON_BLOCKED_MESSAGES.kept_prescription_contract_violation).toMatch(/ne la modifie pas/);
  });
});
