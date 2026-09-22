/**
 * Typed error shapes for prescription-engine (V0.4_124 §5, V0.4_126 §2/§3).
 * Same discipline as planning-engine's PlanningEngineValidationError: throw
 * a typed error carrying enough context to diagnose, never silently coerce
 * or invent a plausible-looking value.
 *
 * UnsupportedPrescriptionKindError / NoCompatibleExerciseError /
 * NoCompatibleDrillError are the three real, expected error conditions
 * locked in V0.4_124 §5. PendingProductDecisionError is not a prescription
 * failure — it is the explicit, honest stand-in for the three fields with
 * no approved V1 source (StrengthBlock.repScheme outside amrap,
 * StrengthBlock.restSeconds, DhDrill.executionCue — V0.4_126) so the
 * scaffolded resolvers never fabricate a value in their place.
 */

export class UnsupportedPrescriptionKindError extends Error {
  constructor(public readonly kind: string) {
    super(`PrescriptionEngine: unsupported SessionKind "${kind}" — no domain-level resolver exists for it`);
    this.name = "UnsupportedPrescriptionKindError";
  }
}

export class NoCompatibleExerciseError extends Error {
  constructor(
    public readonly movementCategory: string,
    public readonly reason: string
  ) {
    super(`PrescriptionEngine: no compatible exercise found for movement category "${movementCategory}" — ${reason}`);
    this.name = "NoCompatibleExerciseError";
  }
}

export class NoCompatibleDrillError extends Error {
  constructor(
    public readonly skillTarget: string,
    public readonly reason: string
  ) {
    super(`PrescriptionEngine: no compatible drill found for skill target "${skillTarget}" — ${reason}`);
    this.name = "NoCompatibleDrillError";
  }
}

export class PendingProductDecisionError extends Error {
  constructor(
    public readonly field: string,
    public readonly context: string
  ) {
    super(
      `PrescriptionEngine: field "${field}" has no approved V1 source (${context}) — blocked pending an explicit product/catalogue decision, see docs/11_DECISION_LOG.md`
    );
    this.name = "PendingProductDecisionError";
  }
}
