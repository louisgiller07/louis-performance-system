/**
 * UX-11A.5a.2a — Session Model V2 block roles and the DH session frame.
 *
 * Canonical block roles of a v2 prescription (docs/03_COACHING_MODEL.md
 * §Modèle de séance NALYNT V1, 3): brief, warm_up, main, complementary,
 * application, cool_down. `brief` and `application` are used by DH sessions;
 * the DH debrief uses `cool_down` (no separate debrief role in V1).
 *
 * DH frame: only `main` carries counted items (exactly one technical drill,
 * 4–8 passes). Every other DH block carries uncounted instructions only, so
 * no total number of runs can ever be prescribed, displayed or recorded.
 * Not read by any engine yet.
 */
export const SESSION_BLOCK_ROLES_V2 = ["brief", "warm_up", "main", "complementary", "application", "cool_down"] as const;
export type SessionBlockRoleV2 = (typeof SESSION_BLOCK_ROLES_V2)[number];

export interface DhFrameBlockV2 {
  role: SessionBlockRoleV2;
  /** Uncounted instructions (text ids, coachingTextCatalog "instruction.*"). */
  instructionIds: readonly string[];
  /** True only for the block holding the counted technical drill. */
  countedItems: boolean;
}

export const DH_SESSION_FRAME_V2: readonly DhFrameBlockV2[] = [
  { role: "brief", instructionIds: ["instruction.dh.brief"], countedItems: false },
  { role: "warm_up", instructionIds: ["instruction.dh.warm_up_easy"], countedItems: false },
  { role: "main", instructionIds: [], countedItems: true },
  { role: "application", instructionIds: ["instruction.dh.apply_cue"], countedItems: false },
  { role: "cool_down", instructionIds: ["instruction.dh.debrief_and_check"], countedItems: false },
];
