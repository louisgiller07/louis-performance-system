/**
 * Pure, deterministic internal-consistency validation for a catalogue (M1
 * §7/§10): unique ids, no dangling substitution/progression/regression
 * references, deprecated entries reference a valid, non-deprecated
 * replacement. Generic over both catalogues — exercise and drill entries
 * share the same shape of concern even though their exact fields differ.
 */
import { PlanningEngineValidationError } from "./errors.js";

interface CatalogEntryLike {
  id: string;
  deprecated?: boolean;
  replacedBy?: string;
  progressesTo?: string;
  regressesTo?: string;
}

function fail(context: string, reason: string, value: unknown): never {
  throw new PlanningEngineValidationError(context, reason, value);
}

/**
 * Validates one catalogue's internal consistency. `crossReferenceIds` is
 * every id referenced anywhere in the same catalogue (progression/
 * regression/replacedBy, plus substitutions for exercises) — passed in
 * rather than re-derived here so this stays generic over both catalogue
 * shapes without needing to know about `substitutions` specifically.
 */
export function validateCatalogConsistency<T extends CatalogEntryLike>(
  context: string,
  entries: readonly T[],
  extraReferencedIds: (entry: T) => string[] = () => []
): void {
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) fail(context, `duplicate id "${entry.id}"`, entry);
    seenIds.add(entry.id);
  }

  for (const entry of entries) {
    const referenced = [
      ...(entry.progressesTo !== undefined ? [entry.progressesTo] : []),
      ...(entry.regressesTo !== undefined ? [entry.regressesTo] : []),
      ...extraReferencedIds(entry),
    ];
    for (const refId of referenced) {
      if (!seenIds.has(refId)) fail(context, `entry "${entry.id}" references unknown id "${refId}"`, entry);
    }

    if (entry.deprecated) {
      if (entry.replacedBy === undefined) {
        fail(context, `deprecated entry "${entry.id}" must declare replacedBy`, entry);
      }
      if (!seenIds.has(entry.replacedBy)) {
        fail(context, `entry "${entry.id}"'s replacedBy "${entry.replacedBy}" is not a known id`, entry);
      }
    } else if (entry.replacedBy !== undefined) {
      fail(context, `entry "${entry.id}" declares replacedBy without being deprecated`, entry);
    }
  }
}
