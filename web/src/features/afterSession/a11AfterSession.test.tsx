import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { AfterSessionEntry } from "./AfterSessionEntry";
import { effortLabel } from "./afterSessionPresentation";
import type { EffectiveDay } from "../effectiveSession/effectiveDay";

// A11 — the after-session debrief: short, about the right session, network-safe.

const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut }) }));
vi.mock("../completedSession/completedSessionRepo", () => ({ getCompletedSession: vi.fn(), putCompletedSession: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadValidDecisionsForDate: vi.fn(), loadGuidedDayState: vi.fn() }));
vi.mock("../effectiveSession/effectiveSessionRepo", () => ({ useEffectiveDays: vi.fn(() => null) }));

import { getCompletedSession, putCompletedSession } from "../completedSession/completedSessionRepo";
import { loadGuidedDayState, loadValidDecisionsForDate } from "../history/historyRepo";
import { useEffectiveDays } from "../effectiveSession/effectiveSessionRepo";

const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedPut = putCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedLoadDecisions = loadValidDecisionsForDate as unknown as ReturnType<typeof vi.fn>;
const mockedLoadGuided = loadGuidedDayState as unknown as ReturnType<typeof vi.fn>;
const mockedEffective = useEffectiveDays as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-10-07";

function decisionRow(id: string, createdAt: string, decision: string, finalSession: { kind: string; load_profile?: string; duration_min?: number }, planned: { kind: string; load_profile?: string } | null = null) {
  return {
    id,
    decisionDate: DATE,
    createdAt,
    finalSessionDb: "STRENGTH_A",
    activeModeDb: "IN_SEASON",
    confidenceLevelDb: "MEDIUM",
    dailyPlan: {
      decision,
      confidence: "MEDIUM",
      reasoning: "Plan.",
      active_mode: "IN_SEASON",
      training: { active: true },
      dh_or_technical: { active: false },
      mental: { active: false },
      recovery: { active: true, actions: [] },
      nutrition: { active: false },
      sleep: { active: false },
      protection: { do_not_do: [] },
      monitoring: { observe: [] },
      triggered_rules: [],
      planned_session_before: planned,
      final_session: finalSession,
      overrode_race_protocol: false,
      engine_version: "test",
    },
  };
}

const FORCE_LIGHT_45 = { kind: "STRENGTH_LOWER", load_profile: "LIGHT", duration_min: 45 };
const DH_90 = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 };
// C — the morning decision kept the DH; the recalculated one replaced it by a Force (append-only, the latest is current).
const D1_KEEP_DH = decisionRow("d1", "2026-10-07T06:00:00Z", "KEEP", DH_90, DH_90);
const D2_REPLACE_FORCE = decisionRow("d2", "2026-10-07T07:30:00Z", "REPLACE", FORCE_LIGHT_45, DH_90);

function saved(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      completedSession: {
        id: "cs-1",
        session_date: DATE,
        decision_id: "d2",
        session_type: "STRENGTH_A",
        completion_status: "done",
        actual_duration_min: 45,
        rpe: 7,
        post_leg_fatigue: null,
        post_grip_fatigue: null,
        new_pain: false,
        new_pain_note: null,
        intervention: { kind: "STRENGTH_LOWER", load_profile: "LIGHT" },
        main_content: null,
        session_load: 315,
        updated_at: "2026-10-07T19:00:00Z",
        technical_outcome: null,
        change_reason: null,
        change_reason_note: null,
        ...overrides,
      },
      warnings: [],
    },
  };
}

const sheet = () => screen.getByRole("dialog", { name: "Après ta séance" });
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Raconter ma séance →" }));
  return sheet();
}
const renderEntry = () =>
  render(
    <MemoryRouter>
      <AfterSessionEntry date={DATE} athleteId="athlete-1" />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.resetAllMocks();
  mockedGet.mockResolvedValue({ ok: true, data: null });
  mockedLoadDecisions.mockResolvedValue([D1_KEEP_DH, D2_REPLACE_FORCE]);
  mockedLoadGuided.mockResolvedValue("none");
  mockedEffective.mockReturnValue(null);
});

