import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompletedSessionCard } from "./CompletedSessionCard";

const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ signOut }),
}));

vi.mock("./completedSessionRepo", () => ({
  getCompletedSession: vi.fn(),
  putCompletedSession: vi.fn(),
}));

vi.mock("../history/historyRepo", () => ({
  loadValidDecisionsForDate: vi.fn(),
}));

import { getCompletedSession, putCompletedSession } from "./completedSessionRepo";
import { loadValidDecisionsForDate } from "../history/historyRepo";

const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedPut = putCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedLoadDecisions = loadValidDecisionsForDate as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-08-12";
const ATHLETE_ID = "athlete-1";

const EXISTING_RECORD = {
  id: "cs-1",
  session_date: DATE,
  decision_id: null,
  session_type: "RECOVERY",
  completion_status: "done",
  actual_duration_min: 42,
  rpe: 7,
  post_leg_fatigue: 4,
  post_grip_fatigue: 3,
  new_pain: false,
  new_pain_note: null,
  intervention: { kind: "RECOVERY_ACTIVE" },
  main_content: { free_text: "notes" },
  session_load: 29.4,
  updated_at: "2026-08-12T20:00:00.000Z",
};

/** A minimal DailyPlan shape that passes isValidDailyPlan, matching historyRepo.test.ts's own fixture pattern. */
function validDailyPlan(finalSession: { kind: string; load_profile?: string; duration_min?: number }) {
  return {
    decision: "KEEP",
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
    planned_session_before: null,
    final_session: finalSession,
    overrode_race_protocol: false,
    engine_version: "test",
  };
}

function decisionRow(id: string, createdAt: string, finalSession: { kind: string; load_profile?: string }) {
  return { id, decisionDate: DATE, createdAt, finalSessionDb: "AEROBIC_BASE", activeModeDb: "IN_SEASON", confidenceLevelDb: "MEDIUM", dailyPlan: validDailyPlan(finalSession) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedGet.mockResolvedValue({ ok: true, data: null });
  mockedLoadDecisions.mockResolvedValue([]);
});

