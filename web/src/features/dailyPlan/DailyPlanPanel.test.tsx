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
});

describe("DailyPlanPanel", () => {
  it("disables the button when there is no checkin", () => {
    render(<DailyPlanPanel date="2026-08-19" hasCheckin={false} checkinRevision={0} />);
    expect(screen.getByRole("button", { name: /Générer mon plan/ })).toBeDisabled();
    expect(screen.getByText(/Enregistre d'abord ton check-in/)).toBeInTheDocument();
  });

  it("enables the button when an existing checkin is loaded", () => {
    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    expect(screen.getByRole("button", { name: /Générer mon plan/ })).toBeEnabled();
  });

  it("disables the button while the request is pending", async () => {
    let resolveRun!: (value: unknown) => void;
    mockedRun.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );
    const user = userEvent.setup();

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    expect(screen.getByRole("button", { name: /Analyse en cours/ })).toBeDisabled();
    resolveRun({ ok: true, data: SUCCESS_RESPONSE });
  });

  it("renders minimal real-plan fields after a successful click", async () => {
    mockedRun.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

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

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    const button = screen.getByRole("button", { name: /Générer mon plan/ });

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

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("does not sign out on a retryable network error", async () => {
    mockedRun.mockResolvedValueOnce({
      ok: false,
      error: { code: "network_error", message: "Problème de connexion. Vérifie ta connexion et réessaie.", retryable: true, action: "retry" },
    });
    const user = userEvent.setup();

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(signOut).not.toHaveBeenCalled();
  });

  // --- Hardening: stale-plan invalidation ---

  it("clears a visible plan when checkinRevision changes (checkin was edited/saved)", async () => {
    mockedRun.mockResolvedValue({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    const { rerender } = render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));
    await waitFor(() => expect(screen.getByText("Maintenir")).toBeInTheDocument());

    rerender(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={1} />);

    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
    expect(screen.getByText(/Ton check-in a changé/)).toBeInTheDocument();
  });

  it("clears the old result immediately when a new generation starts (before the new response arrives)", async () => {
    mockedRun.mockResolvedValueOnce({ ok: true, data: SUCCESS_RESPONSE });
    const user = userEvent.setup();

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));
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

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));
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

    const { rerender } = render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    fireEvent.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    // Checkin gets saved again while the request for revision 0 is still in flight.
    rerender(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={1} />);

    // Now the stale request finally resolves.
    resolveFirst({ ok: true, data: SUCCESS_RESPONSE });

    // Give the pending .then/await a tick to run, then assert the stale
    // result was never rendered.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
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

    render(<DailyPlanPanel date="2026-08-19" hasCheckin={true} checkinRevision={0} />);
    await user.click(screen.getByRole("button", { name: /Générer mon plan/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalide/));
    expect(screen.queryByText("Maintenir")).not.toBeInTheDocument();
  });
});
