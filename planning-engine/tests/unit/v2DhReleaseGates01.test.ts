/**
 * V2-DH-RELEASE-GATES-01 (HPM 2026-10-26) — provenance of the four sports validations (tools/sportApprovals.ts).
 *
 * Production: the registry lists no validator and holds no record — nothing real or invented is signed — and the empty
 * tables verify. Fixtures: EPHEMERAL Ed25519 keys generated here (TEST validators, never written to the repository),
 * signing TEST approvals of the content served now: the only pass is a complete, authorised, untouched chain.
 */
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as gateModule from "../../src/sessionModelV2/dhSportGateV2.js";
import * as tables from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import { SESSION_DRILL_CATALOG_V2_VERSION } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG_VERSION } from "../../src/catalog/coachingTextCatalog.js";
import { INTENT_CATALOG_V2_VERSION } from "../../src/catalog/intentCatalogV2.js";
import { PLAN_DOSE_POLICY_V2_VERSION } from "../../src/catalog/planDosePolicyV2.js";
import {
  APPROVAL_SCHEMA,
  approvalReference,
  approvedContentSha256,
  privateKeyMaterial,
  readSportApprovals,
  signApproval,
  verifySportApprovals,
  type ApprovalDecision,
  type ApprovalRecord,
  type SignedApproval,
  type SportValidator,
} from "../../tools/sportApprovals.js";

const CATALOG = { drills: SESSION_DRILL_CATALOG_V2_VERSION, texts: COACHING_TEXT_CATALOG_VERSION, intents: INTENT_CATALOG_V2_VERSION, planDosePolicy: PLAN_DOSE_POLICY_V2_VERSION, signoffs: tables.DH_REPETITION_UNIT_CATALOG_V2_VERSION };
const DOSSIER = "docs/review/sport-plan-03/DH_SPORT_SIGNOFF_01.md@1a3a0b3";
const DRILL = "cornering_berm_speed";
const gateReasons = (signoffs: Record<string, unknown>, common: unknown) => (drillId: string) => {
  const g = gateModule.dhSportGateV2(drillId, signoffs[drillId], common);
  return g.open ? [] : [...g.reasons];
};

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
const coachKeys = keyPair();
const hpmKeys = keyPair();
const strangerKeys = keyPair();
const VALIDATORS: SportValidator[] = [
  { id: "test-coach-dh", name: "TEST coach DH (ephemeral key)", role: "coach DH", decisions: ["unit", "cue", "dose"], publicKeyPem: coachKeys.publicPem, authorizedBy: "TEST fixture" },
  { id: "test-hpm", name: "TEST HPM (ephemeral key)", role: "HPM", decisions: ["safety", "common"], publicKeyPem: hpmKeys.publicPem, authorizedBy: "TEST fixture" },
];

