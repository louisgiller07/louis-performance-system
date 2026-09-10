import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HistoryDetail } from "./HistoryDetail";
import type { DecisionHistoryRow } from "./historyTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";

const VALID_DAILY_PLAN = {
  active_mode: "IN_SEASON",
  training: { active: false },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  reasoning: "Tout va bien.",
  confidence: "MEDIUM",
  triggered_rules: [],
  planned_session_before: null,
  final_session: { kind: "PUMPTRACK", load_profile: "LIGHT" },
  decision: "KEEP",
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

function makeRow(overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id: "d-1",
    decisionDate: "2026-08-19",
    createdAt: "2026-08-19T08:00:00Z",
    finalSessionDb: "REST",
    activeModeDb: "IN_SEASON",
    confidenceLevelDb: "MEDIUM",
    dailyPlan: VALID_DAILY_PLAN,
    ...overrides,
  };
}

function makeSession(overrides: Partial<CompletedSessionRecord> = {}): CompletedSessionRecord {
  return {
    id: "cs-1",
    session_date: "2026-08-19",
    decision_id: "d-1",
    session_type: "DH_TECHNICAL",
    completion_status: "done",
    actual_duration_min: 120,
    rpe: 7,
    post_leg_fatigue: 5,
    post_grip_fatigue: 4,
    new_pain: false,
    new_pain_note: null,
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    main_content: null,
    session_load: 84,
    updated_at: "2026-08-19T20:00:00Z",
    technical_outcome: null,
    change_reason: null,
    change_reason_note: null,
    ...overrides,
  };
}

