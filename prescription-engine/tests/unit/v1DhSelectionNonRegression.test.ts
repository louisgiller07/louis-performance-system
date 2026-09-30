import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StrengthExperienceTier } from "planning-engine";
import { DRILL_CATALOG_ENTRIES } from "planning-engine";
import { selectSkillTarget } from "../../src/dh/skillTargetSelection.js";
import { selectDrill } from "../../src/dh/drillSelection.js";

// UX-11A.5a.2a — non-regression lock on V1 DH selection (skill target +
// drill). Recorded BEFORE the Session Model V2 drill catalogue existed. The
// full matrix is large (priorities × every terrain subset × tier × plan
// session ids), so its SHA-256 fingerprint and size are snapshotted, plus a
// few readable samples. Any change in V1 DH selection changes the hash.
const TERRAINS = [...new Set(DRILL_CATALOG_ENTRIES.map((d) => d.terrainRequirement))].sort();
const TIERS: StrengthExperienceTier[] = ["beginner", "intermediate", "advanced"];
const SKILLS = [...new Set(DRILL_CATALOG_ENTRIES.map((d) => d.skillTarget))].sort();
const PRIORITY_CONFIGS: string[][] = [[], ...SKILLS.map((s) => [s]), ["cornering", "braking"]];
const SESSION_IDS = ["session-a", "session-b", "session-c", "session-d", "session-e"];

function terrainSubsets(): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << TERRAINS.length; mask++) out.push(TERRAINS.filter((_, bit) => (mask & (1 << bit)) !== 0));
  return out;
}

function outcome(fn: () => string): string {
  try {
    return fn();
  } catch (error) {
    return `error:${(error as Error).name}`;
  }
}

function dhSelectionMatrix(): Record<string, string> {
  const matrix: Record<string, string> = {};
  for (const priorityAreas of PRIORITY_CONFIGS) {
    const sessionIds = priorityAreas.length === 0 ? SESSION_IDS : SESSION_IDS.slice(0, 1);
    for (const terrainAccess of terrainSubsets()) {
      for (const strengthExperienceTier of TIERS) {
        for (const generatedPlanSessionId of sessionIds) {
          const key = `${priorityAreas.join("+") || "none"}|${terrainAccess.join("+") || "none"}|${strengthExperienceTier}|${generatedPlanSessionId}`;
          const skill = outcome(() =>
            selectSkillTarget({ technicalPriorities: { strengths: [], weaknesses: [], priorityAreas }, terrainAccess, strengthExperienceTier, generatedPlanSessionId })
          );
          const drill = skill.startsWith("error:") ? skill : outcome(() => selectDrill({ skillTarget: skill, terrainAccess, strengthExperienceTier }));
          matrix[key] = `${skill}>${drill}`;
        }
      }
    }
  }
  return matrix;
}

describe("V1 DH selection — frozen by UX-11A.5a.2a", () => {
  it("keeps every priority × terrain subset × tier × session selection identical", () => {
    const matrix = dhSelectionMatrix();
    const fingerprint = createHash("sha256").update(JSON.stringify(matrix)).digest("hex");
    expect({ size: Object.keys(matrix).length, fingerprint }).toMatchSnapshot();
  });

  it("readable samples stay identical", () => {
    const matrix = dhSelectionMatrix();
    const all = TERRAINS.join("+");
    expect({
      cornering_all_intermediate: matrix[`cornering|${all}|intermediate|session-a`],
      first_priority_only: matrix[`cornering+braking|${all}|advanced|session-a`],
      no_priority_rotation_a: matrix[`none|${all}|beginner|session-a`],
      no_priority_rotation_b: matrix[`none|${all}|beginner|session-b`],
      no_terrain: matrix[`jumps|none|beginner|session-a`],
    }).toMatchSnapshot();
  });
});
