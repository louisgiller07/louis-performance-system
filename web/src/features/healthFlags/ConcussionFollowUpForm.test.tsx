import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConcussionFollowUpForm, DECLARATIVE_NOTICE, OUTCOME_LABELS } from "./ConcussionFollowUpForm";
import type { ConcussionFollowUp } from "./concussionFollowUpRepo";

// SPORT-SAFE-02 A5 (HPM 2026-10-22) — the rider's declarative attestation of a concussion signal's assessment.

const load = vi.fn<(flagId: string) => Promise<ConcussionFollowUp>>();
const record = vi.fn();
vi.mock("./concussionFollowUpRepo", async (original) => ({
  ...(await original<typeof import("./concussionFollowUpRepo")>()),
  loadConcussionFollowUp: (flagId: string) => load(flagId),
  recordConcussionAttestation: (input: unknown) => record(input),
}));
vi.mock("../../lib/date", () => ({ todayLocal: () => "2026-10-22" }));

const OPEN: ConcussionFollowUp = { open: true, flagDate: "2026-10-20", lastOutcome: null, checkinDeclaresConcussion: false };
const radios = () => screen.getAllByRole("radio").map((r) => (r.closest("label") as HTMLElement).textContent);
const submitButton = () => screen.getByRole("button", { name: "Enregistrer ma déclaration" });
async function openForm(onResolved = vi.fn()) {
  render(<ConcussionFollowUpForm flagId="flag-1" onResolved={onResolved} />);
  await userEvent.click(screen.getByRole("button", { name: "Déclarer l'issue de mon évaluation" }));
  await screen.findByRole("group", { name: "Où en est ton évaluation ?" });
  return onResolved;
}

beforeEach(() => {
  load.mockReset();
  record.mockReset();
});

describe("ConcussionFollowUpForm — what the rider may declare", () => {
  it("closed by default; once opened: the declarative notice, never a document field", async () => {
    load.mockResolvedValue(OPEN);
    await openForm();
    expect(screen.getByTestId("concussion-declarative")).toHaveTextContent(DECLARATIVE_NOTICE);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("from an open signal: the five outcomes; after « in progress »: confirmed / ruled out / full return; after « confirmed »: only the full return", async () => {
    load.mockResolvedValue(OPEN);
    await openForm();
    expect(radios()).toEqual(Object.values(OUTCOME_LABELS));
    screen.getByRole("button", { name: "Annuler" }).click();

    load.mockResolvedValue({ ...OPEN, lastOutcome: "assessment_in_progress" });
    await userEvent.click(await screen.findByRole("button", { name: "Déclarer l'issue de mon évaluation" }));
    await screen.findByRole("group");
    expect(radios()).toEqual([OUTCOME_LABELS.concussion_confirmed, OUTCOME_LABELS.ruled_out, OUTCOME_LABELS.full_return_authorised]);
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));

    load.mockResolvedValue({ ...OPEN, lastOutcome: "concussion_confirmed" });
    await userEvent.click(await screen.findByRole("button", { name: "Déclarer l'issue de mon évaluation" }));
    await screen.findByRole("group");
    expect(radios()).toEqual([OUTCOME_LABELS.full_return_authorised]);
  });

  it("« in progress » and « confirmed » keep the suspension; the closing outcomes say a new daily analysis comes first", async () => {
    load.mockResolvedValue(OPEN);
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.assessment_in_progress));
    expect(screen.getByTestId("concussion-follow-up-effect")).toHaveTextContent("NALYNT continue de suspendre ses propositions d'entraînement.");
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.concussion_confirmed));
    expect(screen.getByTestId("concussion-follow-up-effect")).toHaveTextContent("NALYNT continue de suspendre ses propositions d'entraînement.");
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.full_return_authorised));
    expect(screen.getByTestId("concussion-follow-up-effect")).toHaveTextContent("NALYNT refait l'analyse de ta journée avant de te proposer une séance. Ton check-in quotidien reste pris en compte.");
  });

  it("a dated outcome needs a date between the signal and today; an entry error needs its explicit confirmation", async () => {
    load.mockResolvedValue(OPEN);
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.ruled_out));
    expect(submitButton()).toBeDisabled();
    const date = screen.getByLabelText("Date de cette décision");
    expect([date.getAttribute("min"), date.getAttribute("max")]).toEqual(["2026-10-20", "2026-10-22"]);
    await userEvent.type(date, "2026-10-19");
    expect(submitButton()).toBeDisabled();
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-21");
    expect(submitButton()).toBeEnabled();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.entered_in_error));
    expect(submitButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(submitButton()).toBeEnabled();
  });
});