describe("A11 — the right session, automatically", () => {
  it("B / C — DH planned, REPLACE → Force LIGHT 45 recalculated later: « Bilan — Renfo bas du corps », linked to that decision, Force prefilled, 45 min", async () => {
    mockedPut.mockResolvedValue(saved());
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    expect(within(sheet()).getByTestId("after-session-title")).toHaveTextContent("Bilan — Renfo bas du corps");
    expect(within(sheet()).queryByText(/Quel plan as-tu suivi/)).toBeNull();
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: /^Comme prévu · 45\smin$/ }));
    await user.click(await within(sheet()).findByRole("button", { name: "Ton effort 7 sur 10" }));
    await user.click(await within(sheet()).findByRole("button", { name: "Non" }));
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "d2", intervention: { kind: "STRENGTH_LOWER", load_profile: "LIGHT" }, actual_duration_min: 45, rpe: 7 });
  });

  it("L — a legacy ambiguity only: two decisions at the same instant → an explicit choice, and why", async () => {
    mockedLoadDecisions.mockResolvedValue([D1_KEEP_DH, { ...D2_REPLACE_FORCE, createdAt: D1_KEEP_DH.createdAt }]);
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    expect(await within(sheet()).findByTestId("after-session-plan-why")).toHaveTextContent("NALYNT ne peut pas savoir laquelle tu as suivie");
    expect(within(sheet()).getByTestId("after-session-title")).toHaveTextContent("Bilan — Séance libre");
  });

  it("A / D — a guided session completed (even under an older decision): the executed session by name, no separate debrief (F-5)", async () => {
    mockedLoadGuided.mockResolvedValue("completed");
    mockedEffective.mockReturnValue([{ date: DATE, session: FORCE_LIGHT_45, status: "completed", source: "execution", adaptation: "REPLACE", planned: DH_90, decisionId: "d1", executionId: "e1", finalPrescriptionId: "fp1" } satisfies EffectiveDay]);
    renderEntry();
    expect(await screen.findByTestId("after-session-executed")).toHaveTextContent(/Renfo bas du corps/);
    expect(screen.queryByRole("button", { name: "Raconter ma séance →" })).toBeNull();
  });
});

describe("A11 — short paths and a stable progress", () => {
  it("the progress shows « Étape 1 » until the path is known, then a total that never grows", async () => {
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    expect(within(sheet()).getByTestId("after-session-progress")).toHaveTextContent(/^Étape 1$/);
    await user.click(within(sheet()).getByRole("button", { name: /Partiellement/ }));
    await waitFor(() => expect(within(sheet()).getByTestId("after-session-progress")).toHaveTextContent("Étape 2 / 5"));
    await user.click(within(sheet()).getByRole("button", { name: "Moins 5 minutes" }));
    await user.click(within(sheet()).getByRole("button", { name: "Continuer" }));
    await user.click(await within(sheet()).findByRole("button", { name: "Fatigue ou perte de contrôle" }));
    // The fatigue questions open INSIDE the reason step: the total stays 5.
    expect(within(sheet()).getByTestId("after-session-body")).toBeInTheDocument();
    expect(within(sheet()).getByTestId("after-session-progress")).toHaveTextContent("Étape 3 / 5");
  });

  it("F — skipped for lack of time: 3 taps, change_reason time_life, no new pain asked", async () => {
    mockedPut.mockResolvedValue(saved({ completion_status: "skipped", change_reason: "time_life" }));
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Non réalisée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: "Manque de temps / contrainte perso" }));
    expect(within(sheet()).queryByText("Est-ce une nouvelle douleur ?")).toBeNull();
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0]![0]).toMatchObject({ completion_status: "skipped", change_reason: "time_life", new_pain: false, session_type: "STRENGTH_B", decision_id: "d2" });
  });

  it("skipped for pain: « Est-ce une nouvelle douleur ? » inside the step, with the check-in reminder; Oui needs a few words", async () => {
    mockedPut.mockResolvedValue(saved({ completion_status: "skipped", change_reason: "pain", new_pain: true, new_pain_note: "Genou" }));
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Non réalisée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: "Douleur" }));
    const pain = within(sheet()).getByTestId("after-session-pain");
    expect(pain).toHaveTextContent("Signale-la aussi dans ton prochain check-in");
    const save = within(sheet()).getByRole("button", { name: "Enregistrer ma séance" });
    expect(save).toBeDisabled();
    await user.click(within(pain).getByRole("button", { name: "Oui" }));
    await user.type(within(pain).getByRole("textbox", { name: "Décris ce qui t'a gêné" }), "Genou");
    await user.click(save);
    await waitFor(() => expect(mockedPut.mock.calls[0]![0]).toMatchObject({ change_reason: "pain", new_pain: true, new_pain_note: "Genou" }));
  });

  it("G — effort with words: the chosen value is named, the value sent is the number tapped", async () => {
    expect([0, 2, 4, 5, 7, 9, 10].map(effortLabel)).toEqual(["Aucun effort", "Très facile", "Facile", "Modéré", "Difficile", "Très difficile", "Maximal"]);
    mockedPut.mockResolvedValue(saved({ rpe: 8 }));
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: /^Comme prévu/ }));
    expect(await within(sheet()).findByText("0 · Aucun effort")).toBeInTheDocument();
    await user.click(within(sheet()).getByRole("button", { name: "Ton effort 8 sur 10" }));
    expect(within(sheet()).getByTestId("scale-value-label")).toHaveTextContent("Difficile");
    await user.click(await within(sheet()).findByRole("button", { name: "Non" }));
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));
    await waitFor(() => expect(mockedPut.mock.calls[0]![0]).toMatchObject({ rpe: 8 }));
  });
});

