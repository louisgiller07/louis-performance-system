/**
 * V0.3_001C-2 — LOCAL-TEST-ONLY raw-Postgres advisory-lock helper for the
 * `pattern_insight_reviews` identity lock `persist_pattern_insight_review`
 * itself acquires. Never imported by production code; never modifies the
 * RPC or its lock algorithm. The lock KEY is derived by calling the exact
 * same builtin Postgres function the RPC calls (`hashtextextended(text,
 * 0)`) against the exact same length-prefixed encoding the RPC's own SQL
 * builds — see persist_pattern_insight_review_rpc.sql's own lock statement.
 * Only the final hash computation is delegated to Postgres itself, so this
 * helper can never silently drift from the real RPC's lock key even if
 * Postgres's hash internals ever changed.
 *
 * Mechanism: a single long-lived `docker exec -i <db-container> psql`
 * child process (piped stdio) holds one Postgres session open across
 * multiple separate async test steps. This is the only way to keep a
 * `pg_advisory_xact_lock` held across otherwise-independent operations:
 * every Supabase JS / PostgREST call (including the RPC calls this whole
 * package's adapters make) is its own independent transaction with no way
 * to pin a session open across two separate HTTP calls — confirmed
 * elsewhere in this project's own architecture audit (see
 * docs/11_DECISION_LOG.md, "V0.3_001C : verrouillage de la sémantique de
 * linéarisation de fraîcheur"). This module intentionally bypasses
 * supabase-js entirely for the raw hold — a genuinely separate connection,
 * verified once by direct experiment: a real blocking
 * `pg_advisory_xact_lock` waiter shows up in `pg_locks` (granted=false,
 * matching classid/objid) only once another session actually contends for
 * the exact same key, and resolves only after this helper's `release()`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const DB_CONTAINER = "supabase_db_louis-performance-system";

function spawnPsql(): ChildProcessWithoutNullStreams {
  return spawn("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Mirrors persist_pattern_insight_review_rpc.sql's own length-prefixed concatenation EXACTLY — never approximated. */
function encodeReviewIdentityKey(athleteId: string, detectorRuleId: string, detectorRuleVersion: string, insightKind: string): string {
  const part = (s: string) => `${s.length}:${s}`;
  return `${part(athleteId)}|${part(detectorRuleId)}|${part(detectorRuleVersion)}|${part(insightKind)}`;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

class SqlSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private waiters: Array<{ marker: string; resolve: (text: string) => void }> = [];
  private readonly stderrChunks: string[] = [];

  constructor() {
    this.child = spawnPsql();
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      this.flush();
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString("utf8"));
    });
  }

  private flush(): void {
    this.waiters = this.waiters.filter((w) => {
      const idx = this.buffer.indexOf(w.marker);
      if (idx === -1) return true;
      const text = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + w.marker.length);
      w.resolve(text);
      return false;
    });
  }

  async run(sql: string): Promise<string> {
    const marker = `__DONE_${Math.random().toString(36).slice(2)}__`;
    const resultPromise = new Promise<string>((resolve) => {
      this.waiters.push({ marker, resolve });
    });
    this.child.stdin.write(sql.trim() + `\n\\echo ${marker}\n`);
    return resultPromise;
  }

  get stderrText(): string {
    return this.stderrChunks.join("");
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
  }
}

async function oneShotSql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnPsql();
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stdin.write(sql + "\n");
    child.stdin.end();
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`oneShotSql exited with code ${code}`))));
  });
}

export interface HeldReviewAdvisoryLock {
  /**
   * Polls (bounded by `timeoutMs`, a safety guard only — never the
   * correctness mechanism itself) until `pg_locks` objectively shows a real
   * session waiting on this EXACT lock key (matching classid/objid, read
   * back from the held session's own granted row — never approximated).
   * Throws if the timeout elapses with no waiter observed.
   */
  waitUntilAnotherSessionIsWaiting(timeoutMs?: number): Promise<void>;
  /** Releases the lock (COMMITs the holding transaction) and closes the session. */
  release(): Promise<void>;
}

export async function acquireReviewAdvisoryLockForTest(identity: {
  readonly athleteId: string;
  readonly detectorRuleId: string;
  readonly detectorRuleVersion: string;
  readonly insightKind: string;
}): Promise<HeldReviewAdvisoryLock> {
  const encoded = encodeReviewIdentityKey(identity.athleteId, identity.detectorRuleId, identity.detectorRuleVersion, identity.insightKind);
  const session = new SqlSession();

  await session.run("BEGIN;");
  await session.run(`SELECT pg_advisory_xact_lock(hashtextextended('${escapeSqlLiteral(encoded)}', 0));`);
  if (session.stderrText.length > 0) {
    throw new Error(`acquireReviewAdvisoryLockForTest: psql reported an error while acquiring the lock: ${session.stderrText}`);
  }

  const classObjRaw = await session.run("SELECT classid, objid FROM pg_locks WHERE locktype='advisory' AND pid = pg_backend_pid() AND granted;");
  const row = classObjRaw.trim().split("\n").filter(Boolean)[0];
  if (!row) {
    throw new Error("acquireReviewAdvisoryLockForTest: could not read back classid/objid for the just-acquired lock — pg_locks did not show the expected granted row");
  }
  const [classid, objid] = row.split("|").map((s) => s.trim());

  return {
    async waitUntilAnotherSessionIsWaiting(timeoutMs = 15000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const countText = await oneShotSql(`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted=false AND classid=${classid} AND objid=${objid};`);
        const count = parseInt(countText.trim().split("\n").filter(Boolean)[0]?.trim() ?? "0", 10);
        if (count >= 1) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`acquireReviewAdvisoryLockForTest: no session observed waiting on the review identity lock within ${timeoutMs}ms (test infrastructure or timing issue, not necessarily a product defect — investigate before concluding either way)`);
    },
    async release(): Promise<void> {
      await session.run("COMMIT;");
      await session.close();
    },
  };
}
