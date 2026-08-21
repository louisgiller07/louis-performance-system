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

import { getCompletedSession, putCompletedSession } from "./completedSessionRepo";

const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;
const mockedPut = putCompletedSession as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-08-12";
const LIVE_CONTEXT = { decisionId: "decision-live-1", sessionType: "AEROBIC_BASE" as const };

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
  intervention: { kind: "RECOVERY_ACTIVE", nested: { a: 1 } },
  main_content: { free_text: "notes" },
  session_load: 29.4,
  updated_at: "2026-08-12T20:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockedGet.mockResolvedValue({ ok: true, data: null });
});

describe("CompletedSessionCard", () => {
  it("shows the empty state (\"How did today go?\" + \"Log session\") when no row exists", async () => {
    render(<CompletedSessionCard date={DATE} liveContext={null} />);

    expect(await screen.findByText("How did today go?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log session" })).toBeInTheDocument();
  });

  it("shows a filled summary when a row exists", async () => {
    mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
    render(<CompletedSessionCard date={DATE} liveContext={null} />);

    expect(await screen.findByText("Faite")).toBeInTheDocument();
    expect(screen.getByText("Récupération")).toBeInTheDocument();
    expect(screen.getByText("42 min")).toBeInTheDocument();
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  describe("pain reminder — neutral, informational only (never a Safety-processed warning)", () => {
    it("shows the neutral pain reminder only when new_pain is true", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, new_pain: true, new_pain_note: "Genou" } });
      render(<CompletedSessionCard date={DATE} liveContext={null} />);

      expect(await screen.findByText("Tu as indiqué une nouvelle douleur.")).toBeInTheDocument();
      expect(screen.getByText("Genou")).toBeInTheDocument();
      expect(
        screen.getByText("Pense à la mentionner dans ton prochain check-in afin qu'elle fasse partie des informations de readiness.")
      ).toBeInTheDocument();
    });

    it("never uses warning/red styling for the pain reminder", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, new_pain: true, new_pain_note: "Genou" } });
      render(<CompletedSessionCard date={DATE} liveContext={null} />);

      const reminder = (await screen.findByText("Tu as indiqué une nouvelle douleur.")).closest("div");
      expect(reminder?.className).not.toMatch(/red/);
    });

    it("never implies escalation, Safety processing, or coach notification", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, new_pain: true, new_pain_note: "Genou" } });
      render(<CompletedSessionCard date={DATE} liveContext={null} />);

      await screen.findByText("Tu as indiqué une nouvelle douleur.");
      const forbidden = [/flagged/i, /escalated/i, /coach notified/i, /plan adjusted/i, /safety/i, /signalée/i];
      for (const pattern of forbidden) {
        expect(screen.queryByText(pattern)).not.toBeInTheDocument();
      }
    });
  });

  describe("decision + session-type live context (never a default, never a history lookup)", () => {
    it("A. no live plan -> decision_id=null and session_type stays unselected", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);

      await user.click(await screen.findByRole("button", { name: "Log session" }));

      expect(screen.getByRole("combobox", { name: /Type de séance/ })).toHaveValue("");
      await pickSessionType(user, "RECOVERY");
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: null, session_type: "RECOVERY" });
    });

    it("B. no live plan -> Save is disabled until a session type is explicitly chosen", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      await fillRestOfValidDoneForm(user); // everything except session_type
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      await pickSessionType(user, "RECOVERY");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("C. live plan -> exact decisionId preselected", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);

      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "decision-live-1" });
    });

    it("D. live plan -> exact plan session_type preselected, Save enabled without touching the select", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);

      await user.click(await screen.findByRole("button", { name: "Log session" }));
      expect(screen.getByRole("combobox", { name: /Type de séance/ })).toHaveValue("AEROBIC_BASE");

      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ session_type: "AEROBIC_BASE" });
    });

    it("E. existing row -> its persisted decision_id/session_type win over live context, never overwritten during edit", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: { ...EXISTING_RECORD, decision_id: "decision-from-row", session_type: "REST" } });
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);

      await user.click(await screen.findByRole("button", { name: "Edit" }));
      expect(screen.getByRole("combobox", { name: /Type de séance/ })).toHaveValue("REST");

      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ decision_id: "decision-from-row", session_type: "REST" });
    });
  });

  describe("status-dependent field visibility", () => {
    it("hides duration/RPE for skipped, shows them for done", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      expect(screen.getByText("Durée (minutes)")).toBeInTheDocument();
      expect(screen.getByText("RPE")).toBeInTheDocument();

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");

      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();
      expect(screen.queryByText("RPE")).not.toBeInTheDocument();
    });

    it("hides duration/RPE for REST — never an invented training load", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      await pickSessionType(user, "REST");

      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();
      expect(screen.queryByText("RPE")).not.toBeInTheDocument();
    });

    it("Save becomes valid for REST without any duration/RPE — just status, session type, pain answered", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      await pickSessionType(user, "REST");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Non" })); // new_pain = false
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        session_type: "REST",
        actual_duration_min: null,
        rpe: null,
      });
    });

    it("live REST plan preselects REST with no duration/RPE required", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={{ decisionId: "decision-live-1", sessionType: "REST" }} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      expect(screen.getByRole("combobox", { name: /Type de séance/ })).toHaveValue("REST");
      expect(screen.queryByText("Durée (minutes)")).not.toBeInTheDocument();
      expect(screen.queryByText("RPE")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Non" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });
  });

  describe("pain wording", () => {
    it("uses session-context wording for done/partial/replaced", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      expect(screen.getByText("New pain during or after the session?")).toBeInTheDocument();
    });

    it("uses day-context wording for skipped", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      await user.selectOptions(screen.getByDisplayValue("Faite"), "skipped");

      expect(screen.getByText("Any new pain today?")).toBeInTheDocument();
    });

    it("uses day-context wording for REST too", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      await pickSessionType(user, "REST");

      expect(screen.getByText("Any new pain today?")).toBeInTheDocument();
    });

    it("shows the note textarea only when new_pain is answered Oui", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      expect(screen.queryByLabelText("Décris la douleur")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Oui" }));
      expect(screen.getByLabelText("Décris la douleur")).toBeInTheDocument();
    });
  });

  describe("save gating", () => {
    it("Save is disabled until the form is fully valid", async () => {
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));

      // session_type is preselected (live context), but duration/RPE/fatigues/new_pain are still empty.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      await fillRestOfValidDoneForm(user);
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });
  });

  describe("save outcomes", () => {
    it("save success replaces the form with the persisted summary", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(screen.getByText("Faite")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
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
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/décision liée/));
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(signOut).not.toHaveBeenCalled();
    });

    it("a 422 decision_session_mismatch error is shown, the form stays open, and there is no signOut", async () => {
      mockedPut.mockResolvedValue({
        ok: false,
        error: {
          code: "decision_session_mismatch",
          message: "Le statut et le type de séance ne correspondent pas à la séance liée.",
          retryable: false,
          action: "user_fixable",
        },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("Le statut et le type de séance ne correspondent pas à la séance liée.")
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(signOut).not.toHaveBeenCalled();
    });

    it("a 500 retryable error is shown and the form is preserved for retry", async () => {
      mockedPut.mockResolvedValueOnce({
        ok: false,
        error: { code: "persistence_failed", message: "Erreur d'enregistrement côté serveur. Réessaie.", retryable: true, action: "retry" },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Erreur d'enregistrement/));
      expect(screen.getByDisplayValue("42")).toBeInTheDocument();

      mockedPut.mockResolvedValueOnce({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.getByText("Faite")).toBeInTheDocument());
    });

    it("a 401 session_issue error on save calls signOut — reuses the existing auth flow, never a second one", async () => {
      mockedPut.mockResolvedValue({
        ok: false,
        error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" },
      });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    });
  });

  it("a 401 session_issue error on load calls signOut", async () => {
    mockedGet.mockResolvedValue({
      ok: false,
      error: { code: "unauthenticated", message: "Ta session a expiré. Reconnecte-toi.", retryable: false, action: "session_issue" },
    });
    render(<CompletedSessionCard date={DATE} liveContext={null} />);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  describe("opaque field preservation", () => {
    it("a brand-new session's saved payload carries intervention/main_content as null", async () => {
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: { ...EXISTING_RECORD, id: "cs-new" }, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={LIVE_CONTEXT} />);
      await user.click(await screen.findByRole("button", { name: "Log session" }));
      await fillRestOfValidDoneForm(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({ intervention: null, main_content: null });
    });

    it("editing an existing row round-trips intervention/main_content unchanged, without any editor for them", async () => {
      mockedGet.mockResolvedValue({ ok: true, data: EXISTING_RECORD });
      mockedPut.mockResolvedValue({ ok: true, data: { completedSession: EXISTING_RECORD, warnings: [] } });
      const user = userEvent.setup();
      render(<CompletedSessionCard date={DATE} liveContext={null} />);

      await user.click(await screen.findByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut.mock.calls[0]![0]).toMatchObject({
        intervention: EXISTING_RECORD.intervention,
        main_content: EXISTING_RECORD.main_content,
      });
    });
  });

  it("reloading (GET) after a save shows the persisted state", async () => {
    mockedGet.mockResolvedValueOnce({ ok: true, data: null });
    const { unmount } = render(<CompletedSessionCard date={DATE} liveContext={null} />);
    await screen.findByText("How did today go?");
    unmount();

    mockedGet.mockResolvedValueOnce({ ok: true, data: EXISTING_RECORD });
    render(<CompletedSessionCard date={DATE} liveContext={null} />);

    expect(await screen.findByText("Faite")).toBeInTheDocument();
  });
});

function fireSlider(label: string, value: number): void {
  const slider = screen.getByRole("slider", { name: new RegExp(label) });
  fireEvent.change(slider, { target: { value: String(value) } });
}

async function pickSessionType(user: ReturnType<typeof userEvent.setup>, type: string): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: /Type de séance/ }), type);
}

/** Fills every "done" field except session_type — callers that need a fully valid form must pick a session type separately (either via live context preselection or pickSessionType). */
async function fillRestOfValidDoneForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const durationInput = screen.getByRole("spinbutton");
  await user.clear(durationInput);
  await user.type(durationInput, "42");

  fireSlider("RPE", 7);
  fireSlider("Fatigue jambes", 4);
  fireSlider("Fatigue grip", 3);

  await user.click(screen.getByRole("button", { name: "Non" })); // new_pain = false
}
