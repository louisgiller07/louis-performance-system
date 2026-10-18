import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Same cross-boundary direct engine import pattern as DailyPlanView.enriched.test.tsx: real M1 plans.
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { dayGuidanceOf } from "../dailyPlan/dayGuidance";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

// SPORT-SAFE-01R (HPM 2026-10-18, A1) — M1's protection and monitoring are shown where the rider trains: on
// /today/session before the start and while the session goes on (reload included), never on a read-only or a blocked
// session, and never a text of the browser's own (M1 decided nothing → nothing shown). Real M1 plans, real shell +
// hook + DH module against the backend double.

const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
function m1(checkin: Record<string, unknown>, planned: Record<string, unknown> = DH): DailyPlan {
  const plan = buildDailyPlan(baseRawContext({ planned_session: planned as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: checkin as never }));
  if (!isValidDailyPlan(plan)) throw new Error("engine produced an invalid DailyPlan");
  return plan;
}
const KNEE_4 = m1({ pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" });
const LEGS_9 = m1({ leg_fatigue: 9 });
const NEUTRAL = m1({});
const DH_VIEW = prescriptionView("DH_TECHNICAL");

const guidance = () => screen.queryByTestId("day-guidance");
const phase = () => document.querySelector("[data-phase]")!.getAttribute("data-phase");

describe("SPORT-SAFE-01R — M1's guidance on the guided session", () => {
  it("the real M1 outputs: knee 4/10 on a DH day → MODIFY DH LIGHT with protection and stop rule; no signal → no guidance at all", () => {
    expect([KNEE_4.decision, KNEE_4.final_session]).toEqual(["MODIFY", { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 90 }]);
    expect(dayGuidanceOf(KNEE_4)).toEqual({
      protection: ["Éviter toute charge sollicitant fortement Genou droit", "Réduire l'intensité de la séance pour protéger Genou droit"],
      monitoring: ["Surveiller l'évolution de la douleur (Genou droit, intensité 4/10) sur 24-48h", "Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade."],
    });
    expect(dayGuidanceOf(NEUTRAL)).toBeNull();
  });

  it("DH with knee pain 4/10: shown before the start, above the session and its start button; still shown once started and after a reload", async () => {
    const b = fakeBackend({ prescription: DH_VIEW });
    b.state.guidance = dayGuidanceOf(KNEE_4);
    const first = render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    const block = guidance()!;
    expect(block.textContent).toBe(
      "À éviterÉviter toute charge sollicitant fortement Genou droitRéduire l'intensité de la séance pour protéger Genou droit" +
        "À surveillerSurveiller l'évolution de la douleur (Genou droit, intensité 4/10) sur 24-48hPendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade."
    );
    // Before the session's content and its start button (document order).
    expect(block.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/knee_R/);

    await userEvent.click(start);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(guidance()?.textContent).toContain("arrête la partie DH si la douleur augmente clairement");

    first.unmount();
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(guidance()?.textContent).toContain("Éviter toute charge sollicitant fortement Genou droit");
  });

  it("legs 9/10 (M1 C3.6, REPLACE DH light): its own protection and monitoring, nothing else", async () => {
    const b = fakeBackend({ prescription: DH_VIEW });
    b.state.guidance = dayGuidanceOf(LEGS_9);
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(guidance()!.textContent).toBe(
      "À éviterÉviter le squat lourd / travail jambes intense (fatigue jambes élevée)" +
        "À surveillerRéduis encore la séance ou arrête la partie DH si ta précision se dégrade nettement ou si la fatigue jambes/grip augmente pendant la session."
    );
  });

  it("no signal: no guidance block, no warning of the browser's own", async () => {
    const b = fakeBackend({ prescription: DH_VIEW });
    b.state.guidance = dayGuidanceOf(NEUTRAL);
    render(<Harness deps={b.deps} />);
    await screen.findByRole("button", { name: "Commencer la séance" });
    expect(guidance()).toBeNull();
    expect(screen.queryByText("À éviter")).toBeNull();
    expect(screen.queryByText("À surveiller")).toBeNull();
  });

  it("stopped (read only): no guidance — nothing to train any more", async () => {
    const b = fakeBackend({ prescription: DH_VIEW });
    b.state.guidance = dayGuidanceOf(KNEE_4);
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(guidance()).toBeNull();
  });

  it("an open session under a health suspension: the suspension banner, never the earlier guidance", async () => {
    const b = fakeBackend({ prescription: DH_VIEW });
    b.state.guidance = dayGuidanceOf(KNEE_4);
    const first = render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    first.unmount();
    b.state.healthBlock = "health_suspended";
    render(<Harness deps={b.deps} />);
    await screen.findByTestId("guided-session-health-block");
    expect(guidance()).toBeNull();
  });
});
