import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "./guidedSessionCopy";

// V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — the session-execution Edge guard refuses every training action on a DH
// session whose sports validation was revoked (dh_validation_not_current). The rider gets an explicit message, never a
// validation detail, and knows what stays possible (a safe stop; recorded results kept).
describe("V2-DH-SPORT-GATE-01C · guided session refusal after a revocation", () => {
  it("dh_validation_not_current has its own message: no start, no resume, no new result; results kept; a safe stop; no internal detail", () => {
    const message = ACTION_ERROR_MESSAGES.dh_validation_not_current!;
    expect(message).toBe(
      "Cette séance technique n'est plus validée : elle ne peut pas être commencée ni reprise, et aucun nouveau résultat n'est enregistré. Tes résultats déjà enregistrés sont conservés. Tu peux arrêter la séance."
    );
    expect(message).not.toMatch(/sign|unit|drill|race_execution|dh_/i);
  });
});
