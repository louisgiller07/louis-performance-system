import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBackend, prescriptionView } from "../../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../../test/GuidedSessionHarness";
import { ACTION_ERROR_MESSAGES } from "../guidedSessionCopy";
import { ENDURANCE_COPY } from "./enduranceCopy";

// UX-11C.4 — guided endurance (the activity performed), through the real
// shell + hook + module, against the in-memory backend double
// (record_session_execution rules for activities included).

const ENDURANCE = prescriptionView("AEROBIC_BASE"); // road_bike, mtb_rolling, home_trainer, running; 10 + 30 + 5 min; main RPE 3–4
const UPPER = prescriptionView("STRENGTH_UPPER");

const phase = () => screen.getByRole("status").getAttribute("data-phase");
const completeButton = () => screen.getByRole("button", { name: "Terminer la séance" });
const minutes = () => screen.getByLabelText(ENDURANCE_COPY.minutesLabel);
const km = () => screen.getByLabelText(ENDURANCE_COPY.kmLabel);
const rpe = () => screen.getByLabelText(ENDURANCE_COPY.rpeLabel);
const result = () => screen.getByTestId("activity-result");

async function startSession() {
  await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
  await waitFor(() => expect(phase()).toBe("active"));
}
async function type(input: HTMLElement, value: string) {
  await userEvent.clear(input);
  if (value !== "") await userEvent.type(input, value);
}
async function fillActivity(label: string, mins: string, kms = "", rpeValue = "") {
  await userEvent.click(screen.getByRole("radio", { name: label }));
  await type(minutes(), mins);
  await type(km(), kms);
  await type(rpe(), rpeValue);
}
async function saveActivity(label = "VTT roulant", mins = "43", kms = "18.4", rpeValue = "4") {
  await fillActivity(label, mins, kms, rpeValue);
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer l'activité" }));
  await waitFor(() => expect(result()).toBeInTheDocument());
}

describe("Guided endurance — rendering (UX-11C.4)", () => {
  it("prescription as prescribed, then « Ce que tu as réalisé »: 4 allowed activities, none selected, nothing prefilled; completion disabled", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(screen.getByText(ENDURANCE.intent, { selector: "p.font-medium" })).toBeInTheDocument();
    expect(screen.getByText("Activité au choix : Vélo de route, VTT roulant, Home-trainer, Course à pied")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: ENDURANCE_COPY.activityLegend });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual(["Vélo de route", "VTT roulant", "Home-trainer", "Course à pied"]);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(minutes()).toHaveValue("");
    expect(minutes()).toHaveAccessibleDescription("Prévu : 45 min");
    expect(rpe()).toHaveAccessibleDescription("Prévu : RPE 3–4 (bloc principal)");
    expect(km()).toHaveValue("");
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(ENDURANCE_COPY.needActivity);
    expect(b.executions[0]!.session_activity_results).toEqual([]);
  });

  it("an incoherent activity choice (duplicated id) fails closed: no entry, no default activity, completion disabled", async () => {
    const broken = prescriptionView("AEROBIC_BASE", (s) => (s.activitySelection.activityIds = ["road_bike", "road_bike"]));
    const b = fakeBackend({ prescription: broken });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(document.querySelector('[data-reason="invalid_endurance_prescription"]')).toHaveTextContent(ENDURANCE_COPY.invalid);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(completeButton()).toBeDisabled();
  });
});

