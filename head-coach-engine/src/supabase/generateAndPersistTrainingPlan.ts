/**
 * `generateAndPersistTrainingPlan` — the internal entry-point service
 * composing `buildPlanInputSnapshot()` (V0.5_009) and
 * `persistGeneratedTrainingPlan()` (V0.4_148, unmodified) for a future
 * `generate-training-plan` Edge Function (V0.5_010, not built here). Pure
 * composition — no coaching logic, no new generation logic.
 *
 * Real call graph, verified by reading `persistGeneratedTrainingPlan.ts`
 * directly (not assumed): it already calls `runGenerationEngine()`
 * internally (V0.4_148, locked) before mapping and calling the RPC. This
 * ticket's own 3-step diagram (buildPlanInputSnapshot -> runGenerationEngine
 * -> persistGeneratedTrainingPlan) therefore does not match 1:1 onto real,
 * separately-injectable calls at this layer — re-exposing
 * `runGenerationEngine` as a second top-level dependency here would mean
 * calling it a second time (it mints fresh ids via `randomUUID()` on every
 * call, so a duplicate invocation would silently produce a second,
 * different set of plan/block/session ids, discarding the first) or
 * modifying `persistGeneratedTrainingPlan.ts` itself, which is outside this
 * ticket's authorized file scope. This function therefore has exactly two
 * injectable dependencies — `buildPlanInputSnapshot` and
 * `persistGeneratedTrainingPlan` — and a `runGenerationEngine` failure is
 * observed, from this layer, exactly as a `persistGeneratedTrainingPlan`
 * rejection (see this file's own test suite for how that failure mode is
 * exercised).
 *
 * Per V0.5_010's lock (refined V0.5_031/032): the caller supplies only what
 * it can actually know — `athleteId`, `generationRequestId` (never minted
 * here, transmitted verbatim), `durationWeeks`, `today`, and optionally
 * `generationTrigger`/`baseVersionId`. The full `TrainingPlanBlock` is no
 * longer caller-supplied: V0.5_031's field-by-field audit found
 * `sequenceNumber`/`name`/`mode`/`primaryFocus` have no legitimate
 * per-request value for the athlete to provide (fixed, non-invented
 * constants — see `deriveTrainingPlanBlock` below), leaving `durationWeeks`
 * as the only real user input, with `startDate`/`endDate` mechanically
 * derived from it and `today`. Every version-metadata field already owned by
 * an existing layer (`plannerVersion`/`rulesetVersion` from
 * `PLANNING_ENGINE_VERSION`, `prescriptionSchemaVersion` from
 * `PRESCRIPTION_SCHEMA_VERSION`, `catalogVersion` inside the mapper itself)
 * is read directly here, never requested from the caller and never
 * duplicated.
 *
 * `rationale` is a closed `Record<GenerationTrigger, string>` lookup — same
 * "closed mapping, never free-text generation" discipline already proven at
 * `planning-engine/src/pipeline/planningPipelineOrchestrator.ts`'s
 * `PHRASE_FOR_SELECTION_REASON` (V0.4_114A).
 *
 * `inputSnapshotHash` has no existing source anywhere in this codebase
 * (confirmed before implementation — the one real integration test exercising
 * this RPC uses a fake placeholder string, not a real hash). A SHA-256 of
 * the snapshot's JSON serialization is computed inline via Node's built-in
 * `crypto` (already used the same way for id-minting in
 * `generationEngine.ts`) — a technical/structural concern, not a coaching
 * decision, but genuinely new code, not pure composition of an existing
 * piece. Confirmed with the architect before implementation (V0.5_010).
 *
 * No try/catch anywhere: an error from `buildPlanInputSnapshot`
 * (`GenerationBlockedError`, `PlanningEngineValidationError`) or from
 * `persistGeneratedTrainingPlan` (planning-engine/prescription-engine
 * errors, the RPC wrapper's own errors) propagates unchanged — a failure at
 * either step means the next step is never reached, and nothing is ever
 * silently defaulted.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationTrigger, PlanInputSnapshot } from "planning-engine";
import { PLANNING_ENGINE_VERSION } from "planning-engine";
import { PRESCRIPTION_SCHEMA_VERSION } from "prescription-engine";
import { buildPlanInputSnapshot } from "./buildPlanInputSnapshot.js";
import { persistGeneratedTrainingPlan } from "./persistGeneratedTrainingPlan.js";
import type { GenerationEngineInput } from "../generation/generationEngine.js";
import type { GenerateTrainingPlanVersionResult } from "./rpc/generateTrainingPlanVersionRpc.js";

/** `PlanInputSnapshot`'s own structural schema version — no canonical exported constant exists yet anywhere (planning-engine cannot be modified in this ticket); "v1" matches the value already proven end to end against the real RPC (generationPersistence.integration.test.ts, V0.4_149). */
const INPUT_SNAPSHOT_SCHEMA_VERSION = "v1";

const DEFAULT_GENERATION_TRIGGER: GenerationTrigger = "initial";

/** Closed mapping, same discipline as `PHRASE_FOR_SELECTION_REASON` (planningPipelineOrchestrator.ts, V0.4_114A) — never free-text generation. */
const RATIONALE_FOR_TRIGGER: Record<GenerationTrigger, string> = {
  initial: "Initial training plan generation.",
  race_added: "Regenerated after a race was added to the calendar.",
  race_removed: "Regenerated after a race was removed from the calendar.",
  availability_changed: "Regenerated after declared availability changed.",
  equipment_changed: "Regenerated after declared equipment changed.",
  missed_session: "Regenerated after a pattern of missed or replaced sessions.",
  manual_edit: "Regenerated after a manual edit.",
  ruleset_upgrade: "Regenerated due to a planner/ruleset version upgrade.",
};

