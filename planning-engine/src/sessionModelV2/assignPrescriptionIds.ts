/**
 * UX-11A.5b.2 — attaches identity ids to pure sport content, after it was
 * built. The id strategy belongs to the orchestrator (random UUIDs in
 * production, ADR UX-11A.5b.0.1), injected as `mintId`; this module never
 * generates an id itself and never derives one from the content.
 * `derivedFromItemId` is never set here: it only exists on a daily final
 * prescription (UX-11A.5c).
 */
import type { BlockV2, PrescriptionItemV2, PrescriptionItemV2Content, PrescriptionV2, PrescriptionV2Content } from "./prescriptionV2.js";

export function assignPrescriptionIds(content: PrescriptionV2Content, mintId: () => string): PrescriptionV2 {
  const blocks: BlockV2[] = content.blocks.map((block) => ({
    ...block,
    blockId: mintId(),
    items: block.items.map((item: PrescriptionItemV2Content): PrescriptionItemV2 => ({ ...item, prescriptionItemId: mintId() })),
  }));
  return { ...content, blocks };
}
