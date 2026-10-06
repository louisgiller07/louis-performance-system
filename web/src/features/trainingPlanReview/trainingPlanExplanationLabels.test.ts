import { describe, expect, it } from "vitest";
import { formatWeekAttentionSummary, translateExplanation } from "./trainingPlanExplanationLabels";
// Cross-boundary read of the engine phrases, test only (same practice as sessionModelV2Support.test.ts).
import { BLOCK_PROGRESSION_PHRASES_V2 } from "../../../../planning-engine/src/sessionModelV2/orchestration/blockProgressionV2.ts";

// Verbatim engine phrases (see the module doc for their sources).
const VERSION_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["Initial training plan generation.", "Première génération de ton plan d'entraînement."],
  ["Regenerated after a race was added to the calendar.", "Plan régénéré après l'ajout d'une course au calendrier."],
  ["Regenerated after a race was removed from the calendar.", "Plan régénéré après le retrait d'une course du calendrier."],
  ["Regenerated after declared availability changed.", "Plan régénéré après une modification de tes disponibilités."],
  ["Regenerated after declared equipment changed.", "Plan régénéré après une modification de ton équipement."],
  ["Regenerated after a pattern of missed or replaced sessions.", "Plan régénéré après plusieurs séances manquées ou remplacées."],
  ["Regenerated after a manual edit.", "Plan régénéré après une modification manuelle."],
  ["Regenerated due to a planner/ruleset version upgrade.", "Plan régénéré après une mise à jour de la méthode de planification."],
];

const WEEK_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["Race week: minimal structured volume, no new strength stimulus.", "Semaine de course : volume structuré minimal, pas de nouveau travail de force."],
  [
    "Taper week ahead of an upcoming race: reduced volume versus a normal development week.",
    "Semaine d'affûtage avant une course : volume réduit par rapport à une semaine de développement normale.",
  ],
  ["Week type set by an explicit upstream recovery/deload indication.", "Type de semaine défini par une indication de récupération ou d'allègement."],
  ["Standard development week.", "Semaine standard de développement."],
];

const ADJUSTMENT = "Adjusted due to recent missed or replaced sessions pattern";
const RECOVERY_SPACING = "Reduced heavy strength load to avoid consecutive heavy strength sessions";

// Words that only ever appear in the engine's English text — none may survive translation.
const ENGLISH_LEAK = /\b(week|training|generation|Regenerated|race|sessions?|Adjusted|Reduced|heavy|strength|constraint|relaxed|Standard|Taper|upstream|deload)\b/;

describe("translateExplanation — every current engine phrase", () => {
  it.each(VERSION_PHRASES)("version: %s", (english, french) => {
    expect(translateExplanation(english, "version")).toEqual({ text: french, attentionPointCount: null });
  });

  it.each(WEEK_PHRASES)("week type: %s", (english, french) => {
    expect(translateExplanation(english, "week")).toEqual({ text: french, attentionPointCount: null });
  });

  it("session history adjustment suffix", () => {
    expect(translateExplanation(ADJUSTMENT, "session").text).toBe("Charge allégée car plusieurs séances récentes ont été manquées ou remplacées.");
  });

  it("session recovery_spacing suffix", () => {
    expect(translateExplanation(RECOVERY_SPACING, "session").text).toBe("Charge de force réduite pour éviter deux séances lourdes d'affilée.");
  });
});

