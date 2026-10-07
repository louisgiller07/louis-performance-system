import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { AfterSessionEntry } from "./AfterSessionEntry";

// UX-08 — the after-session moment as the rider meets it: short steps,
// one-tap answers, then what NALYNT keeps. Payload contracts are proven in
// useCompletedSessionFlow.test.tsx; here, the steps, the words and the
// summary.

const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut }) }));
vi.mock("../completedSession/completedSessionRepo", () => ({ getCompletedSession: vi.fn(), putCompletedSession: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadValidDecisionsForDate: vi.fn(), loadGuidedDayState: vi.fn(async () => "none") }));

import { getCompletedSession, putCompletedSession } from "../completedSession/completedSessionRepo";
import { loadGuidedDayState, loadValidDecisionsForDate } from "../history/historyRepo";

const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedPut = putCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedLoadDecisions = loadValidDecisionsForDate as unknown as ReturnType<typeof vi.fn>;
const mockedLoadGuided = loadGuidedDayState as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-09-29";

function decisionRow(id: string, finalSession: { kind: string; load_profile?: string; duration_min?: number }, executionTask?: string) {
  return {
    id,
    decisionDate: DATE,
    createdAt: "2026-09-29T07:10:00Z",
    finalSessionDb: "DH_TECHNICAL",
    activeModeDb: "IN_SEASON",
    confidenceLevelDb: "MEDIUM",
    dailyPlan: {
      decision: "KEEP",
      confidence: "MEDIUM",
      reasoning: "Plan.",
      active_mode: "IN_SEASON",
      training: { active: true },
      dh_or_technical: executionTask ? { active: true, execution_task: executionTask } : { active: false },
      mental: { active: false },
      recovery: { active: true, actions: [] },
      nutrition: { active: false },
      sleep: { active: false },
      protection: { do_not_do: [] },
      monitoring: { observe: [] },
      triggered_rules: [],
      planned_session_before: null,
      final_session: finalSession,
      overrode_race_protocol: false,
      engine_version: "test",
    },
  };
}

const DH = decisionRow("d-a", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 });

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs-1",
    session_date: DATE,
    decision_id: "d-a",
    session_type: "DH_TECHNICAL",
    completion_status: "done",
    actual_duration_min: 85,
    rpe: 6,
    post_leg_fatigue: 5,
    post_grip_fatigue: 3,
    new_pain: false,
    new_pain_note: null,
    intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
    main_content: null,
    session_load: 51,
    updated_at: "2026-09-29T18:00:00Z",
    technical_outcome: null,
    change_reason: null,
    change_reason_note: null,
    ...overrides,
  };
}

const plain = (text: string | null | undefined) => (text ?? "").replace(/ /g, " ");

function sheet() {
  return screen.getByRole("dialog", { name: "Après ta séance" });
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Raconter ma séance →" }));
  return sheet();
}

async function stepTitle(title: string) {
  await waitFor(() => expect(within(sheet()).getByRole("heading", { level: 2 })).toHaveTextContent(title));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedGet.mockResolvedValue({ ok: true, data: null });
  mockedLoadDecisions.mockResolvedValue([DH]);
  mockedLoadGuided.mockResolvedValue("none");
});

describe("AfterSessionEntry — the invitation", () => {
  it("no session recorded yet: 'Ta séance est faite ?' and one action", async () => {
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    expect(await screen.findByRole("heading", { name: "Ta séance est faite ?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raconter ma séance →" })).toBeInTheDocument();
    expect(screen.getByText("Après ta séance")).toBeInTheDocument();
  });
});