describe("Guided endurance — entry and validation", () => {
  it("required activity and duration; errors attached to their fields; nothing is sent", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    const posts = b.post.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer l'activité" }));
    expect(screen.getByRole("group", { name: ENDURANCE_COPY.activityLegend })).toHaveAccessibleDescription("Choisis l'activité que tu as réellement faite.");
    expect(minutes()).toHaveAttribute("aria-invalid", "true");
    expect(minutes()).toHaveAccessibleDescription("Prévu : 45 min Indique la durée réalisée en minutes entières (1 ou plus).");
    expect(b.post.mock.calls.length).toBe(posts);
  });

  it.each([
    ["minutes", "0"],
    ["minutes", "4.5"],
    ["minutes", "abc"],
    ["minutes", "1e3"],
    ["km", "-1"],
    ["km", "1.2345"],
    ["km", "Infinity"],
    ["rpe", "0"],
    ["rpe", "11"],
    ["rpe", "7.25"],
    ["rpe", "NaN"],
  ])("%s = %j → refused on the field, never coerced", async (field, value) => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    const posts = b.post.mock.calls.length;
    await fillActivity("VTT roulant", field === "minutes" ? value : "43", field === "km" ? value : "", field === "rpe" ? value : "");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer l'activité" }));
    const input = { minutes, km, rpe }[field as "minutes" | "km" | "rpe"]();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(b.post.mock.calls.length).toBe(posts);
  });

  it("saves the activity with explicit unit conversion: 43 min → 2580 s, 18.4 km → 18400 m, RPE 4; comment never sent", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity("VTT roulant", "43", "18.4", "4");
    expect(b.post.mock.calls.at(-1)![0]).toEqual({
      events: [],
      activities: [{ id: expect.any(String), execution_id: b.executions[0]!.id, activity_id: "mtb_rolling", duration_seconds: 2580, distance_m: 18400, rpe_actual: 4, comment: null, supersedes_id: null, occurred_at: "2026-10-09T17:00:00Z" }],
    });
    expect(result()).toHaveTextContent("Activité : VTT roulant");
    expect(result()).toHaveTextContent("Durée : 43 min (prévu : 45 min)"); // actual and prescribed side by side, no judgement
    expect(result()).toHaveTextContent("Distance : 18,4 km");
    expect(result()).toHaveTextContent("RPE ressenti : 4");
    expect(screen.queryByRole("group", { name: ENDURANCE_COPY.activityLegend })).toBeNull();
    expect(completeButton()).toBeEnabled();
  });

  it("empty distance and RPE → null", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity("Course à pied", "32", "", "");
    expect(b.post.mock.calls.at(-1)![0].activities![0]).toMatchObject({ activity_id: "running", duration_seconds: 1920, distance_m: null, rpe_actual: null });
    expect(result()).not.toHaveTextContent("Distance");
    expect(result()).toHaveTextContent("Durée : 32 min (prévu : 45 min)");
  });

  it("a comma decimal is accepted: 12,5 km → 12500 m", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity("Vélo de route", "60", "12,5", "");
    expect(b.executions[0]!.session_activity_results[0]).toMatchObject({ distance_m: 12500, duration_seconds: 3600 });
  });

  it("network failure: nothing shown as recorded; retry re-sends the SAME id → one row; a double click sends once", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    b.state.networkFailures = ["landed"];
    await fillActivity("Home-trainer", "40");
    const save = screen.getByRole("button", { name: "Enregistrer l'activité" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(screen.queryByTestId("activity-result")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(result()).toHaveTextContent("Activité : Home-trainer"));
    const [first, second] = b.state.posts.slice(-2);
    expect(second).toEqual(first);
    expect(b.executions[0]!.session_activity_results).toHaveLength(1);
  });

  it("two tabs: the second original is refused (activity_result_exists) and that tab reloads the confirmed activity — never « the latest wins »", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    const tabA = render(<Harness deps={b.deps} />);
    await userEvent.click(await within(tabA.container).findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(within(tabA.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const tabB = render(<Harness deps={b.deps} />);
    await waitFor(() => expect(within(tabB.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const save = async (tab: typeof tabA, label: string, mins: string) => {
      const s = within(tab.container);
      await userEvent.click(s.getByRole("radio", { name: label }));
      await userEvent.type(s.getByLabelText(ENDURANCE_COPY.minutesLabel), mins);
      await userEvent.click(s.getByRole("button", { name: "Enregistrer l'activité" }));
    };
    await save(tabA, "VTT roulant", "43");
    await save(tabB, "Course à pied", "30");
    await waitFor(() => expect(within(tabB.container).getByRole("alert")).toHaveAttribute("data-code", "activity_result_exists"));
    expect(within(tabB.container).getByRole("alert")).toHaveTextContent(ACTION_ERROR_MESSAGES.activity_result_exists!);
    expect(within(tabB.container).getByTestId("activity-result")).toHaveTextContent("Activité : VTT roulant");
    expect(b.executions[0]!.session_activity_results.map((r) => r.activity_id)).toEqual(["mtb_rolling"]);
  });

  it("correction: « Modifier » prefills the recorded values (focus on the activity), may switch to another allowed activity, appends one superseding row; never a correction of a correction", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity("VTT roulant", "43", "18.4", "4");
    const original = b.executions[0]!.session_activity_results[0]!;
    await userEvent.click(screen.getByRole("button", { name: "Modifier l'activité réalisée" }));
    expect(screen.getByRole("radio", { name: "VTT roulant" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "VTT roulant" })).toHaveFocus();
    expect(minutes()).toHaveValue("43");
    expect(km()).toHaveValue("18.4");
    expect(rpe()).toHaveValue("4");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: ENDURANCE_COPY.activityLegend })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Modifier l'activité réalisée" }));
    await userEvent.click(screen.getByRole("radio", { name: "Vélo de route" }));
    await type(minutes(), "50");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(result()).toHaveTextContent(`Activité : Vélo de route · ${ENDURANCE_COPY.corrected}`));
    expect(result()).toHaveTextContent("Durée : 50 min");
    const rows = b.executions[0]!.session_activity_results;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(original);
    expect(rows[1]).toMatchObject({ supersedes_id: original.id, activity_id: "road_bike", duration_seconds: 3000, distance_m: 18400, rpe_actual: 4 });
    expect(screen.queryByRole("button", { name: "Modifier l'activité réalisée" })).toBeNull();
    expect(screen.getByText(ENDURANCE_COPY.correctedOnce)).toBeInTheDocument();
  });

  it("refresh: same execution, the active activity with its duration, distance and RPE; no duplicate (also after a correction)", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    const first = render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity("VTT roulant", "43", "18.4", "4");
    first.unmount();
    const second = render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(result()).toHaveTextContent("Activité : VTT roulant");
    expect(result()).toHaveTextContent("Distance : 18,4 km");
    await userEvent.click(screen.getByRole("button", { name: "Modifier l'activité réalisée" }));
    await type(rpe(), "5");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(result()).toHaveTextContent("RPE ressenti : 5"));
    second.unmount();
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(result()).toHaveTextContent(`Activité : VTT roulant · ${ENDURANCE_COPY.corrected}`);
    expect(result()).toHaveTextContent("RPE ressenti : 5");
    expect(b.executions).toHaveLength(1);
    expect(b.executions[0]!.session_activity_results).toHaveLength(2);
  });
});

