/**
 * UX-11A.5b.2 — Session Model V2 module (core types, validator,
 * deterministic primitives). The only business module allowed to import the
 * V2 catalogues directly (and the future V2 templates). Never imported by a
 * V1 engine; deliberately not re-exported from planning-engine's public
 * index until an orchestrator is wired (boundary test).
 */
export * from "./prescriptionV2.js";
export * from "./catalogManifest.js";
export * from "./validatePrescriptionV2.js";
export * from "./assignPrescriptionIds.js";
export * from "./sportFingerprint.js";
export * from "./planInputSnapshotV2.js";
export * from "./generationErrors.js";
export * from "./builders/dhPrescriptionV2.js";
export * from "./builders/dhSessionOrdinals.js";
export * from "./builders/aerobicBasePrescriptionV2.js";
export * from "./builders/recoveryActivePrescriptionV2.js";
export * from "./strengthTiers.js";
export * from "./validateStrengthTemplatesV2.js";
export * from "./builders/strengthPrescriptionV2.js";
export * from "./orchestration/planDoseModelV2.js";
export * from "./orchestration/blockProgressionV2.js";
export * from "./orchestration/generatePlanV2InMemory.js";
export * from "./final/finalPrescriptionV2.js";
export * from "./final/validateKeepFinalPrescriptionV2.js";
export * from "./final/buildKeepFinalPrescriptionV2.js";
export * from "./final/buildFinalPrescriptionV2.js";
export * from "./final/todayTimeLimitV2.js";
