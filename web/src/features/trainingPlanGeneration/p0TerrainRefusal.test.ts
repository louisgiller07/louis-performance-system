import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { mapGenerateTrainingPlanError, unavailableTerrainMessage } from "./generateTrainingPlanErrors";

// P0 first generation — the terrain refusal is precise and honest (never "configuration incomplète",
// never an invitation to declare a terrain the rider does not have).
describe("P0 — V2 terrain refusal message", () => {
  it("names the priority and the missing terrain, and only suggests adding it if really accessible", async () => {
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: { code: "unavailable_dh_drill_terrain", message: "x", detail: { skill: "cornering", requiredTerrain: "bermed_trail" } } }), { status: 422 }));
    const mapped = await mapGenerateTrainingPlanError(error);
    expect(mapped).toEqual({
      code: "unavailable_dh_drill_terrain",
      message: "Pour travailler « Virages » à ton niveau, le programme a besoin du terrain « Piste avec relevés », qui ne fait pas partie de tes terrains. Ajoute-le seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan.",
      retryable: false,
      action: "user_fixable",
    });
    expect(mapped.message).not.toMatch(/incomplète/);
  });

  it("without a usable detail: a generic but still honest message", () => {
    for (const detail of [undefined, {}, { skill: "unknown", requiredTerrain: 3 }]) {
      expect(unavailableTerrainMessage(detail as never)).toBe("Aucun exercice technique de ton niveau ne correspond à ta priorité sur tes terrains. Ajoute un terrain seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan.");
    }
  });
});

describe("P0 — several compatible terrains (HPM 2026-10-12)", () => {
  it("names every terrain that would allow the priority", () => {
    expect(unavailableTerrainMessage({ skill: "cornering", requiredTerrain: "bermed_trail", compatibleTerrains: ["bermed_trail", "bike_park_jump_line", "full_dh_track"] })).toBe(
      "Pour travailler « Virages » à ton niveau, le programme a besoin d'un de ces terrains : « Piste avec relevés », « Bike park / ligne de sauts » ou « Piste DH complète ». Aucun ne fait partie de tes terrains. Ajoute-en un seulement si tu y as réellement accès ; sinon, choisis une autre priorité pour ce plan."
    );
  });
});