describe("AfterSessionEntry — the steps", () => {
  it("A11 — a completed session in 5 taps: Terminée → Comme prévu → effort → Non → Enregistrer (no body: M1 does not read it for a done session)", async () => {
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: record({ actual_duration_min: 90, post_leg_fatigue: null, post_grip_fatigue: null }), warnings: [] } });
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);

    await stepTitle("Ta séance");
    expect(within(sheet()).getByText("Séance terminée ?")).toBeInTheDocument();
    const taps: string[] = [];
    const tap = async (name: string | RegExp) => {
      taps.push(String(name));
      await user.click(within(sheet()).getByRole("button", { name }));
    };

    await tap(/Terminée/);
    await waitFor(() => expect(within(sheet()).getByText("Ce que tu as fait.")).toBeInTheDocument());
    expect(within(sheet()).getByText(/Plan du jour/)).toBeInTheDocument();
    expect(within(sheet()).getByText("Temps total de la session, remontées, pauses et attente comprises.")).toBeInTheDocument();
    await tap(/^Comme prévu · 1.h.30$/);
    await stepTitle("Ton effort");
    await tap("Ton effort 6 sur 10");
    await waitFor(() => expect(within(sheet()).getByText("Un signal physique à retenir ?")).toBeInTheDocument());
    await tap("Non");
    await tap("Enregistrer ma séance");

    expect(taps).toHaveLength(5);
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0]![0]).toMatchObject({
      decision_id: "d-a",
      completion_status: "done",
      intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
      actual_duration_min: 90,
      rpe: 6,
      post_leg_fatigue: null,
      post_grip_fatigue: null,
      new_pain: false,
    });
    expect(await screen.findByRole("heading", { name: /Séance enregistrée/ })).toBeInTheDocument();
    // A hidden dialog has no accessible name: found by its label attribute.
    expect(document.querySelector('[role="dialog"][aria-label="Après ta séance"]')).toHaveAttribute("hidden");
  });

  it("partial: no 'Comme prévu' — the duration is set with −/+ — then what changed", async () => {
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: record({ completion_status: "partial" }), warnings: [] } });
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);

    await user.click(within(sheet()).getByRole("button", { name: /Partiellement/ }));
    await waitFor(() => expect(within(sheet()).getByRole("button", { name: "Plus 5 minutes" })).toBeInTheDocument());
    expect(within(sheet()).queryByRole("button", { name: /Comme prévu/ })).not.toBeInTheDocument();
    await user.click(within(sheet()).getByRole("button", { name: "Moins 5 minutes" }));
    expect(within(sheet()).getByRole("spinbutton")).toHaveValue(55);
    await user.click(within(sheet()).getByRole("button", { name: "Continuer" }));

    await stepTitle("Ce qui a changé");
    expect(within(sheet()).getByText("Qu'est-ce qui a changé pendant ta séance ?")).toBeInTheDocument();
    expect(within(sheet()).getByRole("button", { name: "Continuer" })).toBeDisabled();
    await user.click(within(sheet()).getByRole("button", { name: "Fatigue ou perte de contrôle" }));
    expect(within(sheet()).getByRole("button", { name: "Continuer" })).toBeEnabled();
  });

  it("A11 E — not done: Non réalisée → why → Enregistrer (3 taps); never a failure, no duration, effort, body or signal", async () => {
    mockedPut.mockResolvedValue({ ok: true, data: { completedSession: record({ completion_status: "skipped", intervention: null, actual_duration_min: null, rpe: null, post_leg_fatigue: null, post_grip_fatigue: null, change_reason: "weather_terrain" }), warnings: [] } });
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);

    await user.click(within(sheet()).getByRole("button", { name: /Non réalisée/ }));
    await stepTitle("Ce qui s'est passé");
    expect(within(sheet()).getByText("Qu'est-ce qui a changé aujourd'hui ?")).toBeInTheDocument();
    expect(within(sheet()).getByTestId("after-session-progress")).toHaveTextContent("Étape 2 / 2");
    expect(within(sheet()).queryByText("Durée")).not.toBeInTheDocument();
    await user.click(within(sheet()).getByRole("button", { name: "Météo / terrain" }));
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0]![0]).toMatchObject({ completion_status: "skipped", session_type: "DH_TECHNICAL", decision_id: "d-a", intervention: null, actual_duration_min: null, rpe: null, post_leg_fatigue: null, post_grip_fatigue: null, new_pain: false, change_reason: "weather_terrain" });
    expect(document.body.textContent).not.toMatch(/Pourquoi tu n'as pas|tu n'as pas fait|empêché|échec/);
  });

  it("the NALYNT stop criterion is offered only when the session is linked to the plan", async () => {
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Partiellement/ }));
    await waitFor(() => expect(within(sheet()).getByRole("button", { name: "Ce n'était pas ce plan" })).toBeInTheDocument());
    await user.click(within(sheet()).getByRole("button", { name: "Ce n'était pas ce plan" }));
    expect(within(sheet()).getByText("Séance libre, sans lien avec le plan du jour.")).toBeInTheDocument();
    await user.click(within(sheet()).getByRole("button", { name: "Plus 5 minutes" }));
    await user.click(within(sheet()).getByRole("button", { name: "Continuer" }));
    await stepTitle("Ce qui a changé");
    expect(within(sheet()).queryByRole("button", { name: "Critère de réduction / arrêt atteint" })).not.toBeInTheDocument();
  });

  it("a physical signal needs a few words before saving", async () => {
    const user = userEvent.setup();
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", { kind: "REST" })]);
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    await waitFor(() => expect(within(sheet()).getByText("Ce que tu as fait.")).toBeInTheDocument());
    await user.click(within(sheet()).getByRole("button", { name: "Continuer" }));
    await user.click(within(sheet()).getByRole("button", { name: "Oui" }));
    const save = within(sheet()).getByRole("button", { name: "Enregistrer ma séance" });
    expect(save).toBeDisabled();
    await user.type(within(sheet()).getByRole("textbox", { name: "Décris ce qui t'a gêné" }), "Poignet droit");
    expect(save).toBeEnabled();
  });

  it("A11 H — a save error is visible, the answers stay, « Réessayer » sends the same answers again and succeeds", async () => {
    mockedPut
      .mockResolvedValueOnce({ ok: false, error: { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" } })
      .mockResolvedValueOnce({ ok: true, data: { completedSession: record({ intervention: { kind: "REST" }, session_type: "REST", actual_duration_min: null, rpe: null }), warnings: [] } });
    mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", { kind: "REST" })]);
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    await waitFor(() => expect(within(sheet()).getByText("Ce que tu as fait.")).toBeInTheDocument());
    await user.click(within(sheet()).getByRole("button", { name: "Continuer" }));
    await user.click(within(sheet()).getByRole("button", { name: "Non" }));
    await user.click(within(sheet()).getByRole("button", { name: "Enregistrer ma séance" }));

    expect(await within(sheet()).findByRole("alert")).toHaveTextContent("Problème de connexion. Vérifie ta connexion et réessaie.");
    expect(within(sheet()).getByRole("button", { name: "Non" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet()).getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(2));
    expect(mockedPut.mock.calls[1]![0]).toEqual(mockedPut.mock.calls[0]![0]);
    expect(await screen.findByRole("heading", { name: /Séance enregistrée/ })).toBeInTheDocument();
  });

  it("never shows 'RPE', 'grip' or a raw identifier", async () => {
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await open(user);
    await user.click(within(sheet()).getByRole("button", { name: /Terminée/ }));
    await waitFor(() => expect(within(sheet()).getByText("Ce que tu as fait.")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/RPE|grip|[A-Z]{2,}_[A-Z]/);
  });
});

describe("AfterSessionEntry — what NALYNT keeps", () => {
  it("a recorded session: 'Séance enregistrée ✓', Prévu → Réalisé, effort, body, the promise", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record() });
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);

    const summary = await screen.findByRole("region", { name: /Séance enregistrée/ });
    expect(within(summary).getByText("NALYNT garde cette information pour adapter la suite.")).toBeInTheDocument();
    await waitFor(() => expect(within(summary).getByText("Prévu")).toBeInTheDocument());
    const rows = [...summary.querySelectorAll("dl > div")].map((row) => plain(row.textContent));
    expect(rows).toEqual(["PrévuDH technique · charge modérée · 1 h 30", "RéaliséDH technique · charge modérée · 1 h 25", "Ton effort6/10", "Ton corpsJambes 5/10 · Avant-bras 3/10"]);
    expect(within(summary).getByText("Ton objectif reste.", { exact: false })).toBeInTheDocument();
    expect(within(summary).getByText("Ton plan s'adapte.")).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/bonne séance|mauvaise séance|performance|score|%/i);
  });

  it("a not-done session reads 'Séance · Non réalisée' with what prevented it", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record({ completion_status: "skipped", intervention: null, actual_duration_min: null, rpe: null, change_reason: "time_life" }) });
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    const summary = await screen.findByRole("region", { name: /Séance enregistrée/ });
    const rows = [...summary.querySelectorAll("dl > div")].map((row) => plain(row.textContent));
    expect(rows).toContain("SéanceNon réalisée");
    expect(rows).toContain("Ce qui a changé aujourd'huiManque de temps / contrainte perso");
  });

  it("a physical signal is recalled neutrally, never as a warning", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record({ new_pain: true, new_pain_note: "Genou" }) });
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    const note = await screen.findByText("Genou");
    const box = note.closest("div")!;
    expect(within(box).getByText("Signal physique")).toBeInTheDocument();
    expect(within(box).getByText("Pense à le mentionner dans ton prochain check-in.")).toBeInTheDocument();
    expect(box.className).not.toMatch(/red/);
  });

  it("'Modifier' reopens the steps with the recorded answers", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record() });
    const user = userEvent.setup();
    render(<AfterSessionEntry date={DATE} athleteId="athlete-1" />);
    await user.click(await screen.findByRole("button", { name: "Modifier" }));
    await stepTitle("Ta séance");
    expect(within(sheet()).getByRole("button", { name: /Terminée/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet()).getByRole("button", { name: "Continuer" })).toBeEnabled();
  });
});

