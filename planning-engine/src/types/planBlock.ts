/**
 * TrainingPlanBlock — a mesocycle within one TrainingPlanVersion. Supersedes
 * the role of the legacy `training_blocks` table for generated plans (M0
 * Issue 1) — `training_blocks.mode`/`is_current` becomes a mechanically
 * derived projection of the athlete's currently-accepted version's current
 * block, never a second authority. Immutable — belongs entirely to its
 * (immutable) plan version, never edited standalone.
 */
import type { TrainingMode } from "./sharedVocabulary.js";

export interface TrainingPlanBlock {
  id: string;
  planVersionId: string;
  sequenceNumber: number;
  name: string;
  mode: TrainingMode;
  primaryFocus: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}