describe("ConcussionFollowUpForm — sending", () => {
  it("re-reads the server state first: a state changed in the meantime is never overwritten", async () => {
    load.mockResolvedValueOnce(OPEN).mockResolvedValueOnce({ ...OPEN, lastOutcome: "concussion_confirmed" });
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.assessment_in_progress));
    await userEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ton suivi a changé entre-temps : vérifie ta déclaration.");
    expect(record).not.toHaveBeenCalled();
    expect(radios()).toEqual([OUTCOME_LABELS.full_return_authorised]);
  });

  it("a signal already closed elsewhere: nothing sent, the day is refreshed", async () => {
    load.mockResolvedValueOnce(OPEN).mockResolvedValueOnce({ ...OPEN, open: false });
    const onResolved = await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.assessment_in_progress));
    await userEvent.click(submitButton());
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(record).not.toHaveBeenCalled();
  });

  it("a closing declaration recorded → the day is refreshed (new analysis); a non-closing one → confirmation, suspension kept", async () => {
    load.mockResolvedValue(OPEN);
    record.mockResolvedValue({ ok: true, closed: true });
    const onResolved = await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.full_return_authorised));
    await userEvent.type(screen.getByLabelText("Date de cette décision"), "2026-10-22");
    await userEvent.selectOptions(screen.getByLabelText("Professionnel consulté (facultatif)"), "sports_physician");
    await userEvent.click(submitButton());
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0]![0]).toMatchObject({ flagId: "flag-1", outcome: "full_return_authorised", assessedOn: "2026-10-22", professionalCategory: "sports_physician" });

    record.mockResolvedValue({ ok: true, closed: false });
    const second = vi.fn();
    render(<ConcussionFollowUpForm flagId="flag-2" onResolved={second} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Déclarer l'issue de mon évaluation" }).at(-1)!);
    await userEvent.click((await screen.findAllByLabelText(OUTCOME_LABELS.assessment_in_progress)).at(-1)!);
    await userEvent.click(screen.getAllByRole("button", { name: "Enregistrer ma déclaration" }).at(-1)!);
    expect(await screen.findByTestId("concussion-follow-up-recorded")).toHaveTextContent("Déclaration enregistrée. NALYNT continue de suspendre ses propositions d'entraînement.");
    expect(second).not.toHaveBeenCalled();
  });

  it("a lost answer: the retry resends the SAME declaration id; a changed declaration gets a new one", async () => {
    load.mockResolvedValue(OPEN);
    record.mockResolvedValueOnce({ ok: false, code: "network", retryable: true }).mockResolvedValueOnce({ ok: false, code: "network", retryable: true });
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.assessment_in_progress));
    await userEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'enregistrer ta déclaration pour l'instant. Réessaie dans un instant.");
    await userEvent.click(submitButton());
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1]![0].id).toBe(record.mock.calls[0]![0].id);
    record.mockResolvedValueOnce({ ok: true, closed: false });
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.concussion_confirmed));
    await userEvent.type(screen.getByLabelText("Date de cette décision"), "2026-10-21");
    await userEvent.click(submitButton());
    await waitFor(() => expect(record).toHaveBeenCalledTimes(3));
    expect(record.mock.calls[2]![0].id).not.toBe(record.mock.calls[0]![0].id);
  });

  it("today's check-in still declares a suspected concussion: a closure says to correct it first and is never sent; once corrected, it is sent", async () => {
    load.mockResolvedValue({ ...OPEN, checkinDeclaresConcussion: true });
    record.mockResolvedValue({ ok: true, closed: true });
    const onResolved = await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.assessment_in_progress));
    expect(screen.queryByTestId("concussion-follow-up-checkin-first")).toBeNull();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.entered_in_error));
    expect(screen.getByTestId("concussion-follow-up-checkin-first")).toHaveTextContent("Ton check-in du jour indique encore une suspicion de commotion : corrige-le d'abord");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ton check-in du jour indique toujours une suspicion de commotion.");
    expect(record).not.toHaveBeenCalled();
    load.mockResolvedValue(OPEN);
    await userEvent.click(submitButton());
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("a refused declaration reads as a sentence, never a code", async () => {
    load.mockResolvedValue(OPEN);
    record.mockResolvedValue({ ok: false, code: "entered_in_error_after_training", retryable: false });
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.entered_in_error));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Une séance a été enregistrée depuis ce signal : ce suivi se clôt par la décision d'un professionnel de santé.");
    expect(document.body.textContent).not.toMatch(/entered_in_error|_/);
  });

  it("mobile: every control is at least 44 px high (min-h-11)", async () => {
    load.mockResolvedValue(OPEN);
    await openForm();
    await userEvent.click(screen.getByLabelText(OUTCOME_LABELS.ruled_out));
    for (const el of [...screen.getAllByRole("button"), screen.getByLabelText("Date de cette décision"), screen.getByLabelText("Professionnel consulté (facultatif)")]) {
      expect(el.className, el.textContent ?? "").toMatch(/min-h-11/);
    }
    for (const radio of screen.getAllByRole("radio")) expect((radio.closest("label") as HTMLElement).className).toMatch(/min-h-11/);
  });
});
