/**
 * UX-11B.2.4c — shared local-database helpers for integration suites that
 * need owner-level SQL (fixtures no API role may write, append-only proofs).
 * Local `supabase_db_*` container only — never a remote target.
 *
 * Fail loudly, never skip: when integration is requested
 * (RUN_LOCAL_SUPABASE_INTEGRATION=1) every precondition below throws a clear
 * error instead of silently turning the suite off.
 */
import { execFileSync } from "node:child_process";
import { isLoopbackSupabaseUrl, resolveTestSupabaseUrl } from "./testDb.js";

const DOCKER_TIMEOUT_MS = 30_000;
let cachedContainer: string | null = null;

/**
 * Whether a DB integration suite runs: `false` ONLY when integration was not
 * requested (the explicit, voluntary "unit tests only" mode). Requested but
 * unusable (missing key, non-local URL) → throws, so the file fails.
 */
export function localIntegrationRequested(options: { requirePublishableKey?: boolean } = {}): boolean {
  if (process.env.RUN_LOCAL_SUPABASE_INTEGRATION !== "1") return false;
  if (!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("RUN_LOCAL_SUPABASE_INTEGRATION=1 but no SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).");
  }
  if (options.requirePublishableKey && !(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY)) {
    throw new Error("RUN_LOCAL_SUPABASE_INTEGRATION=1 but no SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY (npx supabase status -o env).");
  }
  const url = resolveTestSupabaseUrl();
  if (!isLoopbackSupabaseUrl(url)) throw new Error(`RUN_LOCAL_SUPABASE_INTEGRATION=1 but the Supabase URL is not local: ${url}`);
  return true;
}

/**
 * The local Postgres container, resolved once per test file (one `docker ps`, not one per statement).
 * UX-11R.1 — LOCAL_SUPABASE_DB_CONTAINER selects one explicitly when several local stacks run (e.g. a
 * throwaway migration-rehearsal stack next to the developer's own): still only a running local
 * `supabase_db_*` container, never a remote target.
 */
export function localDbContainer(): string {
  if (cachedContainer !== null) return cachedContainer;
  const explicit = process.env.LOCAL_SUPABASE_DB_CONTAINER;
  if (explicit) {
    const running = execFileSync("docker", ["ps", "--filter", `name=^${explicit}$`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: DOCKER_TIMEOUT_MS }).trim();
    if (!explicit.startsWith("supabase_db_") || running !== explicit) throw new Error(`LOCAL_SUPABASE_DB_CONTAINER=${explicit} is not a running local supabase_db_* container`);
    cachedContainer = explicit;
    return cachedContainer;
  }
  const names = execFileSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], { encoding: "utf8", timeout: DOCKER_TIMEOUT_MS })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (names.length !== 1 || !names[0]!.startsWith("supabase_db_")) {
    throw new Error(`expected exactly one running local supabase_db_* container, found ${names.length === 0 ? "none" : names.join(", ")}`);
  }
  cachedContainer = names[0]!;
  return cachedContainer;
}

/** Runs SQL as the local database owner (ON_ERROR_STOP, bounded by a timeout). Throws with psql's message on any error. */
export function execLocalSql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-f", "-"], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: DOCKER_TIMEOUT_MS,
  });
}

/** One deterministic readiness check before any fixture: the container exists and Postgres answers. No loop, no sleep. */
export function assertLocalDbReady(): void {
  let answer: string;
  try {
    answer = execLocalSql("select 1;").trim();
  } catch (e) {
    throw new Error(`local Postgres is not ready: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  if (answer !== "1") throw new Error(`local Postgres readiness check returned ${JSON.stringify(answer)}`);
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
