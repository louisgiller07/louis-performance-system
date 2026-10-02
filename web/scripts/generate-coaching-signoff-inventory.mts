// UX-11R.1 — generates the coaching content sign-off inventory (release
// gate) from the VERSIONED sources only: planning-engine V2 catalogues and
// the web label mirror. It lists every V2 content entry, all currently
// "PROVISIONAL — coaching validation required", with empty reviewer / date:
// nothing is ever marked validated by code.
//
// Run once to create the document: `npx tsx scripts/generate-coaching-signoff-inventory.mts`
// (from web/). Re-running OVERWRITES the file — only before human review starts.
import { writeFileSync } from "node:fs";
import * as catalog from "../../planning-engine/src/catalog/index.ts";
import { drillNameV2, exerciseNameV2, ENDURANCE_ACTIVITY_LABELS_V2, SUPPORTED_SESSION_MODEL_V2_MANIFEST } from "../src/features/finalPrescriptionV2/sessionModelV2Support.ts";

const OUT = new URL("../../docs/release/COACHING_CONTENT_SIGNOFF.md", import.meta.url);
const cell = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v)).replace(/\|/g, "\\|").replace(/\n/g, " ");
const range = (r: { min: number; max: number } | undefined, unit = "") => (r ? (r.min === r.max ? `${r.min}${unit}` : `${r.min}–${r.max}${unit}`) : "—");
const rows: string[] = [];
let count = 0;
function section(title: string, version: string, source: string, entries: Array<[string, string]>) {
  rows.push(`\n## ${title}\n\nVersion : \`${version}\` · Source : \`${source}\`\n`);
  rows.push("| Content id | Current value | Status | Reviewer | Date | Note |");
  rows.push("|---|---|---|---|---|---|");
  for (const [id, value] of entries) {
    rows.push(`| \`${cell(id)}\` | ${cell(value)} | pending | | | |`);
    count += 1;
  }
}

const m = SUPPORTED_SESSION_MODEL_V2_MANIFEST as Record<string, string>;

section(
  "Strength templates",
  m.templates ?? "?",
  "planning-engine/src/catalog/strengthTemplateCatalogV2.ts",
  Object.values(catalog.STRENGTH_TEMPLATE_CATALOG_V2).map((t: any) => [
    t.templateId,
    `${t.sessionKind} · ${t.athleteTier} · warm-up: ${[...t.warmUp.mobility, ...t.warmUp.activation].map((x: any) => `${x.exerciseId}×${x.sets}`).join(", ")} · work: ${t.workSlots.map((s: any) => `${s.blockRole}/${s.role}[${s.candidates.join(" > ")}]`).join("; ")}`,
  ])
);

section(
  "Strength doses",
  m.strengthDoses ?? "?",
  "planning-engine/src/catalog/strengthDoseCatalogV2.ts",
  Object.entries(catalog.STRENGTH_DOSE_CATALOG_V2).flatMap(([load, byRole]: [string, any]) =>
    Object.entries(byRole).map(([role, d]: [string, any]) => [
      `${load}.${role}`,
      `${d.sets} sets × ${d.volume.reps ? range(d.volume.reps, " reps") : d.volume.durationSeconds ? range(d.volume.durationSeconds, " s") : cell(d.volume)} · RPE ${range(d.rpeTarget)} · rest ${range(d.restSeconds, " s")}`,
    ])
  ) as Array<[string, string]>
);

const policy = catalog.PLAN_DOSE_POLICY_V2 as any;
section(
  "Plan dose policy (incl. DH duration and DH passes per phase, endurance durations, Force durations)",
  m.planDosePolicy ?? "?",
  "planning-engine/src/catalog/planDosePolicyV2.ts",
  Object.entries(policy)
    .filter(([k, v]) => k !== "validationStatus" && v !== null && typeof v === "object")
    .flatMap(([phase, v]: [string, any]) => Object.entries(v).map(([k, x]) => [`${phase}.${k}`, cell(x)])) as Array<[string, string]>
);