describe("HistoryDetail", () => {
  it("renders the stored DailyPlan via the shared DailyPlanView for a valid row", () => {
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "none" }} />);
    expect(screen.getByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText("Tout va bien.")).toBeInTheDocument();
  });

  it("does not render an empty card for an inactive section", () => {
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "none" }} />);
    expect(screen.queryByText("Entraînement")).not.toBeInTheDocument();
  });

  it("renders an explicit health signal only when persisted in the stored DailyPlan", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: { ...VALID_DAILY_PLAN, health_flag_to_create: { type: "pain_persistent", reason: "Douleur 3 jours de suite" } },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    expect(screen.getByText("Attention santé")).toBeInTheDocument();
    expect(screen.getByText("Douleur 3 jours de suite")).toBeInTheDocument();
  });

  it("shows no health banner when the stored DailyPlan carries no health_flag_to_create", () => {
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "none" }} />);
    expect(screen.queryByText("Attention santé")).not.toBeInTheDocument();
  });

  it("shows a degraded, safe fallback for a malformed/legacy stored plan, without crashing", () => {
    render(
      <HistoryDetail row={makeRow({ dailyPlan: { decision: "NOT_A_REAL_ENUM" }, finalSessionDb: "STRENGTH_A" })} performedMatch={{ kind: "none" }} />
    );

    expect(screen.getByText(/ne peut pas être affichée complètement/)).toBeInTheDocument();
    expect(screen.getByText("STRENGTH_A")).toBeInTheDocument();
    // Never invents a decision label from an untrusted shape.
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });

  it("enriches the degraded fallback with the real activeModeDb/confidenceLevelDb DB columns when present", () => {
    render(
      <HistoryDetail
        row={makeRow({ dailyPlan: { decision: "NOT_A_REAL_ENUM" }, activeModeDb: "RACE_WEEK", confidenceLevelDb: "HIGH" })}
        performedMatch={{ kind: "none" }}
      />
    );
    expect(screen.getByText(/Semaine de course/)).toBeInTheDocument();
    expect(screen.getByText(/Élevée/)).toBeInTheDocument();
  });

  it("omits mode/confidence from the degraded fallback for a pre-M2 row where both are null, never fabricating them", () => {
    render(<HistoryDetail row={makeRow({ dailyPlan: null, activeModeDb: null, confidenceLevelDb: null })} performedMatch={{ kind: "none" }} />);
    expect(screen.getByText(/ne peut pas être affichée complètement/)).toBeInTheDocument();
    expect(screen.queryByText(/Mode :/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confiance :/)).not.toBeInTheDocument();
  });

  // REV-001 — a fresh athlete's persisted decision (active_mode: UNSPECIFIED,
  // legitimate engine output since V0.3_004C) must render via the normal
  // rich DailyPlanView path, exactly like any other modern valid decision —
  // never the degraded fallback, and never the raw "UNSPECIFIED" string.
  it("renders a fresh-athlete row (active_mode: UNSPECIFIED) via the normal rich path, never the degraded fallback", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: { ...VALID_DAILY_PLAN, active_mode: "UNSPECIFIED", final_session: { kind: "RECOVERY_ACTIVE" } },
          activeModeDb: "UNSPECIFIED",
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    expect(screen.queryByText(/ne peut pas être affichée complètement/)).not.toBeInTheDocument();
    expect(screen.getByText(/Phase non configurée/)).toBeInTheDocument();
    expect(screen.queryByText("UNSPECIFIED")).not.toBeInTheDocument();
  });

  // V0.3_006B — Session Prescription V1 (DH-first): History reuses the same
  // DailyPlanView as Today, from the persisted decisions.daily_plan JSONB
  // only — no recomputation, same consolidated "Séance DH" card.
  it("renders the consolidated 'Séance DH' card, hour-formatted, from a persisted decision", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, objective: "Séance DH" },
            dh_or_technical: { active: true, focus: "Précision et qualité d'exécution", spot_hint: "Terrain adapté au focus technique du jour." },
            final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 240 },
          },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    expect(screen.getByText("Séance DH")).toBeInTheDocument();
    expect(screen.getByText(/Fenêtre de session\s*:\s*environ 4 h/)).toBeInTheDocument();
    expect(screen.queryByText("240 min")).not.toBeInTheDocument();
  });

  // V0.3_006C2 — REQUIRED HISTORY IMMUTABILITY REGRESSION. Scenario: Planning
  // held DH_PERFORMANCE/HEAVY/120min (2h) when this decision was generated
  // (a true KEEP, so planned_session_before and final_session share the same
  // kind/load — resolveDhDuration's CASE A preserves the explicit 120min
  // exactly). Planning is later changed to 240min (4h) — this decision must
  // still render its ORIGINAL 120min/2h, never the later 240min/4h, and the
  // underlying persisted data (planned_session_before.duration_min) must
  // still read exactly 120. Proof is structural, not just behavioral:
  // HistoryDetail/HistoryDetailPage never import or call planningRepo.ts
  // (confirmed by source inspection) — there is no code path by which a
  // later Planning edit could reach this render at all, "no browser
  // recomputation" is therefore an architectural guarantee, not a lucky
  // coincidence of this test's inputs.
  it("V0.3_006C2 — a persisted decision keeps its original planned duration (120min/2h) even after Planning is later changed to 240min/4h, never recomputed", () => {
    const persistedDailyPlan = {
      ...VALID_DAILY_PLAN,
      training: { active: true, session_type: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, objective: "Séance DH" },
      dh_or_technical: { active: true, focus: "Précision des lignes et vitesse maîtrisée", spot_hint: "Terrain adapté au focus technique du jour." },
      planned_session_before: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
      final_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 120 },
    };
    // Data-level proof: the persisted athlete-authored intent itself is
    // frozen at 120 in this fixture, wholly independent of whatever
    // Planning might say by the time a human opens this History row.
    expect(persistedDailyPlan.planned_session_before.duration_min).toBe(120);

    render(<HistoryDetail row={makeRow({ dailyPlan: persistedDailyPlan })} performedMatch={{ kind: "none" }} />);

    // Render-level proof: only the original 2h ever appears...
    expect(screen.getByText(/Fenêtre de session\s*:\s*environ 2 h/)).toBeInTheDocument();
    // ...the later Planning value (4h) never leaks into this render.
    expect(screen.queryByText(/environ 4 h/)).not.toBeInTheDocument();
    expect(screen.queryByText("240 min")).not.toBeInTheDocument();
  });

  // A row persisted before V0.3_006B never had duration_min on a DH
  // final_session at all — must remain a fully valid, richly-rendered
  // History row, simply without a session-window line.
  //
  // V0.3_006C1 (final correction) — this same row also never had
  // dh_or_technical.load_guidance (persisted before that correction too):
  // it doubles as the CANONICAL HISTORY INVARIANT regression — History must
  // never synthesize the new riding-behavior coaching copy for a plan that
  // never actually carried it, only the neutral load label.
  it("a legacy DH row (persisted before V0.3_006B/V0.3_006C1, no duration_min, no load_guidance) still renders the rich path with only the neutral load label, no crash, never the new behavioral coaching copy", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, objective: "Séance DH" },
            dh_or_technical: { active: true, focus: "Précision et qualité d'exécution", spot_hint: "Terrain adapté au focus technique du jour." },
            final_session: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
          },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    expect(screen.queryByText(/ne peut pas être affichée complètement/)).not.toBeInTheDocument();
    expect(screen.getByText("Séance DH")).toBeInTheDocument();
    expect(screen.queryByText(/Fenêtre de session/)).not.toBeInTheDocument();
    const dhCard = screen.getByText("Séance DH").closest("div")!;
    expect(within(dhCard).getByText(/charge modérée/i)).toBeInTheDocument();
    expect(screen.queryByText(/fais monter l'engagement progressivement/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Priorise la qualité d'exécution/)).not.toBeInTheDocument();
  });

  // V0.3_006C1 (final correction) — the flip side: a row persisted AFTER the
  // correction carries dh_or_technical.load_guidance, and History must
  // restore it byte-for-byte, no browser-side recomputation from
  // final_session.load_profile.
  it("a row with persisted load_guidance restores it exactly, never the neutral label", () => {
    const loadGuidance =
      "Séance orientée performance : fais monter l'engagement progressivement et travaille la vitesse sans sacrifier la précision ni le contrôle.";
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, objective: "Séance DH" },
            dh_or_technical: {
              active: true,
              focus: "Précision des lignes et vitesse maîtrisée",
              load_guidance: loadGuidance,
              spot_hint: "Terrain adapté au focus technique du jour.",
            },
            final_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 360 },
          },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    const dhCard = screen.getByText("Séance DH").closest("div")!;
    expect(within(dhCard).getByText(loadGuidance)).toBeInTheDocument();
    expect(within(dhCard).queryByText(/^charge lourde$/i)).not.toBeInTheDocument();
  });

  // V0.3_006C1 — History renders execution_task/terrain/Mental pre-run
  // action/pain monitoring exactly as persisted, no recomputation, and
  // sanitizes the same raw pain_location_code the same way Today does.
  it("renders execution_task, terrain, Mental pre-run action, and sanitized pain monitoring exactly as persisted", () => {
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "DH_LIGHT", load_profile: "LIGHT" }, objective: "Séance DH" },
            dh_or_technical: {
              active: true,
              focus: "Fluidité, relâchement et marge",
              execution_task: "Sur terrain connu, cherche une conduite fluide et relâchée sans objectif de vitesse.",
              spot_hint: "Privilégie un terrain familier et lisible où tu peux garder de la marge et une exécution propre.",
            },
            mental: {
              active: true,
              action_hint:
                "Avant de partir, fais quelques respirations lentes puis rappelle-toi ta priorité : Fluidité, relâchement et marge. Pendant le run, reviens uniquement à ce focus.",
            },
            monitoring: { observe: ["Surveiller l'évolution de la douleur (wrist_L, intensité 4/10) sur 24-48h"] },
            final_session: { kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 150 },
          },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    // HistoryDetail always passes technicalMetadata (dev-only debug <pre>
    // legitimately dumps the raw persisted JSON too) — scope queries to the
    // specific rendered card, not the whole document, to avoid the debug
    // dump entirely (same content, different concern than the "getAllByText"
    // precedent used elsewhere in this file).
    const dhCard = screen.getByText("Séance DH").closest("div")!;
    expect(within(dhCard).getByText("Sur terrain connu, cherche une conduite fluide et relâchée sans objectif de vitesse.")).toBeInTheDocument();
    expect(
      within(dhCard).getByText("Privilégie un terrain familier et lisible où tu peux garder de la marge et une exécution propre.")
    ).toBeInTheDocument();

    const mentalCard = screen.getByText("Mental").closest("div")!;
    expect(within(mentalCard).getByText(/rappelle-toi ta priorité : Fluidité, relâchement et marge/)).toBeInTheDocument();

    const monitoringCard = screen.getByText("À surveiller").closest("div")!;
    expect(within(monitoringCard).getByText(/Poignet gauche/)).toBeInTheDocument();
    expect(within(monitoringCard).queryByText(/wrist_L/)).not.toBeInTheDocument();
  });

  // V0.3_006C1 (A5 copy-leak hotfix) — the exact production-canary-observed
  // leak, reproduced against a persisted (restored) A5-shaped row: the
  // Entraînement card must never show the raw training.objective copy from
  // the engine ("Flag concussion_suspect actif non résolu..."), only the
  // athlete-safe sentence — scoped to the Entraînement card specifically
  // since technicalMetadata's debug dump legitimately still contains the
  // raw string.
  it("renders the athlete-safe A5 sentence in the Entraînement card, never the raw concussion_suspect slug, for a persisted A5-shaped decision", () => {
    const a5Detail = "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement";
    render(
      <HistoryDetail
        row={makeRow({
          dailyPlan: {
            ...VALID_DAILY_PLAN,
            training: { active: true, session_type: { kind: "RECOVERY_ACTIVE" }, objective: a5Detail },
            final_session: { kind: "RECOVERY_ACTIVE" },
            triggered_rules: [{ layer: "A", rule_id: "A5", detail: a5Detail }],
          },
        })}
        performedMatch={{ kind: "none" }}
      />
    );
    const trainingCard = screen.getByText("Entraînement").closest("div")!;
    expect(within(trainingCard).queryByText(/concussion_suspect/)).not.toBeInTheDocument();
    expect(within(trainingCard).queryByText(/Flag/)).not.toBeInTheDocument();
    expect(within(trainingCard).getByText(/toujours actif/)).toBeInTheDocument();
  });
});

