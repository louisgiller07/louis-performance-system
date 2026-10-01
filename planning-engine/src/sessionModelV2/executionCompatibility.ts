/**
 * UX-11A.5b.2 — explicit compatibility with the UX-11B execution write path.
 *
 * `record_session_execution` locates the prescribed item by
 * `prescriptionItemId` and copies the catalogue id it finds under the JSON
 * key `exerciseId` into `exercise_set_results.exercise_id` (UX-11B.2.1 /
 * 11B.2.2, unchanged). The domain model identifies a DH drill by `drillId`;
 * this mapper, and only this mapper, adds the stored key `exerciseId`
 * (= drillId) to drill items of the persisted document, so the execution
 * path keeps recording which drill was done. Exercise items already carry
 * `exerciseId`; activity items get none (never a fake exerciseId).
 *
 * Pure; not called by any persistence yet (5b.x).
 */
import type { PrescriptionV2 } from "./prescriptionV2.js";

export function toExecutionCompatibleDocument(prescription: PrescriptionV2): unknown {
  return {
    ...prescription,
    blocks: prescription.blocks.map((block) => ({
      ...block,
      items: block.items.map((item) => (item.kind === "drill" ? { ...item, exerciseId: item.drillId } : item)),
    })),
  };
}
