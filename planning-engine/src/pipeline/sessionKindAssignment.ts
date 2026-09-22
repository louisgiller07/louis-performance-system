/**
 * SessionKindAssignment (V0.4_108) — pure function choosing the exact
 * SessionKind for each PlacedSlot WeekSegmenter produced. Never reads
 * recentHistory, equipment, races, or weekType; never produces
 * loadProfile/durationMin/doseTarget/prescription content; never modifies
 * the domain it received. `kind`, once assigned here, is immutable for the
 * rest of the pipeline (see V0.4_108 design).
 */
import type { PlacedSlot, SessionDomain } from "./weekSegmenter.js";
import type { SessionKind } from "../types/sharedVocabulary.js";

export interface SessionKindAssignmentEntry extends PlacedSlot {
  kind: SessionKind;
}

export interface SessionKindAssignmentInput {
  placedSlots: readonly PlacedSlot[];
}

export interface SessionKindAssignmentResult {
  assignments: SessionKindAssignmentEntry[];
}

/** Fixed, explicit iteration order — never derived from Set/Map iteration or input array order. */
const DOMAINS: readonly SessionDomain[] = ["strength", "dh_technical", "aerobic"];

function assertNeverDomain(domain: never): never {
  throw new Error(`SessionKindAssignment: unhandled domain "${String(domain)}"`);
}

/**
 * `indexWithinDomain` is the slot's 0-based position among same-domain
 * slots for this week, ordered by ascending date — never the slot's
 * position in the original, unordered `placedSlots` array.
 */
function kindForDomain(domain: SessionDomain, indexWithinDomain: number): SessionKind {
  switch (domain) {
    case "strength":
      // Alternates to avoid prescribing the same muscle group twice in one
      // week — a structural default, never POWER/STRENGTH_FULL_LIGHT (V1
      // scope, see design).
      return indexWithinDomain % 2 === 0 ? "STRENGTH_LOWER" : "STRENGTH_UPPER";
    case "dh_technical":
      return "DH_TECHNICAL";
    case "aerobic":
      return "AEROBIC_BASE";
    default:
      return assertNeverDomain(domain);
  }
}

export function assignSessionKinds(input: SessionKindAssignmentInput): SessionKindAssignmentResult {
  const assignments: SessionKindAssignmentEntry[] = [];

  for (const domain of DOMAINS) {
    const domainSlots = input.placedSlots.filter((slot) => slot.domain === domain).sort((a, b) => a.date.localeCompare(b.date));

    domainSlots.forEach((slot, index) => {
      assignments.push({ date: slot.date, domain: slot.domain, kind: kindForDomain(domain, index) });
    });
  }

  assignments.sort((a, b) => a.date.localeCompare(b.date));

  return { assignments };
}