function hashInputSnapshot(snapshot: PlanInputSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

// Fixed, non-invented TrainingPlanBlock fields — V0.5_031 lock (§11 C/D/E/F).
// Never derived per-athlete, never free text: block.name and primaryFocus
// are French to match the rest of web's UI copy; mode="UNSPECIFIED" matches
// M1's own pre-existing "no configured phase" precedent (buildRawContext.ts);
// sequenceNumber=1 because exactly one block is created per generation call.
const DERIVED_BLOCK_SEQUENCE_NUMBER = 1;
const DERIVED_BLOCK_NAME = "Plan d'entraînement généré";
const DERIVED_BLOCK_PRIMARY_FOCUS = "Objectif non précisé";
const DERIVED_BLOCK_MODE = "UNSPECIFIED";

/** Adds `days` (possibly 0) to an ISO calendar date in UTC — same technique as the `addDays` helper already used by daily-run/accept-training-plan/generate-training-plan's own Edge Functions. */
function addDaysUtc(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days)).toISOString().slice(0, 10);
}

/**
 * Derives the single `TrainingPlanBlock` for a generation call from the only
 * user-supplied field — `durationWeeks` — plus the server-resolved `today`.
 * V0.5_031 lock: `startDate`/`endDate` are the only computed fields, using
 * inclusive-`endDate` UTC arithmetic matching `WeekSequenceBuilder`'s own
 * inclusive range semantics (`durationWeeks` weeks starting at `today`, both
 * ends inclusive, so `endDate = today + durationWeeks * 7 - 1` days).
 */
export function deriveTrainingPlanBlock(today: string, durationWeeks: number): GenerationEngineInput["block"] {
  return {
    sequenceNumber: DERIVED_BLOCK_SEQUENCE_NUMBER,
    name: DERIVED_BLOCK_NAME,
    mode: DERIVED_BLOCK_MODE,
    primaryFocus: DERIVED_BLOCK_PRIMARY_FOCUS,
    startDate: today,
    endDate: addDaysUtc(today, durationWeeks * 7 - 1),
  };
}

export interface GenerateAndPersistTrainingPlanInput {
  client: SupabaseClient;
  athleteId: string;
  /** Caller-supplied idempotency key — never minted here, always transmitted exactly as received. */
  generationRequestId: string;
  /** The only real user input for block construction — see `deriveTrainingPlanBlock`. Structural validation (integer, >= 1) is the caller's (Edge Function's) responsibility; trusted as-is here, same discipline as `today`/`block` were trusted before V0.5_032. */
  durationWeeks: number;
  today: string;
  /** Defaults to "initial" — the only trigger this ticket's flow (first-time generation) ever produces; kept as a parameter so a future regeneration flow can supply a different value without a signature change. */
  generationTrigger?: GenerationTrigger;
  /** Present only when this version supersedes a prior one. */
  baseVersionId?: string;
}

/**
 * Injectable seam — same reasoning as `RunDailyForDeps`/`ProjectTrainingPlanDeps`/
 * `AcceptTrainingPlanVersionDeps`: lets orchestration (call counts, exact
 * arguments passed through) be unit-tested with plain mocks, without a live
 * DB. Production callers never need to pass this. No DI framework.
 */
export interface GenerateAndPersistTrainingPlanDeps {
  buildPlanInputSnapshot: typeof buildPlanInputSnapshot;
  persistGeneratedTrainingPlan: typeof persistGeneratedTrainingPlan;
}

const DEFAULT_DEPS: GenerateAndPersistTrainingPlanDeps = {
  buildPlanInputSnapshot,
  persistGeneratedTrainingPlan,
};

/**
 * Builds `athleteId`'s `PlanInputSnapshot` as of `today`, then generates and
 * persists a full training plan version from it. Zero direct Supabase RPC
 * call, zero new id minting beyond the hash above, zero lifecycle/accept
 * concern (that is a separate, later composition — see
 * `acceptTrainingPlanVersion.ts`, untouched here).
 */
export async function generateAndPersistTrainingPlan(
  input: GenerateAndPersistTrainingPlanInput,
  deps: GenerateAndPersistTrainingPlanDeps = DEFAULT_DEPS
): Promise<GenerateTrainingPlanVersionResult> {
  const planInputSnapshot = await deps.buildPlanInputSnapshot(input.client, input.athleteId, input.today);

  const generationTrigger = input.generationTrigger ?? DEFAULT_GENERATION_TRIGGER;

  return deps.persistGeneratedTrainingPlan({
    client: input.client,
    generation: {
      block: deriveTrainingPlanBlock(input.today, input.durationWeeks),
      planInputSnapshot,
      generationRequestId: input.generationRequestId,
    },
    versionMetadata: {
      athleteId: input.athleteId,
      ...(input.baseVersionId !== undefined ? { baseVersionId: input.baseVersionId } : {}),
      plannerVersion: PLANNING_ENGINE_VERSION,
      rulesetVersion: PLANNING_ENGINE_VERSION,
      prescriptionSchemaVersion: PRESCRIPTION_SCHEMA_VERSION,
      generationTrigger,
      rationale: RATIONALE_FOR_TRIGGER[generationTrigger],
      inputSnapshotSchemaVersion: INPUT_SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotHash: hashInputSnapshot(planInputSnapshot),
    },
  });
}
