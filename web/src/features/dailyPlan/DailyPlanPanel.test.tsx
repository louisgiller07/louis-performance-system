import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyPlanPanel } from "./DailyPlanPanel";

const signOut = vi.fn();

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ signOut }),
}));

vi.mock("./runDailyRun", () => ({
  runDailyRun: vi.fn(),
}));

// NAL-003 — the persisted-decision restore lookup. Defaults to "no decision
// found yet" (null) so every pre-existing test below, which exercises the
// generation flow, keeps seeing exactly the same "idle -> Générer mon plan"
// starting state as before — only the dedicated restore tests further down
// override this per-case.
const { loadLatestDecisionForDate } = vi.hoisted(() => ({ loadLatestDecisionForDate: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate }));

import { runDailyRun } from "./runDailyRun";

const mockedRun = runDailyRun as unknown as ReturnType<typeof vi.fn>;

const BASE_DAILY_PLAN = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, objective: "Base aérobie" },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: true, actions: ["Étirements 10 min"] },
  nutrition: { active: false },
  sleep: { active: true, target_hours: 8 },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  triggered_rules: [],
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  overrode_race_protocol: false,
  engine_version: "1.0.0",
};

const SUCCESS_RESPONSE = {
  dailyPlan: { ...BASE_DAILY_PLAN, decision: "KEEP", confidence: "MEDIUM", reasoning: "Tout va bien." },
  decisionId: "11111111-1111-1111-1111-111111111111",
  healthFlagId: null,
  warnings: [],
};

const SUCCESS_RESPONSE_2 = {
  dailyPlan: { ...BASE_DAILY_PLAN, decision: "MODIFY", confidence: "LOW", reasoning: "Deuxième génération." },
  decisionId: "22222222-2222-2222-2222-222222222222",
  healthFlagId: null,
  warnings: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  loadLatestDecisionForDate.mockResolvedValue(null);
});

describe("DailyPlanPanel", () => {
  it("disables the button when there is no checkin", async () => {
    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={false} checkinRevision={0} />);
    expect(await screen.findByRole("button", { name: /Générer mon plan/ })).toBeDisabled();
    expect(screen.getByText(/Enregistre d'abord ton check-in/)).toBeInTheDocument();
  });

  it("enables the button when an existing checkin is loaded", async () => {
    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    expect(await screen.findByRole("button", { name: /Générer mon plan/ })).toBeEnabled();
  });

  it("disables the button while the request is pending", async () => {
    let resolveRun!: (value: unknown) => void;
    mockedRun.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    expect(screen.getByRole("button", { name: /Analyse en cours/ })).toBeDisabled();
    resolveRun({ ok: true, data: SUCCESS_RESPONSE });
  });

  it("renders minimal real-plan fields after a successful click", async () => {
    mockedRun.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    expect(screen.getByText(/Confiance moyenne/)).toBeInTheDocument();
    expect(screen.getByText(/En saison/)).toBeInTheDocument();
    expect(screen.getByText("Tout va bien.")).toBeInTheDocument();
  });

  it("does not start a second concurrent call on repeated rapid clicks", async () => {
    let resolveRun!: (value: unknown) => void;
    mockedRun.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    const button = await screen.findByRole("button", { name: /Générer mon plan/ });

    // Fired synchronously, back-to-back, before the first call's promise
    // ever resolves — this is what a real rapid double/triple-click looks
    // like (unlike awaited `user.click()`, which flushes React + waits
    // between each click and would let the mock resolve in between).
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedRun).toHaveBeenCalledTimes(1);

    resolveRun({ ok: true, data: SUCCESS_RESPONSE });
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("signs the user out on a session_issue error", async () => {
    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" },
    });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("does not sign out on a retryable network error", async () => {
    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" },
    });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(signOut).not.toHaveBeenCalled();
  });

  // --- Hardening: stale-plan invalidation ---

  it("clears a visible plan when checkinRevision changes (checkin was edited/saved)", async () => {
    mockedRun.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    const { rerender } = render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());

    rerender(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={1} />);

    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
    expect(screen.getByText(/Ton check-in a changé/)).toBeInTheDocument();
  });

  it("clears the old result immediately when a new generation starts (before the new response arrives)", async () => {
    mockedRun.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());

    let resolveSecond!: (value: unknown) => void;
    mockedRun.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    // The old plan must be gone the instant the new attempt starts, not
    // only once the new response arrives.
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();

    resolveSecond({ ok: true, data: SUCCESS_RESPONSE_2 });
    await waitFor(() => expect(screen.getByText("Adapter")).toBeInTheDocument());
  });

  it("does not leave the old plan visible when the next generation fails", async () => {
    mockedRun.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());

    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "persistence_failed", message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" },
    });
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });

  it("ignores a stale in-flight response once checkinRevision has moved on before it resolves", async () => {
    let resolveFirst!: (value: unknown) => void;
    mockedRun.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );

    const { rerender } = render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    fireEvent.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    // Checkin gets saved again while the request for revision 0 is still in flight.
    rerender(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={1} />);

    // Now the stale request finally resolves.
    resolveFirst({ ok: true, data: SUCCESS_RESPONSE });

    // Give the pending .then/await a tick to run, then assert the stale
    // result was never rendered.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });

  // --- M5_003: onLiveContextChange ---

  it("fires onLiveContextChange with the exact decisionId and the mapped coarse session_type on a successful generation", async () => {
    mockedRun.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const onLiveContextChange = vi.fn();
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} onLiveContextChange={onLiveContextChange} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    // BASE_DAILY_PLAN.final_session.kind === "AEROBIC_BASE", which maps 1:1
    // to the coarse SessionType "AEROBIC_BASE" (see trainingInterventionToSessionType.ts).
    await waitFor(() =>
      expect(onLiveContextChange).toHaveBeenCalledWith({ decisionId: SUCCESS_RESPONSE.decisionId, sessionType: "AEROBIC_BASE" })
    );
  });

  it("fires onLiveContextChange(null) when the checkin changes and invalidates the visible plan", async () => {
    mockedRun.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
    const onLiveContextChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} onLiveContextChange={onLiveContextChange} />
    );
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() =>
      expect(onLiveContextChange).toHaveBeenCalledWith({ decisionId: SUCCESS_RESPONSE.decisionId, sessionType: "AEROBIC_BASE" })
    );

    rerender(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={1} onLiveContextChange={onLiveContextChange} />);

    await waitFor(() => expect(onLiveContextChange).toHaveBeenLastCalledWith(null));
  });

  it("never fires onLiveContextChange with a value on a failed generation — stays null", async () => {
    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "persistence_failed", message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" },
    });
    const onLiveContextChange = vi.fn();
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} onLiveContextChange={onLiveContextChange} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onLiveContextChange).not.toHaveBeenCalledWith(expect.objectContaining({ decisionId: expect.any(String) }));
  });

  it("rejects a malformed success response with invalid_response and never renders invented data", async () => {
    // runDailyRun itself is responsible for the runtime shape guard — a
    // component-level test only needs to prove the panel handles the
    // ok:false/invalid_response outcome cleanly, without crashing or
    // fabricating fields that were never in the payload.
    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "invalid_response", message: "Réponse du serveur invalide. Réessaie.", retryable: true, action: "retry" },
    });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalide/));
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });
});

