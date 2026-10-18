// PARTIAL-01 (HPM 2026-10-18) — Today's « Après ta séance » for a guided session completed today: in part → it says
// so (« Séance guidée partiellement réalisée »); in full, or when the realisation could not be read → unchanged
// (« Séance guidée terminée »). Never a debrief invitation either way.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AfterSessionEntry } from "./AfterSessionEntry";
import type { EffectiveDay } from "../effectiveSession/effectiveDay";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("../completedSession/completedSessionRepo", () => ({ getCompletedSession: vi.fn(), putCompletedSession: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadValidDecisionsForDate: vi.fn(async () => []), loadGuidedDayState: vi.fn(async () => "completed"), loadDaySafetyRest: vi.fn(async () => false) }));
const { effective } = vi.hoisted(() => ({ effective: { day: null as EffectiveDay | null } }));
vi.mock("../effectiveSession/effectiveSessionRepo", () => ({ useEffectiveDays: () => (effective.day ? [effective.day] : null) }));

import { getCompletedSession } from "../completedSession/completedSessionRepo";
const mockedGet = getCompletedSession as unknown as ReturnType<typeof vi.fn>;

const DATE = "2026-10-20";
const completedDay = (realisation?: "complete" | "partial"): EffectiveDay => ({
  date: DATE,
  session: { kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60 },
  status: "completed",
  source: "execution",
  adaptation: null,
  planned: null,
  decisionId: "d-1",
  executionId: "e-1",
  finalPrescriptionId: "fp-1",
  ...(realisation ? { realisation } : {}),
});

const renderEntry = () =>
  render(
    <MemoryRouter>
      <AfterSessionEntry date={DATE} athleteId="athlete-1" />
    </MemoryRouter>
  );

beforeEach(() => {
  mockedGet.mockResolvedValue({ ok: true, data: null });
});

describe("PARTIAL-01 — « Après ta séance » for a guided session completed today", () => {
  it("completed in part: « Séance guidée partiellement réalisée », never « terminée » alone", async () => {
    effective.day = completedDay("partial");
    renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée partiellement réalisée" })).toBeInTheDocument();
    expect(screen.getByText(/Une partie de la séance prévue n'a pas été enregistrée/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Séance guidée terminée" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raconter ma séance →" })).not.toBeInTheDocument();
  });

  it("completed in full, or realisation not readable: « Séance guidée terminée » (unchanged)", async () => {
    effective.day = completedDay("complete");
    const full = renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée terminée" })).toBeInTheDocument();
    full.unmount();
    effective.day = completedDay();
    renderEntry();
    expect(await screen.findByRole("heading", { name: "Séance guidée terminée" })).toBeInTheDocument();
  });
});
