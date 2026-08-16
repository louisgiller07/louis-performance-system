/**
 * `health_flags` row → M1 `HealthFlag`. Discriminant column is `flag_type`
 * (confirmed by audit DDL 2026-08-14, docs/05_DATA_MODEL.md §health_flags)
 * mapped to the domain field `type`.
 */
import type { HealthFlag, HealthFlagStatus, HealthFlagType } from "../../types/index.js";
import type { HealthFlagRawRow } from "../repositories/healthFlagsRepo.js";

const HEALTH_FLAG_TYPES: ReadonlySet<string> = new Set([
  "injury_suspect",
  "concussion_suspect",
  "illness",
  "pain_persistent",
  "other",
]);

const HEALTH_FLAG_STATUSES: ReadonlySet<string> = new Set(["active", "monitoring", "resolved"]);

export class InvalidHealthFlagRowError extends Error {
  constructor(reason: string, value: unknown) {
    super(`Invalid health_flags row: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidHealthFlagRowError";
  }
}

/** Throws {@link InvalidHealthFlagRowError} rather than silently accepting an unknown enum value. */
export function mapHealthFlagRow(row: HealthFlagRawRow): HealthFlag {
  if (typeof row.flag_type !== "string" || !HEALTH_FLAG_TYPES.has(row.flag_type)) {
    throw new InvalidHealthFlagRowError("flag_type is missing or unknown", row);
  }
  if (typeof row.status !== "string" || !HEALTH_FLAG_STATUSES.has(row.status)) {
    throw new InvalidHealthFlagRowError("status is missing or unknown", row);
  }

  return {
    type: row.flag_type as HealthFlagType,
    status: row.status as HealthFlagStatus,
  };
}
