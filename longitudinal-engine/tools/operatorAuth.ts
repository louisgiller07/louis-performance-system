/**
 * V0.3_001B — operator-only preview tooling. Interactive local
 * authentication + project-identity guard + own-athlete resolution +
 * empty-evidence-ledger precondition check. Never imported by
 * `supabase/functions/**`/`web/**`/`head-coach-engine/**`. No credential
 * is ever printed, logged, or persisted — the session lives only in the
 * calling process's memory (see `signOutBestEffort`).
 *
 * Claude Code itself must never run the interactive path in
 * `signInInteractive` — it requires a private TTY it cannot guarantee
 * (see `previewRemoteRefresh.ts`'s own doc and the V0.3_001B review,
 * Section 9). `promptHidden` throws `NoInteractiveTtyError` immediately
 * when `process.stdin.isTTY` is false, which is exactly the signal
 * `previewRemoteRefresh.ts`'s CLI entrypoint uses to stop and hand the
 * operator the manual command instead of attempting credential entry
 * itself.
 */
import { createInterface } from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CORRECT_PROJECT_REF = "uvolpldwwyvadlamulvr";
const FORBIDDEN_PROJECT_REF = "evynmzyjhobdpmxdiwsy";

export class WrongSupabaseProjectError extends Error {
  constructor(reason: string) {
    super(`WrongSupabaseProjectError: ${reason} — this tool refuses to run against anything but the correct project (${CORRECT_PROJECT_REF}).`);
    this.name = "WrongSupabaseProjectError";
  }
}

export class MissingOperatorConfigError extends Error {
  constructor(missing: string) {
    super(`Missing environment configuration: ${missing}. Set it in your OWN shell before running this tool — never hardcoded here.`);
    this.name = "MissingOperatorConfigError";
  }
}

export class NoInteractiveTtyError extends Error {
  constructor() {
    super("NoInteractiveTtyError: this process has no interactive TTY on stdin — refusing to prompt for a password. Run this tool directly in a normal local terminal instead.");
    this.name = "NoInteractiveTtyError";
  }
}

export class NoAthleteForUserError extends Error {
  constructor() {
    super("NoAthleteForUserError: no athlete record exists for the authenticated user.");
    this.name = "NoAthleteForUserError";
  }
}

export class AmbiguousAthleteError extends Error {
  constructor() {
    super("AmbiguousAthleteError: more than one athlete resolved for the authenticated user — refusing to pick one.");
    this.name = "AmbiguousAthleteError";
  }
}

export class LedgerPrivilegeGapError extends Error {
  constructor(cause: string) {
    super(`LedgerPrivilegeGapError: could not safely confirm the athlete's own pattern_evidence_identities count via authenticated RLS (${cause}). Failing closed — never silently assuming an empty ledger.`);
    this.name = "LedgerPrivilegeGapError";
  }
}

/** Asserts the resolved URL is the correct project, in remote mode. Never allows the forbidden project ref, even if it also happens to contain the correct one (defense in depth — checked first, unconditionally). */
export function assertCorrectRemoteProject(url: string): void {
  if (url.includes(FORBIDDEN_PROJECT_REF)) {
    throw new WrongSupabaseProjectError(`resolved URL references the forbidden project ref "${FORBIDDEN_PROJECT_REF}"`);
  }
  if (!url.includes(CORRECT_PROJECT_REF)) {
    throw new WrongSupabaseProjectError(`resolved URL does not reference the correct project ref "${CORRECT_PROJECT_REF}"`);
  }
}

export interface OperatorSupabaseConfig {
  readonly url: string;
  readonly publicKey: string;
}

/**
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY from the
 * environment — same convention as tests/supabase/testDb.ts elsewhere in
 * this package. Never hardcoded. `mode: "remote"` additionally enforces
 * `assertCorrectRemoteProject`; `mode: "local"` (parity testing only)
 * skips that check so it can point at the local stack.
 */
