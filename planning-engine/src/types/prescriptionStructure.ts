/**
 * PrescriptionStructure — the top-level discriminated union both
 * PlannedPrescription and FinalPrescription carry as their typed `structure`
 * (M0 §4/§9). Bounded to two domains for V1 — adding a third domain later
 * means adding a union member, not redesigning the container.
 */
import type { StrengthPrescription } from "./strengthPrescription.js";
import type { DhTechnicalPrescription } from "./dhPrescription.js";

export type PrescriptionStructure = StrengthPrescription | DhTechnicalPrescription;