describe("AfterSessionEntry — UX-11R.9 a day completed as a guided session", () => {
  const renderEntry = () =>
    render(
      <MemoryRouter>
        <AfterSessionEntry date={DATE} athleteId="athlete-1" />
      </MemoryRouter>
    );

  it("no legacy record: 'Séance guidée terminée' + read-only link, never the 'Raconter ma séance' invitation", async () => {
    mockedLoadGuided.mockResolvedValue("completed");
    renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée terminée" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir la séance guidée" })).toHaveAttribute("href", "/today/session");
    expect(screen.queryByRole("button", { name: "Raconter ma séance →" })).not.toBeInTheDocument();
    expect(mockedLoadGuided).toHaveBeenCalledWith("athlete-1", DATE);
  });

  it("an existing legacy record stays readable but can no longer be edited", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record() });
    mockedLoadGuided.mockResolvedValue("completed");
    renderEntry();
    expect(await screen.findByText(/Séance enregistrée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("F-5d — a legacy `skipped` record yields to a completed guided session: the guided card, never 'non réalisée'", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: record({ completion_status: "skipped", actual_duration_min: null, rpe: null, post_leg_fatigue: null, post_grip_fatigue: null, intervention: null }) });
    mockedLoadGuided.mockResolvedValue("completed");
    renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée terminée" })).toBeInTheDocument();
    expect(screen.queryByText(/Non réalisée/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("F-5b — an OPEN guided session: 'Séance guidée en cours' + link to resume it, never the legacy invitation", async () => {
    mockedLoadGuided.mockResolvedValue("open");
    renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée en cours" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reprendre la séance guidée" })).toHaveAttribute("href", "/today/session");
    expect(screen.queryByRole("button", { name: "Raconter ma séance →" })).not.toBeInTheDocument();
  });

  it("no guided completion: the legacy invitation is unchanged", async () => {
    renderEntry();
    expect(await screen.findByRole("button", { name: "Raconter ma séance →" })).toBeInTheDocument();
  });
});