describe("Guided endurance — completion", () => {
  it("a recorded activity → direct completion (no partial-results confirmation), then read only", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity();
    await userEvent.click(completeButton());
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(b.post.mock.calls.at(-1)![0]).toEqual({ events: [expect.objectContaining({ event_type: "completed" })] });
    expect(screen.queryByRole("button", { name: "Modifier l'activité réalisée" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(result()).toHaveTextContent("Activité : VTT roulant");
    expect(screen.queryByRole("button", { name: "Recommencer la séance" })).toBeNull();
  });

  it("a valid entry not saved + « Terminer » → activity + completed in ONE batch; a lost batch leaves the session active and nothing recorded", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await fillActivity("Vélo de route", "45", "30", "3");
    expect(completeButton()).toBeEnabled();
    b.state.networkFailures = ["lost"];
    await userEvent.click(completeButton());
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(phase()).toBe("active");
    expect(b.executions[0]!.session_activity_results).toEqual([]);
    const sent = b.state.posts.at(-1)!;
    expect(sent.events.map((e) => e.event_type)).toEqual(["completed"]);
    expect(sent.activities).toEqual([expect.objectContaining({ activity_id: "road_bike", duration_seconds: 2700, distance_m: 30000, rpe_actual: 3 })]);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(b.state.posts.at(-1)).toEqual(sent);
    expect(b.executions[0]!.session_activity_results).toHaveLength(1);
  });

  it("an incomplete entry blocks completion with the reason", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(screen.getByRole("radio", { name: "VTT roulant" }));
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(ENDURANCE_COPY.needActivity);
  });
});

describe("Guided endurance — abandon and restart", () => {
  it("abandoned: terminal, read only, the activity stays as history; restart creates a NEW execution", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await saveActivity();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier l'activité réalisée" })).toBeNull();
    expect(result()).toHaveTextContent("Activité : VTT roulant");
    await userEvent.click(screen.getByRole("button", { name: "Recommencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(2);
    expect(b.executions[1]!.session_activity_results).toEqual([]);
    expect(screen.getByRole("group", { name: ENDURANCE_COPY.activityLegend })).toBeInTheDocument();
  });

  it("restart refused when the prescription is no longer current", async () => {
    const b = fakeBackend({ prescription: ENDURANCE });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    const restart = await screen.findByRole("button", { name: "Recommencer la séance" });
    b.setCurrent({ prescription: UPPER });
    await userEvent.click(restart);
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "final_prescription_not_current");
    expect(b.executions).toHaveLength(1);
  });
});
