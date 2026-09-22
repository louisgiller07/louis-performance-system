/**
 * planning-engine — V0.4 M1: pure contracts, versioned catalogues, and
 * validators only. See README.md. No planning algorithm, no repository
 * layer, no I/O exists in this package yet.
 */
export * from "./types/index.js";
export * from "./catalog/index.js";
export * from "./validation/index.js";
// pipeline/planningPipelineOrchestrator.js is the one pipeline module meant
// to cross this package's boundary — runPlanningPipeline is the whole
// point of consuming this package from an outer orchestrator (head-coach-engine,
// V0.4_142). The 7 individual pure modules it composes stay internal.
export * from "./pipeline/planningPipelineOrchestrator.js";