export function resolveOperatorSupabaseConfig(mode: "remote" | "local"): OperatorSupabaseConfig {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new MissingOperatorConfigError("SUPABASE_URL");
  const publicKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!publicKey) throw new MissingOperatorConfigError("SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY");

  if (mode === "remote") assertCorrectRemoteProject(url);

  return { url, publicKey };
}

/** Plain, echoed prompt (email is not a secret). */
async function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Hidden-input prompt (password) — raw-mode stdin, echo suppressed,
 * newline printed once on submit. Requires a real interactive TTY; throws
 * `NoInteractiveTtyError` immediately otherwise, never falling back to a
 * visible/echoed read.
 */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new NoInteractiveTtyError());
      return;
    }
    process.stdout.write(question);
    const wasRaw = stdin.isRaw ?? false;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let input = "";
    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (char: string) => {
      if (char === "\n" || char === "\r") {
        cleanup();
        process.stdout.write("\n");
        resolve(input);
        return;
      }
      if (char === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Aborted (Ctrl+C)."));
        return;
      }
      const code = char.charCodeAt(0);
      if (code === 127 || code === 8) {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };
    stdin.on("data", onData);
  });
}

export interface InteractiveSession {
  readonly client: SupabaseClient;
}

/**
 * Prompts for email (visible) + password (hidden), signs in once, and
 * returns an authenticated client with NO session persistence and NO
 * background refresh — the token exists only for this process's lifetime.
 * Never logs the email/password/session/JWT/refresh_token.
 */
export async function signInInteractive(config: OperatorSupabaseConfig): Promise<InteractiveSession> {
  // Checked BEFORE any prompt at all, including the visible email prompt —
  // a non-TTY stdin (exactly what Claude Code's own Bash tool presents)
  // must never see even the email question, let alone silently read EOF as
  // an empty answer and proceed. promptHidden has its own identical guard
  // for defense in depth, but credential entry must never begin without
  // this check succeeding first.
  if (!process.stdin.isTTY) {
    throw new NoInteractiveTtyError();
  }

  const email = await promptVisible("Email: ");
  const password = await promptHidden("Password (hidden): ");

  const client = createClient(config.url, config.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase auth error messages are safe, generic strings (e.g. "Invalid
    // login credentials") — never the password/token itself.
    throw new Error(`Sign-in failed: ${error.message}`);
  }

  return { client };
}

/** Best-effort — never throws; a failed sign-out just means the short-lived in-memory session expires naturally (persistSession is already false, so nothing is left on disk regardless). */
export async function signOutBestEffort(client: SupabaseClient): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    /* best-effort only */
  }
}

/** Resolves exactly one athlete for the authenticated user via RLS-scoped `.from("athletes")` — identical pattern to daily-run/refresh-longitudinal's own athlete resolution. Returns the id for internal use only; callers must never print it. */
export async function resolveOwnAthleteId(client: SupabaseClient): Promise<string> {
  const { data: athletes, error } = await client.from("athletes").select("id");
  if (error) throw new Error(`Athlete resolution failed: ${error.message}`);
  if (!athletes || athletes.length === 0) throw new NoAthleteForUserError();
  if (athletes.length > 1) throw new AmbiguousAthleteError();
  return (athletes[0] as { id: string }).id;
}

/**
 * Confirms the target athlete's OWN `pattern_evidence_identities` count is
 * 0 via the authenticated RLS-scoped client (never service_role — the
 * `authenticated` role has a real SELECT grant on this table, confirmed
 * against the actual migration). Fails closed (`LedgerPrivilegeGapError`)
 * if the query itself cannot be answered — never silently treats an
 * unreadable ledger as empty.
 */
export async function checkOwnEvidenceLedgerEmpty(client: SupabaseClient, athleteId: string): Promise<boolean> {
  const { count, error } = await client.from("pattern_evidence_identities").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
  if (error) throw new LedgerPrivilegeGapError(error.message);
  if (count === null) throw new LedgerPrivilegeGapError("count was null despite no query error");
  return count === 0;
}