section("DH drill passes (global range)", m.drills ?? "?", "planning-engine/src/catalog/sessionDrillCatalogV2.ts", [["DH_DRILL_PASSES_RANGE_V2", range(catalog.DH_DRILL_PASSES_RANGE_V2, " passes")]]);
section(
  "DH drills (name, skill, tier, terrain, passes)",
  m.drills ?? "?",
  "planning-engine/src/catalog/sessionDrillCatalogV2.ts + web trainingLabels (name)",
  Object.values(catalog.SESSION_DRILL_CATALOG_V2).map((d: any) => [
    d.drillId,
    `« ${drillNameV2(d.drillId) ?? "?"} » · ${d.skill} · ${d.technicalTier} · ${d.requiredTerrain} · ${range(d.passes, " passes")} · cue ${d.cueId} · criterion ${d.criterionId}${d.vigilanceIds?.length ? ` · vigilances ${d.vigilanceIds.join(", ")}` : ""}`,
  ])
);

section(
  "Session protocols (endurance durations, warm-up / cool-down, activity choice)",
  m.protocols ?? "?",
  "planning-engine/src/catalog/protocolCatalogV2.ts",
  Object.values(catalog.PROTOCOL_CATALOG_V2).map((p: any) => [p.protocolId, cell({ ...p, validationStatus: undefined })])
);

section(
  "Endurance activity labels",
  m.protocols ?? "?",
  "web/src/features/finalPrescriptionV2/sessionModelV2Support.ts",
  Object.entries(ENDURANCE_ACTIVITY_LABELS_V2).map(([id, label]) => [`activity.${id}`, label])
);

section(
  "Exercises (name, measure, reference prescription, roles, tiers)",
  m.exercises ?? "?",
  "planning-engine/src/catalog/sessionExerciseCatalogV2.ts + web trainingLabels (name)",
  Object.values(catalog.SESSION_EXERCISE_CATALOG_V2).map((e: any) => [
    e.exerciseId,
    `« ${exerciseNameV2(e.exerciseId) ?? "?"} » · ${e.measureType}${e.perSide ? " per side" : ""} · reference ${cell(e.referencePrescription)} · roles ${e.roles.join(", ")} · tiers ${e.tiers.join(", ")}${e.vigilanceIds?.length ? ` · vigilances ${e.vigilanceIds.join(", ")}` : ""}`,
  ])
);

section(
  "Session intents",
  m.intents ?? "?",
  "planning-engine/src/catalog/intentCatalogV2.ts",
  Object.values(catalog.INTENT_CATALOG_V2).map((i: any) => [i.intentId, `${i.family} · ${i.sessionKinds.join(", ")} · text ${i.textId}`])
);

for (const kind of ["cue", "success_criterion", "vigilance", "instruction", "intent"]) {
  section(
    `Coaching texts — ${kind}`,
    catalog.COACHING_TEXT_CATALOG_VERSION,
    "planning-engine/src/catalog/coachingTextCatalog.ts",
    catalog.COACHING_TEXT_CATALOG_ENTRIES.filter((t: any) => t.kind === kind).map((t: any) => [t.id, t.text["fr-CH"]])
  );
}

const header = `# Coaching content sign-off — release gate (UX-11R.1)

Generated from the versioned sources of manifest \`${m.aggregate}\` by \`web/scripts/generate-coaching-signoff-inventory.mts\`.
Every entry below is currently **${catalog.PROVISIONAL_NOTICE}** (\`validationStatus: "PROVISIONAL"\` in code). Total: ${count} entries.

**Gate rule.** V2 content may reach athletes beyond an internal pilot only once every entry is \`validated\` (or \`rejected\` and replaced by a new
catalogue version, itself reviewed). Status values: \`pending\` · \`validated\` · \`rejected\`. Reviewer and date are filled in by the human
reviewer only: code never marks an entry validated and never invents a reviewer. A validated entry is tied to the version shown in its
section; a change of value means a new catalogue version and a new review. Turning \`validationStatus\` to \`VALIDATED\` in code is a
separate, reviewed change that follows this document, never the reverse.

Manifest components: ${Object.entries(m).map(([k, v]) => `${k} \`${v}\``).join(" · ")}.
`;
writeFileSync(OUT, header + rows.join("\n") + "\n");
console.log(`wrote ${count} entries`);
