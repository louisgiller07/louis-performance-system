import { describe, it, expect } from "vitest";
import { buildDailyPlan } from "../src/engine/buildDailyPlan.js";
import { baseRawContext } from "../fixtures/louis.js";

/**
 * Seul propriétaire de l'assertion exacte de la version courante
 * d'`ENGINE_VERSION`. Les suites de domaine historiques (T11/T12/T13/...)
 * ne doivent pas porter leur propre copie de ce littéral exact : chaque
 * nouvelle décision de provenance (V0.3_002B/C/D/...) ne nécessite alors
 * de modifier qu'un seul fichier, jamais l'ensemble des suites de domaine.
 *
 * Valeur volontairement en dur (jamais importée depuis `ENGINE_VERSION`) —
 * une comparaison contre la constante elle-même serait tautologique et ne
 * détecterait jamais une régression de provenance.
 */
describe("ENGINE_VERSION — current provenance ownership", () => {
  it("DailyPlan.engine_version is exactly the current approved value", () => {
    const plan = buildDailyPlan(baseRawContext());
    expect(plan.engine_version).toBe("head-coach-engine@0.2.0-m1-v0.3_004a");
  });
});