describe("CompletedSessionCard", () => {
  it("shows the empty state (\"Comment s'est passée ta séance ?\" + \"Enregistrer la séance\") when no row exists", async () => {
    render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

    expect(await screen.findByText("Comment s'est passée ta séance ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer la séance" })).toBeInTheDocument();
  });

  it("shows a filled summary with the rich performed activity label when a row exists", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
    render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

    expect(await screen.findByText("Faite")).toBeInTheDocument();
    expect(screen.getByText("Récupération active")).toBeInTheDocument(); // rich label, not the coarse "Récupération"
    expect(screen.getByText("42 min")).toBeInTheDocument();
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
  });

  it("falls back to the coarse label in view mode for a legacy row with no rich intervention", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, intervention: null } });
    render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

    expect(await screen.findByText("Récupération")).toBeInTheDocument();
  });

  describe("pain reminder — neutral, informational only (never a Safety-processed warning)", () => {
    it("shows the neutral pain reminder only when new_pain is true", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, new_pain: true, new_pain_note: "Genou" } });
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      expect(await screen.findByText("Tu as indiqué une nouvelle douleur.")).toBeInTheDocument();
      expect(screen.getByText("Genou")).toBeInTheDocument();
      expect(
        screen.getByText("Pense à la mentionner dans ton prochain check-in afin qu'elle fasse partie des informations de readiness.")
      ).toBeInTheDocument();
    });

    it("never uses warning/red styling for the pain reminder", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, new_pain: true, new_pain_note: "Genou" } });
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      const reminder = (await screen.findByText("Tu as indiqué une nouvelle douleur.")).closest("div");
      expect(reminder?.className).not.toMatch(/red/);
    });
  });

  // V0.3_007B — decision linkage: 0/1/2+ same-day valid decisions.
  describe("decision linkage (V0.3_007B)", () => {
    it("A (§35 one plan, final review): exactly one valid decision -> auto-linked AND visible, no forced extra tap", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      // Visible and pre-selected — never silently hidden just because there's only one candidate.
      const selector = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      expect(selector).toHaveValue("d-a");
      // §6 prefill: done defaults to the linked prescription.
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");
      // No forced extra tap: Save isn't blocked by the link (only by the rest of the form).
      await fillRestOfValidDoneForm(user);
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "d-a", intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } });
    });

    it("Issue A acceptance: a free session performed without following the single same-day plan clears the link, keeps the performed activity intact", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T15:00:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      const selector = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      expect(selector).toHaveValue("d-a");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");

      // Athlete corrects the truthful reality: they did a session, but not this plan.
      await user.selectOptions(selector, "Aucun de ces plans / séance libre");
      expect(selector).toHaveValue("__none__");
      // The already-prefilled performed activity is NOT wiped by unlinking.
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");
      // completion_status stays whatever it was — never forced to "replaced"
      // just because a DailyPlan happened to exist that day.
      expect(screen.getByDisplayValue("Faite")).toBeInTheDocument();

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        decision_id: null,
        completion_status: "done",
        intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" },
      });
    });

    it("zero valid decisions -> decision_id null, no selector, no prefill", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      expect(screen.queryByText("Quel plan as-tu suivi ?")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("");

      await pickPerformedKind(user, "REST");
      await user.click(screen.getByRole("button", { name: "Non" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null });
    });

    it("B (§36 multiple plans): 2+ valid decisions -> selector visible, no preselection, Save disabled until an explicit choice", async () => {
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "AEROBIC_BASE", load_profile: "LIGHT" }),
      ]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      const selector = await screen.findByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      expect(selector).toHaveValue("");

      await fillRestOfValidDoneForm(user);
      await pickPerformedKind(user, "DH_PERFORMANCE");
      await pickLoad(user, "charge lourde");
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

      await user.selectOptions(selector, "d-a");
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      // §38 requirement mirrored here: the chosen (A), not the newer (B).
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "d-a" });
    });

    it("C (§37 none of these): explicitly choosing 'Aucun de ces plans' with 2+ decisions stores decision_id null", async () => {
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "AEROBIC_BASE", load_profile: "LIGHT" }),
      ]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      const selector = await screen.findByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      await user.selectOptions(selector, "Aucun de ces plans / séance libre");

      await pickPerformedKind(user, "STRENGTH_LOWER");
      await pickLoad(user, "charge lourde");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null });
    });

    it("selecting a decision prefills the performed activity ONLY while it's still empty — a later plan switch never overwrites it (V0.3_007B hotfix)", async () => {
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "AEROBIC_BASE", load_profile: "LIGHT" }),
      ]);
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      const selector = await screen.findByRole("combobox", { name: "Quel plan as-tu suivi ?" });

      // §11: empty performed activity -> convenience prefill from the selected decision.
      await user.selectOptions(selector, "d-a");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");

      // §12/hotfix: performed activity is now non-empty (even though it only
      // got there via a prior prefill, not manual typing) -> switching to a
      // DIFFERENT decision must NOT overwrite it. Prefill is a convenience
      // for an empty field only, never authoritative over what's displayed.
      await user.selectOptions(selector, "d-b");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");
    });

    it("hotfix §10 (confirmed production bug): entering a performed activity THEN selecting a decision never overwrites or clears it", async () => {
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" }),
      ]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "replaced");
      await pickPerformedKind(user, "PUMPTRACK");
      await pickLoad(user, "charge modérée");
      const performedSelect = screen.getByRole("combobox", { name: /Activité réellement effectuée/ });
      expect(performedSelect).toHaveValue("PUMPTRACK"); // BEFORE

      const selector = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      await user.selectOptions(selector, "d-a");
      expect(performedSelect).toHaveValue("PUMPTRACK"); // AFTER — no overwrite, this was the confirmed prod bug

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        decision_id: "d-a",
        completion_status: "replaced",
        intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" },
      });
    });

    it("hotfix §12: switching from decision A to decision B preserves an already-entered performed activity", async () => {
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" }),
      ]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "replaced");
      await pickPerformedKind(user, "PUMPTRACK");
      await pickLoad(user, "charge modérée");
      const performedSelect = screen.getByRole("combobox", { name: /Activité réellement effectuée/ });

      const selector = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      await user.selectOptions(selector, "d-a");
      expect(performedSelect).toHaveValue("PUMPTRACK");

      await user.selectOptions(selector, "d-b");
      expect(performedSelect).toHaveValue("PUMPTRACK"); // only the prescription association changes

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "d-b", intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" } });
    });

    it("hotfix §13: clearing the link to 'Aucun plan / séance libre' preserves an already-entered performed activity", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      // Single decision auto-links and prefills DH_PERFORMANCE; athlete overrides to what actually happened.
      const performedSelect = screen.getByRole("combobox", { name: /Activité réellement effectuée/ });
      expect(performedSelect).toHaveValue("DH_PERFORMANCE");
      await pickPerformedKind(user, "PUMPTRACK");
      await pickLoad(user, "charge modérée");

      const selector = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      await user.selectOptions(selector, "Aucun de ces plans / séance libre");
      expect(performedSelect).toHaveValue("PUMPTRACK");

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null, intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" } });
    });

    it("hotfix §14: a DONE/plan mismatch is still rejected by the server; switching to REPLACED (which still requires explicit re-entry, unchanged) then saves the real performed truth", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      // done prefilled DH_PERFORMANCE from the link; athlete corrects it to what actually happened.
      await pickPerformedKind(user, "PUMPTRACK");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);

      mockedPut.mockResolvedValueOnce({
        ok: false,
        error: {
          code: "decision_session_mismatch",
          message: "Le statut et le type de séance ne correspondent pas à la séance liée.",
          retryable: false,
          action: "user_fixable",
        },
      });
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/ne correspondent pas/));
      // Rejected — never silently accepted, and the performed truth stays exactly as entered.
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("PUMPTRACK");

      // Switching to REPLACED still never prefills (pre-existing, unchanged
      // behavior — "replaced" always requires an explicit fresh record of
      // what actually happened, proven already by test G above). The
      // athlete re-enters the same real truth.
      await user.selectOptions(screen.getByDisplayValue("Faite"), "replaced");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("");
      await pickPerformedKind(user, "PUMPTRACK");
      await pickLoad(user, "charge modérée");

      mockedPut.mockResolvedValueOnce({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(2));
      expect(mockedPut.mock.calls[1]![0]).toMatchObject({
        completion_status: "replaced",
        decision_id: "d-a",
        intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" },
      });
    });

    it("D (§38 edit existing link): editing preserves the persisted decision_id by default, correcting it never re-prefills the already-recorded activity", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, decision_id: "d-a", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } } });
      mockedLoadDecisions.mockResolvedValue([
        decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" }),
        decisionRow("d-b", "2026-08-12T14:30:00Z", { kind: "AEROBIC_BASE", load_profile: "LIGHT" }),
      ]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Modifier" }));
      const selector = await screen.findByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      expect(selector).toHaveValue("d-a");
      // The already-recorded performed activity (STRENGTH_LOWER) is untouched by the persisted link, never silently replaced by d-a's own DH_PERFORMANCE prescription.
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("STRENGTH_LOWER");

      await user.selectOptions(selector, "d-b");
      expect(selector).toHaveValue("d-b");
      // Correcting the link must not retroactively change the performed activity either.
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("STRENGTH_LOWER");

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "d-b", intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" } });
    });

    it("a failed decision lookup never blocks logging a session — shows a soft notice, decision_id stays null", async () => {
      mockedLoadDecisions.mockRejectedValue(new Error("boom"));
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      expect(await screen.findByText(/Impossible de vérifier les plans du jour/)).toBeInTheDocument();

      await pickPerformedKind(user, "REST");
      await user.click(screen.getByRole("button", { name: "Non" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null });
    });
  });

  // V0.3_007B — REV-003: rich performed activity, never a coarse guess.
  describe("rich performed activity (REV-003)", () => {
    it("E (§31 strength collision): STRENGTH_LOWER round-trips exactly, never collapsed to the shared coarse bucket alone", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await pickPerformedKind(user, "STRENGTH_LOWER");
      await pickLoad(user, "charge lourde");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        intervention: { kind: "STRENGTH_LOWER", load_profile: "HEAVY" },
        session_type: "STRENGTH_A",
      });
    });

    it("(§30 PUMPTRACK) no prescription: PUMPTRACK is selectable and round-trips exactly, coarse projection is DH_TECHNICAL", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await pickPerformedKind(user, "PUMPTRACK"); // load-variable kind — requires an intensity
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        intervention: { kind: "PUMPTRACK", load_profile: "MODERATE" },
        session_type: "DH_TECHNICAL",
      });
    });

    it("RACE_ACTIVITY is selectable as a performed activity (never plannable, but a valid reality)", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await pickPerformedKind(user, "RACE_ACTIVITY");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ intervention: { kind: "RACE_ACTIVITY" }, session_type: "RACE_PREP" });
    });

    it("F (§32 skipped, §6/§8 final review): a HEAVY-prescribed session recorded as skipped never carries a performed intervention, and the coarse type is derived+locked while linked", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");
      expect(screen.queryByRole("combobox", { name: /Activité réellement effectuée/ })).not.toBeInTheDocument();
      const skippedTypeSelect = screen.getByRole("combobox", { name: /Type de séance non faite/ });
      // §6: defaulted from the linked decision's prescription — no re-entry required.
      expect(skippedTypeSelect).toHaveValue("DH_PERFORMANCE");
      // Issue B final semantic proof: DERIVED, not independently editable while linked.
      expect(skippedTypeSelect).toBeDisabled();
      expect(screen.getByText(/Dérivé du plan lié/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Non" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        decision_id: "d-a",
        intervention: null,
        session_type: "DH_PERFORMANCE",
      });
    });

    it("Issue B acceptance (§6): unlinking a locked SKIPPED type via 'Aucun de ces plans / séance libre' makes the manual picker available again", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");

      const decisionSelect = screen.getByRole("combobox", { name: "Quel plan as-tu suivi ?" });
      const skippedTypeSelect = screen.getByRole("combobox", { name: /Type de séance non faite/ });
      expect(skippedTypeSelect).toHaveValue("DH_PERFORMANCE");
      expect(skippedTypeSelect).toBeDisabled();

      await user.selectOptions(decisionSelect, "Aucun de ces plans / séance libre");
      expect(decisionSelect).toHaveValue("__none__");
      // Unlinking clears the derived value entirely — forces an explicit fresh manual choice.
      expect(skippedTypeSelect).toHaveValue("");
      expect(skippedTypeSelect).toBeEnabled();
      expect(screen.queryByText(/Dérivé du plan lié/)).not.toBeInTheDocument();

      await user.selectOptions(skippedTypeSelect, "AEROBIC_BASE");
      await user.click(screen.getByRole("button", { name: "Non" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null, intervention: null, session_type: "AEROBIC_BASE" });
    });

    it("§9: skipped with NO linked decision requires an explicit coarse choice, decision_id stays null", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");
      expect(screen.getByRole("combobox", { name: /Type de séance non faite/ })).toHaveValue("");
      await user.selectOptions(screen.getByRole("combobox", { name: /Type de séance non faite/ }), "DH_PERFORMANCE");
      await user.click(screen.getByRole("button", { name: "Non" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null, intervention: null, session_type: "DH_PERFORMANCE" });
    });

    it("G (§33 replaced): replaced never prefills from the prescription, the athlete must explicitly pick the real replacement", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_LIGHT", load_profile: "LIGHT" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_LIGHT"); // done prefilled it

      await user.selectOptions(screen.getByDisplayValue("Faite"), "replaced");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue(""); // cleared, never kept DH_LIGHT

      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ intervention: { kind: "AEROBIC_BASE", load_profile: "MODERATE" } });
    });

    it("H (§34 partial): partial keeps the prescribed prefill and counts once, no fractional anything", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "DH_PERFORMANCE", load_profile: "HEAVY" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "partial");
      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("DH_PERFORMANCE");

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ completion_status: "partial", intervention: { kind: "DH_PERFORMANCE", load_profile: "HEAVY" } });
    });
  });

  describe("status-dependent field visibility", () => {
    it("hides duration/RPE for skipped, shows them for done", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      expect(screen.getByText("Durée (minutes)")).toBeInTheDocument();
      expect(screen.getByText("Effort global ressenti")).toBeInTheDocument();

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");

      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();
      expect(screen.queryByText("Effort global ressenti")).not.toBeInTheDocument();
    });

    it("hides duration/RPE for a REST performed activity — never an invented training load", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await pickPerformedKind(user, "REST");

      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();
      expect(screen.queryByText("Effort global ressenti")).not.toBeInTheDocument();
    });

    it("Save becomes valid for REST without any duration/RPE — just status, activity, pain answered", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await pickPerformedKind(user, "REST");
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Non" })); // new_pain = false
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        session_type: "REST",
        actual_duration_min: null,
        rpe: null,
      });
    });

    it("prescribed REST prefills REST with no duration/RPE required", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "REST" })]);
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      expect(screen.getByRole("combobox", { name: /Activité réellement effectuée/ })).toHaveValue("REST");
      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Non" }));
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
    });
  });

  describe("pain wording", () => {
    it("uses session-context wording for done/partial/replaced", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      expect(screen.getByText("Une nouvelle douleur pendant ou après la séance ?")).toBeInTheDocument();
    });

    it("uses day-context wording for skipped", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");

      expect(screen.getByText("Une nouvelle douleur aujourd'hui ?")).toBeInTheDocument();
    });

    it("shows the note textarea only when new_pain is answered Oui", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      expect(screen.queryByLabelText("Décris la douleur")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Oui" }));
      expect(screen.getByLabelText("Décris la douleur")).toBeInTheDocument();
    });
  });

  describe("save gating", () => {
    it("Save is disabled until the form is fully valid", async () => {
      mockedLoadDecisions.mockResolvedValue([decisionRow("d-a", "2026-08-12T10:05:00Z", { kind: "AEROBIC_BASE", load_profile: "MODERATE" })]);
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));

      // performed_kind is prefilled (single decision), but duration/RPE/fatigues/new_pain are still empty.
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

      await fillRestOfValidDoneForm(user);
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
    });
  });

  describe("save outcomes", () => {
    it("save success replaces the form with the persisted summary", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(screen.getByText("Faite")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    });

    it("a 422 decision_link_invalid error is shown and the form is preserved", async () => {
      mockedPut.mockResolvedValue({
        ok: false,
        error: {
          code: "decision_link_invalid",
          message: "La décision liée n'est plus valide pour cette date. Recharge la page et réessaie.",
          retryable: false,
          action: "user_fixable",
        },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/décision liée/));
      expect(screen.getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
      expect(signOut).not.toHaveBeenCalled();
    });

    it("a 500 retryable error is shown and the form is preserved for retry", async () => {
      mockedPut.mockResolvedValueOnce({
        ok: false,
        error: { code: "persistence_failed", message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Erreur d'enregistrement/));
      expect(screen.getByDisplayValue("42")).toBeInTheDocument();

      mockedPut.mockResolvedValueOnce({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(screen.getByText("Faite")).toBeInTheDocument());
    });

    it("a 401 session_issue error on save calls signOut — reuses the existing auth flow, never a second one", async () => {
      mockedPut.mockResolvedValue({
        ok: false,
        error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    });
  });

  it("a 401 session_issue error on load calls signOut", async () => {
    mockedGet.mockResolvedValue({
      ok: false,
      error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" },
    });
    render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  describe("opaque field preservation", () => {
    it("a brand-new session's saved payload carries main_content as null", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
      await user.click(await screen.findByRole("button", { name: "Enregistrer la séance" }));
      await pickPerformedKind(user, "AEROBIC_BASE");
      await pickLoad(user, "charge modérée");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ main_content: null });
    });

    it("editing an existing row round-trips main_content unchanged, without any editor for it", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

      await user.click(await screen.findByRole("button", { name: "Modifier" }));
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        intervention: EXISTING_RECORD.intervention,
        main_content: EXISTING_RECORD.main_content,
      });
    });
  });

  it("reloading (GET) after a save shows the persisted state", async () => {
    mockedGet.mockResolvedValueOnce({ ok: true, data: null });
    const { unmount } = render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);
    await screen.findByText("Comment s'est passée ta séance ?");
    unmount();

    mockedGet.mockResolvedValueOnce({ ok: true, data: EXISTING_RECORD });
    render(<CompletedSessionCard date={DATE} athleteId={ATHLETE_ID} />);

    expect(await screen.findByText("Faite")).toBeInTheDocument();
  });
});

function fireSlider(label: string, value: number): void {
  const slider = screen.getByRole("slider", { name: new RegExp(label) });
  fireEvent.change(slider, { target: { value: String(value) } });
}

async function pickPerformedKind(user: ReturnType<typeof userEvent.setup>, kind: string): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: /Activité réellement effectuée/ }), kind);
}

async function pickLoad(user: ReturnType<typeof userEvent.setup>, loadLabel: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: loadLabel }));
}

/** Fills every "done" field except performed_kind/load — callers that need a fully valid form must pick an activity separately. */
async function fillRestOfValidDoneForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const durationInput = screen.getByRole("spinbutton");
  await user.clear(durationInput);
  await user.type(durationInput, "42");

  fireSlider("Effort global ressenti", 7);
  fireSlider("Fatigue jambes", 4);
  fireSlider("Fatigue grip", 3);

  await user.click(screen.getByRole("button", { name: "Non" })); // new_pain = false
}