/** A complete TEST chain for one drill: the table lines (served content) and their signed approvals. */
function chain() {
  const served = gateModule.dhServedSportContentV2(DRILL)!;
  const content: Record<string, Record<string, unknown>> = {
    unit: { unit: "SECTION" },
    cue: { drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
    dose: { doseTerms: served.doseTerms },
    safety: { vigilanceTexts: [...served.vigilanceTexts], regressesTo: served.regressesTo, terrains: [...served.terrains] },
  };
  const approvals: Record<string, SignedApproval> = {};
  const approve = (subject: string, decision: ApprovalDecision, part: Record<string, unknown>, validatorId: string, privatePem: string) => {
    const record: ApprovalRecord = { schema: APPROVAL_SCHEMA, subject, decision, verdict: "ACCEPT", catalog: CATALOG, contentSha256: approvedContentSha256(part), validatorId, approvedAt: "2026-10-26T09:00:00Z", dossier: DOSSIER };
    approvals[approvalReference(subject, decision)] = signApproval(record, privatePem);
  };
  const signoff: Record<string, Record<string, unknown>> = {};
  for (const decision of ["unit", "cue", "dose", "safety"] as const) {
    signoff[decision] = { decision: approvalReference(DRILL, decision), ...content[decision] };
    const hpm = decision === "safety";
    approve(DRILL, decision, signoff[decision]!, hpm ? "test-hpm" : "test-coach-dh", hpm ? hpmKeys.privatePem : coachKeys.privatePem);
  }
  const common = { decision: approvalReference("common", "common"), ...gateModule.dhServedCommonContentV2()! };
  approve("common", "common", common, "test-hpm", hpmKeys.privatePem);
  const signoffs: Record<string, unknown> = { [DRILL]: signoff };
  return { signoffs, common, approvals, approve };
}
const check = (c: { signoffs: Record<string, unknown>; common: unknown; approvals: Record<string, SignedApproval> }, validators: SportValidator[] = VALIDATORS) =>
  verifySportApprovals({ signoffs: c.signoffs, common: c.common, validators, approvals: c.approvals, catalog: CATALOG, gateReasons: gateReasons(c.signoffs, c.common) });

describe("V2-DH-RELEASE-GATES-01 · provenance in production", () => {
  it("no validator, no record, empty tables: nothing real or invented is signed, and the verification passes", () => {
    const dir = fileURLToPath(new URL("../../sport-approvals/", import.meta.url));
    const { validators, approvals } = readSportApprovals(dir);
    expect(privateKeyMaterial(dir)).toEqual([]);
    expect(validators).toEqual([]);
    expect(approvals).toEqual({});
    expect(tables.DH_SPORT_SIGNOFFS_V2).toEqual({});
    expect(tables.DH_SPORT_COMMON_SIGNOFF_V2).toBeNull();
    expect(verifySportApprovals({ signoffs: tables.DH_SPORT_SIGNOFFS_V2, common: tables.DH_SPORT_COMMON_SIGNOFF_V2, validators, approvals, catalog: CATALOG, gateReasons: gateReasons({}, null) })).toEqual([]);
  });

  it("a sign-off line typed into the table without its approvals never passes", () => {
    const c = chain();
    expect(check({ ...c, approvals: {} }).length).toBeGreaterThan(0);
    expect(check({ ...c, approvals: {} }, [])).toContain(`approval:${DRILL}/unit: no approval record`);
  });
});

describe("V2-DH-RELEASE-GATES-01 · TEST chain (ephemeral keys)", () => {
  it("the complete chain passes: four decisions and the common validation, each signed by an authorised validator, content = served", () => {
    const c = chain();
    expect(check(c)).toEqual([]);
    expect(gateModule.dhSportGateV2(DRILL, c.signoffs[DRILL], c.common)).toMatchObject({ open: true });
  });

  it("each break is named: a free-text reference, a missing record, an unknown key, an unauthorised decision, a record altered after signing, another verdict, another catalogue, no dossier", () => {
    const unit = `approval:${DRILL}/unit`;
    const cases: [string, (c: ReturnType<typeof chain>) => void, RegExp][] = [
      ["a free-text reference", (c) => ((c.signoffs[DRILL] as Record<string, Record<string, unknown>>).unit!.decision = "HPM 2026-10-26 OK"), /the reference is not the approval record/],
      ["a missing record", (c) => delete c.approvals[unit], /no approval record/],
      ["signed by an unregistered key", (c) => (c.approvals[unit] = signApproval(c.approvals[unit]!.record, strangerKeys.privatePem)), /is not test-coach-dh's signature/],
      ["safety signed by the coach (not authorised)", (c) => c.approve(DRILL, "safety", (c.signoffs[DRILL] as Record<string, Record<string, unknown>>).safety!, "test-coach-dh", coachKeys.privatePem), /may not sign safety/],
      ["the record altered after signing", (c) => (c.approvals[unit] = { ...c.approvals[unit]!, record: { ...c.approvals[unit]!.record, validatorId: "test-coach-dh", approvedAt: "2026-10-27T09:00:00Z" } }), /signature/],
      ["a verdict other than ACCEPT", (c) => (c.approvals[unit] = signApproval({ ...c.approvals[unit]!.record, verdict: "REFUSE" as "ACCEPT" }, coachKeys.privatePem)), /verdict is not ACCEPT/],
      ["another catalogue version", (c) => (c.approvals[unit] = signApproval({ ...c.approvals[unit]!.record, catalog: { ...CATALOG, drills: "session-drills-v2.1" } }, coachKeys.privatePem)), /approved for catalogue/],
      ["no consultable dossier", (c) => (c.approvals[unit] = signApproval({ ...c.approvals[unit]!.record, dossier: "dossier lu" }, coachKeys.privatePem)), /no consultable dossier/],
    ];
    for (const [label, breakIt, failure] of cases) {
      const c = chain();
      breakIt(c);
      const failures = check(c);
      expect(failures.some((f) => failure.test(f)), `${label}: ${failures.join(" | ")}`).toBe(true);
    }
  });

  it("no silent change: a cue, a dose or a safety line changed in the table, even re-approved, or the common texts unsigned, never pass", () => {
    // Changed in the table only: the approval no longer matches, and the gate stays closed (not the content served).
    const cue = chain();
    const cuePart = (cue.signoffs[DRILL] as Record<string, Record<string, unknown>>).cue!;
    cuePart.cueText = `${cuePart.cueText as string} Variante.`;
    expect(check(cue)).toEqual(expect.arrayContaining([`approval:${DRILL}/cue: the content in the table is not the content approved`, expect.stringMatching(/gate does not open .*cue_text_differs/)]));
    // A new dose, approved and signed for real (valid chain), but not the dose served: the gate refuses it.
    const dose = chain();
    const dosePart = (dose.signoffs[DRILL] as Record<string, Record<string, unknown>>).dose!;
    dosePart.doseTerms = (dosePart.doseTerms as string).replace("race_specific MODERATE 90 min 8", "race_specific MODERATE 90 min 6");
    dose.approve(DRILL, "dose", dosePart, "test-coach-dh", coachKeys.privatePem);
    expect(check(dose)).toEqual([expect.stringMatching(/gate does not open .*dose_terms_differ/)]);
    // A vigilance added to the safety line (cornering_berm_speed serves none).
    const safety = chain();
    (safety.signoffs[DRILL] as Record<string, Record<string, unknown>>).safety!.vigilanceTexts = ["Repère la section à vitesse réduite avant le premier passage."];
    expect(check(safety).some((f) => /safety: the content in the table is not the content approved/.test(f))).toBe(true);
    // The common validation missing.
    const common = chain();
    delete common.approvals["approval:common/common"];
    expect(check(common)).toContain("approval:common/common: no approval record");
  });
});