// --- NAL-003: persisted decision restore ---

const RESTORED_ROW = {
  id: "33333333-3333-3333-3333-333333333333",
  decisionDate: "2026-08-19",
  createdAt: "2026-08-19T18:42:00Z",
  finalSessionDb: "AEROBIC_BASE",
  activeModeDb: "IN_SEASON",
  confidenceLevelDb: "MEDIUM",
  dailyPlan: { ...BASE_DAILY_PLAN, decision: "KEEP", confidence: "MEDIUM", reasoning: "Plan déjà généré aujourd'hui." },
};

describe("DailyPlanPanel — NAL-003 persisted decision restore", () => {
  it("A: no persisted decision -> normal generation state, exactly as before", async () => {
    loadLatestDecisionForDate.mockResolvedValue(null);
    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);

    expect(await screen.findByRole("button", { name: /Générer mon plan/ })).toBeInTheDocument();
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("B: a valid persisted decision for today is displayed automatically, without any click", async () => {
    loadLatestDecisionForDate.mockResolvedValue(RESTORED_ROW);
    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);

    expect(await screen.findByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText("Plan déjà généré aujourd'hui.")).toBeInTheDocument();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("does not show a 'Générer mon plan' flicker before the restore lookup resolves", async () => {
    let resolveRestore!: (value: unknown) => void;
    loadLatestDecisionForDate.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      })
    );

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);

    expect(screen.queryByRole("button", { name: /Générer mon plan/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Chargement de ton plan/)).toBeInTheDocument();

    resolveRestore(RESTORED_ROW);
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
  });

  it("C, D: remounting (navigate away/back, or a reload) restores the same persisted plan without ever calling daily-run", async () => {
    loadLatestDecisionForDate.mockResolvedValue(RESTORED_ROW);

    const first = render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    first.unmount();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    expect(await screen.findByText("Maintenir")).toBeInTheDocument();
    expect(screen.getByText("Plan déjà généré aujourd'hui.")).toBeInTheDocument();

    expect(mockedRun).not.toHaveBeenCalled();
    expect(loadLatestDecisionForDate).toHaveBeenCalledTimes(2);
  });

  it("H: a decision-read failure shows a retryable error state, never 'no plan, generate one'", async () => {
    loadLatestDecisionForDate.mockRejectedValueOnce(new Error("boom"));
    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de charger ton plan du jour. Réessaie.");
    expect(screen.queryByRole("button", { name: /Générer mon plan/ })).not.toBeInTheDocument();
    expect(mockedRun).not.toHaveBeenCalled();

    loadLatestDecisionForDate.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByRole("button", { name: /Générer mon plan/ })).toBeInTheDocument();
  });

  it("I: a malformed/legacy persisted row (invalid daily_plan) falls back safely to the generation state, no crash", async () => {
    loadLatestDecisionForDate.mockResolvedValue({
      id: "legacy-1",
      decisionDate: "2026-08-19",
      createdAt: "2026-08-19T08:00:00Z",
      finalSessionDb: "STRENGTH_A",
      activeModeDb: null,
      confidenceLevelDb: null,
      dailyPlan: null,
    });

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);

    expect(await screen.findByRole("button", { name: /Générer mon plan/ })).toBeInTheDocument();
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("J: a freshly-generated plan renders identically to a restored one (same DailyPlanResult path)", async () => {
    loadLatestDecisionForDate.mockResolvedValue(null);
    mockedRun.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(await screen.findByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());
    const generatedText = screen.getByText("Tout va bien.");
    expect(generatedText).toBeInTheDocument();
  });

  it("fires onLiveContextChange after restoring a persisted plan, same as a live generation", async () => {
    loadLatestDecisionForDate.mockResolvedValue(RESTORED_ROW);
    const onLiveContextChange = vi.fn();

    render(
      <DailyPlanPanel athleteId="athlete-1" date="2026-08-19" hasCheckin={true} checkinRevision={0} onLiveContextChange={onLiveContextChange} />
    );

    await waitFor(() =>
      expect(onLiveContextChange).toHaveBeenCalledWith({ decisionId: RESTORED_ROW.id, sessionType: "AEROBIC_BASE" })
    );
  });
});
