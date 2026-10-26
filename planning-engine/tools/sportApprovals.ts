/**
 * V2-DH-RELEASE-GATES-01 (HPM 2026-10-26) — provenance of the DH sports sign-offs (U, C, D, S and the common DH
 * validation). Pure: node:crypto only; the caller passes the tables, the registry, the records and the gate.
 *
 * A reference in DH_SPORT_SIGNOFFS_V2 / DH_SPORT_COMMON_SIGNOFF_V2 counts only when it names an APPROVAL RECORD
 * (`approval:<drill>/<decision>`, `approval:common/common`): one decision of one human validator — the subject, the
 * decision, the verdict ACCEPT, the catalogue versions, the sha256 of the exact content approved, the dossier
 * consulted — signed (Ed25519) with that validator's key. The validator must be listed in the registry with the
 * decisions they may sign. verifySportApprovals() returns every failure; an empty list is the only pass.
 * Erasable TypeScript only (run by `node tools/sportApprovalsCli.ts`).
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const APPROVAL_SCHEMA = "nalynt-dh-sport-approval/1";
export const DH_APPROVAL_DECISIONS = ["unit", "cue", "dose", "safety"] as const;
export type ApprovalDecision = (typeof DH_APPROVAL_DECISIONS)[number] | "common";
export const COMMON_SUBJECT = "common";

export interface ApprovalCatalog {
  drills: string;
  texts: string;
  intents: string;
  planDosePolicy: string;
  signoffs: string;
}

export interface ApprovalRecord {
  schema: typeof APPROVAL_SCHEMA;
  /** The drill id, or "common" for the common DH validation. */
  subject: string;
  decision: ApprovalDecision;
  verdict: "ACCEPT";
  catalog: ApprovalCatalog;
  /** sha256 of the canonical JSON of the content approved (the sign-off part without its `decision` reference). */
  contentSha256: string;
  validatorId: string;
  approvedAt: string;
  /** The dossier consulted, as path@commit (the human-readable proof). */
  dossier: string;
}

export interface SignedApproval {
  record: ApprovalRecord;
  /** base64 Ed25519 signature of canonicalJson(record). */
  signature: string;
}

export interface SportValidator {
  id: string;
  name: string;
  role: string;
  /** The decisions this validator may sign. */
  decisions: readonly ApprovalDecision[];
  publicKeyPem: string;
  /** The HPM decision that authorised this validator. */
  authorizedBy: string;
}

export interface VerifySportApprovalsInput {
  signoffs: Readonly<Record<string, unknown>>;
  common: unknown;
  validators: readonly SportValidator[];
  approvals: Readonly<Record<string, SignedApproval>>;
  catalog: ApprovalCatalog;
  /** The runtime gate on these tables (dhSportGateV2): its reasons when closed, [] when open. */
  gateReasons: (drillId: string) => readonly string[];
}

export const approvalReference = (subject: string, decision: ApprovalDecision) => `approval:${subject}/${decision}`;

/** JSON with object keys sorted at every depth: the exact bytes signed and hashed. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The sha256 of the content a sign-off part approves: the part without its `decision` reference. */
export function approvedContentSha256(part: unknown): string {
  const { decision: _reference, ...content } = (part ?? {}) as Record<string, unknown>;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export function signApproval(record: ApprovalRecord, privateKeyPem: string): SignedApproval {
  return { record, signature: sign(null, Buffer.from(canonicalJson(record)), createPrivateKey(privateKeyPem)).toString("base64") };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function checkReference(input: VerifySportApprovalsInput, subject: string, decision: ApprovalDecision, part: unknown): string[] {
  const expected = approvalReference(subject, decision);
  const reference = isRecord(part) ? part.decision : undefined;
  if (reference !== expected) return [`${subject}/${decision}: the reference is not the approval record ${expected}`];
  const approval = Object.prototype.hasOwnProperty.call(input.approvals, expected) ? input.approvals[expected] : undefined;
  if (approval === undefined) return [`${expected}: no approval record`];
  const { record, signature } = approval;
  const failures: string[] = [];
  if (record.schema !== APPROVAL_SCHEMA || record.subject !== subject || record.decision !== decision) failures.push(`${expected}: the record is not this subject and decision`);
  if (record.verdict !== "ACCEPT") failures.push(`${expected}: the verdict is not ACCEPT`);
  const validator = input.validators.find((v) => v.id === record.validatorId);
  if (validator === undefined) failures.push(`${expected}: validator ${record.validatorId} is not in the registry`);
  else {
    if (!validator.decisions.includes(decision)) failures.push(`${expected}: validator ${validator.id} may not sign ${decision}`);
    let valid = false;
    try {
      valid = verify(null, Buffer.from(canonicalJson(record)), createPublicKey(validator.publicKeyPem), Buffer.from(signature, "base64"));
    } catch {
      valid = false;
    }
    if (!valid) failures.push(`${expected}: the signature is not ${validator.id}'s signature of this record`);
  }
  if (record.contentSha256 !== approvedContentSha256(part)) failures.push(`${expected}: the content in the table is not the content approved`);
  if (canonicalJson(record.catalog) !== canonicalJson(input.catalog)) failures.push(`${expected}: approved for catalogue ${canonicalJson(record.catalog)}, current ${canonicalJson(input.catalog)}`);
  if (typeof record.dossier !== "string" || !/^\S+@[0-9a-f]{7,40}$/.test(record.dossier)) failures.push(`${expected}: no consultable dossier (path@commit)`);
  return failures;
}

/** Every failure of the sign-off tables against their approvals; [] is the only pass (an empty table passes). */
export function verifySportApprovals(input: VerifySportApprovalsInput): string[] {
  const failures: string[] = [];
  const drills = Object.keys(input.signoffs);
  if (drills.length > 0 || input.common !== null) {
    failures.push(...checkReference(input, COMMON_SUBJECT, "common", input.common));
  }
  for (const drillId of drills) {
    const signoff = input.signoffs[drillId];
    for (const decision of DH_APPROVAL_DECISIONS) failures.push(...checkReference(input, drillId, decision, isRecord(signoff) ? signoff[decision] : undefined));
    const reasons = input.gateReasons(drillId);
    if (reasons.length > 0) failures.push(`${drillId}: the gate does not open on the content served now (${reasons.join(", ")})`);
  }
  return failures;
}

/** The registry (validators.json) and every approval record (records/*.approval.json) of an approvals directory. */
export function readSportApprovals(dir: string): { validators: SportValidator[]; approvals: Record<string, SignedApproval> } {
  const registry = JSON.parse(readFileSync(join(dir, "validators.json"), "utf8")) as { schema: string; validators: SportValidator[] };
  if (registry.schema !== "nalynt-sport-validators/1" || !Array.isArray(registry.validators)) throw new Error(`${dir}/validators.json: not a validators registry`);
  const approvals: Record<string, SignedApproval> = {};
  for (const name of readdirSync(join(dir, "records")).filter((n) => n.endsWith(".approval.json")).sort()) {
    const approval = JSON.parse(readFileSync(join(dir, "records", name), "utf8")) as SignedApproval;
    approvals[approvalReference(approval.record.subject, approval.record.decision)] = approval;
  }
  return { validators: registry.validators, approvals };
}

/** RELEASE-DECISION-PACK-01 — files of an approvals directory that carry private key material (must be none: a key never leaves its validator). */
export function privateKeyMaterial(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/PRIVATE KEY/.test(readFileSync(path, "utf8"))) found.push(path);
    }
  };
  walk(dir);
  return found;
}

