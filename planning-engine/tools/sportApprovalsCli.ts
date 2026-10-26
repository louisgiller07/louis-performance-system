// V2-DH-RELEASE-GATES-01 (HPM 2026-10-26) — the DH sports approvals CLI. Reads the BUILT engine (`npm run build`).
//   node tools/sportApprovalsCli.ts verify
//       every sign-off reference against sport-approvals/ (registry, signed records) and the content served now;
//       exit 1 on any failure (verify:sport-approvals, head-coach-engine build:release, the CI check to require)
//   node tools/sportApprovalsCli.ts prepare <drill|common> <unit|cue|dose|safety|common> <validatorId> <dossier@commit> [SECTION|FULL_RUN]
//       prints the exact content served now, the record to sign and the table line it justifies
//   node tools/sportApprovalsCli.ts sign <record.json> <private-key.pem>
//       run by the validator only, with their own key: prints the signed approval for sport-approvals/records/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APPROVAL_SCHEMA, approvalReference, approvedContentSha256, COMMON_SUBJECT, privateKeyMaterial, readSportApprovals, signApproval, verifySportApprovals, type ApprovalDecision, type ApprovalRecord } from "./sportApprovals.ts";

const dist = (path: string) => import(new URL(`../dist/${path}`, import.meta.url).href);
const tables = await dist("catalog/dhRepetitionUnitCatalogV2.js");
const gate = await dist("sessionModelV2/dhSportGateV2.js");
const catalog = {
  drills: (await dist("catalog/sessionDrillCatalogV2.js")).SESSION_DRILL_CATALOG_V2_VERSION,
  texts: (await dist("catalog/coachingTextCatalog.js")).COACHING_TEXT_CATALOG_VERSION,
  intents: (await dist("catalog/intentCatalogV2.js")).INTENT_CATALOG_V2_VERSION,
  planDosePolicy: (await dist("catalog/planDosePolicyV2.js")).PLAN_DOSE_POLICY_V2_VERSION,
  signoffs: tables.DH_REPETITION_UNIT_CATALOG_V2_VERSION,
};
const APPROVALS_DIR = fileURLToPath(new URL("../sport-approvals/", import.meta.url));
const [command, ...args] = process.argv.slice(2);

if (command === "verify") {
  const { validators, approvals } = readSportApprovals(APPROVALS_DIR);
  const failures = privateKeyMaterial(APPROVALS_DIR).map((file) => `${file}: private key material (a key never leaves its validator)`);
  failures.push(...verifySportApprovals({
    signoffs: tables.DH_SPORT_SIGNOFFS_V2,
    common: tables.DH_SPORT_COMMON_SIGNOFF_V2,
    validators,
    approvals,
    catalog,
    gateReasons: (drillId) => {
      const g = gate.dhSportGateV2(drillId, tables.DH_SPORT_SIGNOFFS_V2[drillId], tables.DH_SPORT_COMMON_SIGNOFF_V2);
      return g.open ? [] : g.reasons;
    },
  }));
  console.log(`sport approvals: ${Object.keys(tables.DH_SPORT_SIGNOFFS_V2).length} signed drill(s), common ${tables.DH_SPORT_COMMON_SIGNOFF_V2 === null ? "absent" : "present"}, ${validators.length} validator(s), ${Object.keys(approvals).length} record(s)`);
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(failures.length === 0 ? "PASS" : `${failures.length} failure(s)`);
  process.exit(failures.length === 0 ? 0 : 1);
} else if (command === "prepare") {
  const [subject, decision, validatorId, dossier, unit] = args as [string, ApprovalDecision, string, string, string | undefined];
  const reference = approvalReference(subject, decision);
  const served = subject === COMMON_SUBJECT ? gate.dhServedCommonContentV2() : gate.dhServedSportContentV2(subject);
  if (served === null) throw new Error(`nothing served for ${subject}`);
  const content: Record<ApprovalDecision, Record<string, unknown>> = {
    unit: { unit },
    cue: { drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
    dose: { doseTerms: served.doseTerms },
    safety: { vigilanceTexts: served.vigilanceTexts, regressesTo: served.regressesTo, terrains: served.terrains },
    common: { frame: served.frame, objectives: served.objectives },
  };
  if (decision === "unit" && unit !== "SECTION" && unit !== "FULL_RUN") throw new Error("unit: give SECTION or FULL_RUN");
  const tablePart = { decision: reference, ...content[decision] };
  const record: ApprovalRecord = { schema: APPROVAL_SCHEMA, subject, decision, verdict: "ACCEPT", catalog, contentSha256: approvedContentSha256(tablePart), validatorId, approvedAt: new Date().toISOString(), dossier };
  console.log(JSON.stringify({ record, tablePart }, null, 2));
} else if (command === "sign") {
  const [recordFile, keyFile] = args as [string, string];
  console.log(JSON.stringify(signApproval(JSON.parse(readFileSync(recordFile, "utf8")) as ApprovalRecord, readFileSync(keyFile, "utf8")), null, 2));
} else {
  console.error("usage: node tools/sportApprovalsCli.ts verify | prepare <drill|common> <decision> <validatorId> <dossier@commit> [unit] | sign <record.json> <key.pem>");
  process.exit(2);
}
