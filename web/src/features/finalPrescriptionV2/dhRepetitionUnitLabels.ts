// V2-DH-UNIT-01 — a DH count in its stated unit. A historical count states no unit and keeps
// its previous wording (« passages »): it is never shown as sections or full descents.
import type { DhRepetitionUnitView } from "./finalPrescriptionV2Types";

const NOUNS: Readonly<Record<DhRepetitionUnitView | "UNKNOWN", { one: string; many: string; recorded: string }>> = {
  SECTION: { one: "section", many: "sections", recorded: "enregistrées" },
  FULL_RUN: { one: "descente complète", many: "descentes complètes", recorded: "enregistrées" },
  UNKNOWN: { one: "passage", many: "passages", recorded: "enregistrés" },
};

const nouns = (unit: DhRepetitionUnitView | undefined) => NOUNS[unit ?? "UNKNOWN"];

export const dhCountLabel = (n: number, unit?: DhRepetitionUnitView) => `${n} ${n > 1 ? nouns(unit).many : nouns(unit).one}`;

export const dhRecordedCountLabel = (recorded: number, planned: number, unit?: DhRepetitionUnitView) =>
  `${recorded} / ${planned} ${nouns(unit).many} ${nouns(unit).recorded}`;
