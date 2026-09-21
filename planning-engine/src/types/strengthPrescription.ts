/**
 * StrengthPrescription — V1 typed structure for a strength session (M0 §4).
 * `exerciseId` references catalog/exerciseCatalog.ts — never display text
 * where a stable id belongs (catalogue owns display text/equipment/
 * progression metadata; a prescription only references it).
 */

export type StrengthBlockRole = "warm_up" | "work" | "accessory";

export type RepScheme =
  | { type: "fixed"; reps: number }
  | { type: "range"; min: number; max: number }
  | { type: "time"; seconds: number }
  | { type: "amrap" };

export type Intensity =
  | { type: "rpe"; target: number } // 0-10
  | { type: "rir"; target: number } // reps in reserve, >= 0
  | { type: "percent_1rm"; value: number } // 0-100+
  | { type: "fixed_load_kg"; value: number }
  | { type: "training_max_percent"; value: number } // 0-100+
  | { type: "bodyweight" };

export interface StrengthBlock {
  role: StrengthBlockRole;
  /** Catalogue id — see catalog/exerciseCatalog.ts. Never a display string. */
  exerciseId: string;
  sets: number;
  repScheme: RepScheme;
  intensity: Intensity;
  restSeconds: number;
  /** Free but bounded format, e.g. "3-1-1-0" (eccentric-pause-concentric-pause), validated as a loose pattern only — not a closed vocabulary. */
  tempo?: string;
  unilateral?: boolean;
  /** Present only when this block IS a substitution for the originally-catalogued choice — the exerciseId actually prescribed here already reflects the substitute; this field just records that a substitution happened and what it replaced. */
  substitutionOf?: string;
}

export interface StrengthPrescription {
  domain: "strength";
  schemaVersion: string;
  blocks: StrengthBlock[];
}