describe("translateExplanation — engine composition (parts joined by a space)", () => {
  it("week rationale with the relaxed-constraint count: explanation and count are separated", () => {
    expect(translateExplanation("Standard development week. 3 constraint(s) relaxed.", "week")).toEqual({
      text: "Semaine standard de développement.",
      attentionPointCount: 3,
    });
  });

  it("session rationale with both suffixes, in engine order", () => {
    expect(translateExplanation(`Taper week ahead of an upcoming race: reduced volume versus a normal development week. ${ADJUSTMENT} ${RECOVERY_SPACING}`, "session").text).toBe(
      "Semaine d'affûtage avant une course : volume réduit par rapport à une semaine de développement normale. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées. Charge de force réduite pour éviter deux séances lourdes d'affilée."
    );
  });

  it("no translated output ever contains the engine's English", () => {
    const all = [
      ...VERSION_PHRASES.map(([english]) => translateExplanation(english, "version").text),
      ...WEEK_PHRASES.map(([english]) => translateExplanation(`${english} 2 constraint(s) relaxed.`, "week").text),
      translateExplanation(`Standard development week. ${ADJUSTMENT} ${RECOVERY_SPACING}`, "session").text,
    ].join(" ");

    expect(all).not.toMatch(ENGLISH_LEAK);
  });
});

describe("BUG-V2-2 — V2 block progression phrases", () => {
  it.each(Object.entries(BLOCK_PROGRESSION_PHRASES_V2))("%s: every engine phrase has a French translation, no English left", (_key, english) => {
    const { text } = translateExplanation(english, "week");
    expect(text).not.toBeNull();
    expect(text).not.toBe("Semaine planifiée à partir de ta configuration.");
    expect(text).not.toMatch(ENGLISH_LEAK);
  });

  it("a V2 week rationale = role phrase + holds / adaptations + relaxed count, all translated in engine order", () => {
    const p = BLOCK_PROGRESSION_PHRASES_V2;
    expect(translateExplanation(`${p.build} ${p.recent_training_history} ${p.fixed_sessions_hold} ${p.adapted_to_availability} 1 constraint(s) relaxed.`, "week")).toEqual({
      text: "Semaine de construction : charge de développement standard. Entraînement récent pris en compte : le bloc démarre directement en construction. Séances fixes cette semaine : charge maintenue, sans augmentation. Séances raccourcies pour tenir dans le temps disponible.",
      attentionPointCount: 1,
    });
  });
});

describe("translateExplanation — unknown and absent text", () => {
  it("mixed known/unknown: only the known part is shown, the unknown English is dropped", () => {
    expect(translateExplanation("Standard development week. New fatigue adjustment.", "week")).toEqual({
      text: "Semaine standard de développement.",
      attentionPointCount: null,
    });
  });

  it("an unknown part in the middle is dropped as well", () => {
    expect(translateExplanation(`Standard development week. Some future note. ${ADJUSTMENT}`, "session").text).toBe(
      "Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées."
    );
  });

  it("entirely unknown text → neutral sentence for its context, never the raw English", () => {
    expect(translateExplanation("Brand new engine explanation.", "version").text).toBe("Plan généré à partir de ta configuration.");
    expect(translateExplanation("Brand new engine explanation.", "week").text).toBe("Semaine planifiée à partir de ta configuration.");
    expect(translateExplanation("Brand new engine explanation.", "session").text).toBe("Séance prévue par ton programme.");
  });

  it("a known phrase embedded inside an unknown sentence is not picked out of it", () => {
    expect(translateExplanation("NotStandard development week.", "week").text).toBe("Semaine planifiée à partir de ta configuration.");
  });

  it("only the count, no explanation: no text, count kept", () => {
    expect(translateExplanation("1 constraint(s) relaxed.", "week")).toEqual({ text: null, attentionPointCount: 1 });
  });

  it("empty, blank, or non-string → nothing", () => {
    for (const value of ["", "   ", null, undefined, 42]) {
      expect(translateExplanation(value, "session")).toEqual({ text: null, attentionPointCount: null });
    }
  });
});

describe("formatWeekAttentionSummary", () => {
  it("singular, plural, none", () => {
    expect(formatWeekAttentionSummary(1)).toBe("1 point d'attention cette semaine.");
    expect(formatWeekAttentionSummary(3)).toBe("3 points d'attention cette semaine.");
    expect(formatWeekAttentionSummary(0)).toBeNull();
    expect(formatWeekAttentionSummary(null)).toBeNull();
  });
});
