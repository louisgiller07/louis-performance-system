import { describe, expect, it } from "vitest";
// Direct relative source import of the real head-coach-engine package — no
// dependency/workspace/alias exists between web/ and head-coach-engine
// (deliberate, see dailyPlanTypes.ts), but Vite/Vitest resolve a relative
// .ts import across the boundary natively (empirically verified, V0.3_002F,
// reused here per the same proven boundary — see
// ../dailyPlan/DailyPlanView.enriched.test.tsx). Test-only, never
// production code.
import { mapTrainingInterventionToDbSessionType } from "../../../../head-coach-engine/src/mapping/trainingInterventionToDbSessionType.js";
import type { TrainingIntervention as EngineTrainingIntervention } from "../../../../head-coach-engine/src/types/trainingIntervention.js";
import { mapTrainingInterventionToSessionType } from "../dailyPlan/trainingInterventionToSessionType";
import { PLANNABLE_FIXED_LOAD_KINDS, PLANNABLE_LOAD_VARIABLE_KINDS } from "./planningTypes";

/**
 * Regression guard: the web mirror mapper
 * (trainingInterventionToSessionType.ts) that planningRepo.savePlannedSession
 * uses to compute `session_type` must stay byte-for-byte identical to the
 * real backend mapper the engine uses to compute decisions.final_session
 * (head-coach-engine/src/mapping/trainingInterventionToDbSessionType.ts) —
 * for every one of the 16 TrainingInterventionKind values, RACE_ACTIVITY
 * included even though it's never athlete-plannable, since this mapper is
 * shared with dailyPlan's read/display direction.
 */
describe("planning mapper parity — web mirror vs real engine mapper (all 16 kinds)", () => {
  const fixedKinds = [...PLANNABLE_FIXED_LOAD_KINDS, "RACE_ACTIVITY"] as const;
  for (const kind of fixedKinds) {
    it(`${kind} maps identically`, () => {
      const intervention = { kind } as EngineTrainingIntervention;
      expect(mapTrainingInterventionToSessionType(intervention)).toBe(
        mapTrainingInterventionToDbSessionType(intervention)
      );
    });
  }

  for (const kind of PLANNABLE_LOAD_VARIABLE_KINDS) {
    for (const load_profile of ["HEAVY", "MODERATE", "LIGHT"] as const) {
      it(`${kind} / ${load_profile} maps identically`, () => {
        const intervention = { kind, load_profile } as EngineTrainingIntervention;
        expect(mapTrainingInterventionToSessionType(intervention)).toBe(
          mapTrainingInterventionToDbSessionType(intervention)
        );
      });
    }
  }
});