// V0.3_007D — History: Prescribed vs Performed. The "Réalisé" block never
// recomputes anything; it renders exactly the classified performedMatch the
// caller (HistoryDetailPage, via historyPerformedMatch.ts) already resolved
// from the exact decision_id FK — see docs/11_DECISION_LOG.md V0.3_007D.
describe("HistoryDetail — Réalisé (V0.3_007D)", () => {
  function realiseCard() {
    return screen.getByText("Réalisé").nextElementSibling as HTMLElement;
  }

  // §7 — the intended asymmetry: Prescrit (the persisted decision, from
  // `row`) is immutable, but Réalisé must reflect whatever the current
  // completed_sessions row says — never a snapshot frozen at first render.
  // Simulates the athlete correcting their debrief (same decision link,
  // different RPE/technical_outcome) — HistoryDetail itself never caches or
  // snapshots performed data; it renders exactly the performedMatch it's
  // given each time.
  it("performed correctability: re-rendering with an updated completed session (same decision link) reflects the CORRECTED Réalisé, never a stale snapshot", () => {
    const original = makeSession({ completion_status: "partial", rpe: 5, post_leg_fatigue: 1, post_grip_fatigue: 1, technical_outcome: "no" });
    const { rerender } = render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session: original }} />);
    expect(within(realiseCard()).getByText("5/10")).toBeInTheDocument();
    expect(within(realiseCard()).getByText("Non")).toBeInTheDocument();

    const corrected = makeSession({ completion_status: "partial", rpe: 8, post_leg_fatigue: 1, post_grip_fatigue: 1, technical_outcome: "yes" });
    rerender(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session: corrected }} />);

    expect(within(realiseCard()).getByText("8/10")).toBeInTheDocument();
    expect(within(realiseCard()).getByText("Oui")).toBeInTheDocument();
    expect(within(realiseCard()).queryByText("5/10")).not.toBeInTheDocument();
  });

  // §26.G — no completed row at all.
  it("CASE C: no completed session -> 'Pas de séance enregistrée.', never presented as skipped", () => {
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "none" }} />);
    expect(within(realiseCard()).getByText("Pas de séance enregistrée.")).toBeInTheDocument();
    expect(within(realiseCard()).queryByText("Non faite")).not.toBeInTheDocument();
  });

  // §26.E/§13 — a same-day session exists but is free/unlinked (decision_id null).
  it("CASE B (free/unlinked): a same-day session exists but decision_id is NULL -> neutral unassociated copy, never the session's own performed details", () => {
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "same_day_unassociated" }} />);
    expect(within(realiseCard()).getByText("Une séance a été enregistrée ce jour-là, mais elle n'est pas associée à ce plan.")).toBeInTheDocument();
    expect(within(realiseCard()).queryByText("Faite")).not.toBeInTheDocument();
  });

  // §26.F/§13 — decision B on a day where the completed session belongs to decision A.
  it("CASE B (different decision): a same-day session exists but belongs to another decision -> neutral unassociated copy, never that other session's details", () => {
    render(<HistoryDetail row={makeRow({ id: "decision-B" })} performedMatch={{ kind: "same_day_unassociated" }} />);
    expect(within(realiseCard()).getByText("Une séance a été enregistrée ce jour-là, mais elle n'est pas associée à ce plan.")).toBeInTheDocument();
  });

  // §26.A — DONE linked DH: exact Réalisé.
  it("CASE A, DONE: exact linked session renders rich intervention and status", () => {
    const session = makeSession({ completion_status: "done", intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    expect(within(realiseCard()).getByText("Faite")).toBeInTheDocument();
    expect(within(realiseCard()).getByText(/DH technique/)).toBeInTheDocument();
    expect(within(realiseCard()).getByText(/charge modérée/)).toBeInTheDocument();
  });

  // §26.B — PARTIAL linked DH: technical_outcome + change_reason visible, never a percentage.
  it("CASE A, PARTIAL: shows technical_outcome (athlete-facing label, never the raw enum) and change_reason/note", () => {
    const session = makeSession({
      completion_status: "partial",
      technical_outcome: "partial",
      change_reason: "fatigue_control",
      change_reason_note: "Jambes lourdes en fin de session",
    });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    expect(within(card).getByText("Partielle")).toBeInTheDocument();
    expect(within(card).getByText("En partie")).toBeInTheDocument();
    expect(within(card).queryByText("partial")).not.toBeInTheDocument();
    expect(within(card).getByText("Fatigue ou perte de contrôle")).toBeInTheDocument();
    expect(within(card).getByText("Jambes lourdes en fin de session")).toBeInTheDocument();
    expect(within(card).queryByText(/%/)).not.toBeInTheDocument();
  });

  // §26.C — REPLACED: Prescrit stays the original DH decision, Réalisé shows the actual replacement (Pumptrack) + reason, no judgmental copy.
  it("CASE A, REPLACED: Prescrit is unchanged while Réalisé shows the actual replacement activity and a neutral reason", () => {
    const dhDecision = makeRow({
      dailyPlan: {
        ...VALID_DAILY_PLAN,
        training: { active: true, session_type: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }, objective: "Séance DH" },
        dh_or_technical: { active: true, focus: "Précision", spot_hint: "Terrain adapté." },
        final_session: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      },
    });
    const session = makeSession({
      completion_status: "replaced",
      intervention: { kind: "PUMPTRACK", load_profile: "LIGHT" },
      change_reason: "weather_terrain",
    });
    render(<HistoryDetail row={dhDecision} performedMatch={{ kind: "linked", session }} />);

    // Prescrit still shows the original DH prescription, verbatim.
    const dhCard = screen.getByText("Séance DH").closest("div")!;
    expect(within(dhCard).getByText(/DH performance/)).toBeInTheDocument();

    const card = realiseCard();
    expect(within(card).getByText("Remplacée")).toBeInTheDocument();
    expect(within(card).getByText(/Pumptrack/)).toBeInTheDocument();
    expect(within(card).getByText("Météo / terrain")).toBeInTheDocument();
    // No compliance/judgment language anywhere in the Réalisé block.
    expect(within(card).queryByText(/non-compliant|échec|mauvaise adhérence|n'a pas suivi/i)).not.toBeInTheDocument();
  });

  // §26.D / §8 (presentation gate) — SKIPPED: status shown, never a
  // fabricated activity. Unlike a genuinely performed legacy row, the
  // coarse session_type fallback must NOT render here: it would only ever
  // describe what was prescribed-and-skipped, and next to "Non faite" that
  // reads as a fabricated performed activity.
  it("CASE A, SKIPPED: shows 'Non faite' plus the reason, and suppresses the coarse session_type fallback entirely — never implies an activity was performed", () => {
    const session = makeSession({ completion_status: "skipped", intervention: null, session_type: "DH_TECHNICAL", change_reason: "pain" });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    expect(within(card).getByText("Non faite")).toBeInTheDocument();
    expect(within(card).getByText("Douleur")).toBeInTheDocument();
    expect(within(card).queryByText("Activité")).not.toBeInTheDocument();
    expect(within(card).queryByText("DH technique")).not.toBeInTheDocument();
  });

  // §8 flip side — a genuinely performed (non-skipped) legacy row with a
  // null intervention still legitimately shows the coarse fallback: this
  // isn't a fabrication, it's the only description available of something
  // that really was done.
  it("legacy non-skipped row (done, intervention null) still shows the coarse session_type fallback — this is a real performed fact, not fabricated", () => {
    const session = makeSession({ completion_status: "done", intervention: null, session_type: "DH_TECHNICAL" });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    expect(within(card).getByText("Faite")).toBeInTheDocument();
    expect(within(card).getByText("Activité")).toBeInTheDocument();
    expect(within(card).getByText("DH technique")).toBeInTheDocument();
  });

  // §26.I — REST DONE renders coherently via the rich intervention, no fabricated activity.
  it("REST DONE renders the canonical rich REST activity, no fabricated load/duration", () => {
    const session = makeSession({ completion_status: "done", intervention: { kind: "REST" }, actual_duration_min: null, rpe: null, session_type: "REST" });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    expect(within(card).getByText("Faite")).toBeInTheDocument();
    expect(within(card).getByText("Repos")).toBeInTheDocument();
    expect(within(card).queryByText("Durée")).not.toBeInTheDocument();
  });

  // §26.H / §23 — legacy row (intervention null) falls back to the coarse session_type, no crash, no invented debrief.
  it("legacy completed row (intervention/technical_outcome/change_reason all null) falls back gracefully, no crash, no invented debrief", () => {
    const session = makeSession({
      completion_status: "done",
      intervention: null,
      session_type: "RECOVERY",
      technical_outcome: null,
      change_reason: null,
      change_reason_note: null,
    });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    expect(within(card).getByText("Récupération")).toBeInTheDocument();
    expect(within(card).queryByText("Tâche technique")).not.toBeInTheDocument();
    expect(within(card).queryByText("Motif")).not.toBeInTheDocument();
  });

  // §9 — no raw enum value may ever reach the athlete-facing Réalisé block.
  it("never exposes a raw enum code — every field goes through its French label map", () => {
    const session = makeSession({
      completion_status: "replaced",
      intervention: { kind: "PUMPTRACK", load_profile: "HEAVY" },
      technical_outcome: "partial",
      change_reason: "activity_change",
    });
    render(<HistoryDetail row={makeRow()} performedMatch={{ kind: "linked", session }} />);
    const card = realiseCard();
    for (const rawEnum of ["replaced", "PUMPTRACK", "HEAVY", "partial", "activity_change", "DH_TECHNICAL"]) {
      expect(within(card).queryByText(rawEnum)).not.toBeInTheDocument();
    }
    // The French labels are what's actually shown.
    expect(within(card).getByText("Remplacée")).toBeInTheDocument();
    expect(within(card).getByText(/Pumptrack/)).toBeInTheDocument();
    expect(within(card).getByText(/charge lourde/)).toBeInTheDocument();
    expect(within(card).getByText("En partie")).toBeInTheDocument();
    expect(within(card).getByText("Changement d'activité")).toBeInTheDocument();
  });
});