describe("A11 — text fields keep the focus (sheet bug found by A11)", () => {
  it("typing a note keeps every character; the focus stays in the field", async () => {
    const user = userEvent.setup();
    renderEntry();
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Non réalisée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: "Météo / terrain" }));
    const note = within(sheet()).getByRole("textbox", { name: "Un mot de plus ? (facultatif)" });
    await user.type(note, "Orage sur le spot");
    expect(note).toHaveValue("Orage sur le spot");
    expect(document.activeElement).toBe(note);
  });
});

describe("A11 — network-safe", () => {
  async function toSave(user: ReturnType<typeof userEvent.setup>) {
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Non réalisée/ }));
    await user.click(await within(sheet()).findByRole("button", { name: "Météo / terrain" }));
    return within(sheet()).getByRole("button", { name: "Enregistrer ma séance" });
  }

  it("J — a double tap on « Enregistrer » sends once", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedPut.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderEntry();
    const save = await toSave(user);
    await user.dblClick(save);
    expect(mockedPut).toHaveBeenCalledTimes(1);
    resolve(saved({ completion_status: "skipped", change_reason: "weather_terrain" }));
    expect(await screen.findByRole("heading", { name: /Séance enregistrée/ })).toBeInTheDocument();
    expect(mockedPut).toHaveBeenCalledTimes(1);
  });

  it("a failed send then closing the sheet: reopening finds the same answers at the same step", async () => {
    mockedPut.mockResolvedValueOnce({ ok: false, error: { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" } });
    const user = userEvent.setup();
    renderEntry();
    await user.click(await toSave(user));
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent("Problème de connexion");
    await user.click(within(sheet()).getByRole("button", { name: "Fermer" }));
    await open(user);
    expect(await within(sheet()).findByRole("button", { name: "Météo / terrain" })).toHaveAttribute("aria-pressed", "true");
    mockedPut.mockResolvedValueOnce(saved({ completion_status: "skipped", change_reason: "weather_terrain" }));
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));
    expect(await screen.findByRole("heading", { name: /Séance enregistrée/ })).toBeInTheDocument();
    expect(mockedPut.mock.calls[1]![0]).toEqual(mockedPut.mock.calls[0]![0]);
  });

  it("K — after a success, a reload reads the recorded debrief (no blank form)", async () => {
    mockedGet.mockResolvedValue(saved({ completion_status: "skipped", change_reason: "weather_terrain" }));
    renderEntry();
    expect(await screen.findByRole("heading", { name: /Séance enregistrée/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raconter ma séance →" })).toBeNull();
  });

  it("a read failure is an error with « Réessayer » (never an endless skeleton), the retry reads again", async () => {
    mockedLoadGuided.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("none");
    const user = userEvent.setup();
    renderEntry();
    await user.click(await screen.findByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: "Raconter ma séance →" })).toBeInTheDocument();
  });
});
