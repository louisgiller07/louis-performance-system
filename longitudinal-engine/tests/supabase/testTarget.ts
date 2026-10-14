/**
 * QA-ISOLATION-01 — the local Supabase stack an integration run really writes to, proven before the first write.
 *
 * An integration run names its stack explicitly: SUPABASE_URL (required, no default stack), optionally
 * LOCAL_SUPABASE_PROJECT_ID and / or LOCAL_SUPABASE_DB_CONTAINER. The target is then derived from what is really
 * running, never assumed:
 *   1. SUPABASE_URL is a loopback http URL with an explicit port;
 *   2. exactly one running local gateway (`supabase_kong_<project>`) publishes that port → the project behind the URL;
 *   3. the requested project / DB container, when given, must be that project / `supabase_db_<project>`;
 *   4. the DB container answers (`select 1`) and the API answers through the gateway (`/auth/v1/health`).
 * Unknown, remote, ambiguous or mismatching → TestTargetError, before any write. Owner-level SQL always goes to the
 * DB container of the project behind SUPABASE_URL: the API and psql can never point at two different stacks.
 * The effective target is printed once per process ("[test-target] …") so every report shows the stack really used.
 *
 * Same rule (identical file) in head-coach-engine/tests/supabase/testTarget.ts and web/src/test/testTarget.ts.
 */
import { execFileSync } from "node:child_process";

const DOCKER_TIMEOUT_MS = 30_000;
const GATEWAY_PREFIX = "supabase_kong_";
const DB_PREFIX = "supabase_db_";

export class TestTargetError extends Error {
  constructor(message: string) {
    super(`${message} Integration runs never fall back to a default stack (QA-ISOLATION-01).`);
    this.name = "TestTargetError";
  }
}

export interface LocalTestTarget {
  projectId: string;
  apiUrl: string;
  apiPort: string;
  gatewayContainer: string;
  dbContainer: string;
}

let verified: LocalTestTarget | null = null;

/** Host ports a `docker ps` Ports column publishes for the gateway's 8000/tcp. */
export function publishedGatewayPorts(portsColumn: string): string[] {
  return [...portsColumn.matchAll(/(?:^|,\s*)(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\]):(\d+)->8000\/tcp/g)].map((m) => m[1]!);
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: DOCKER_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
}

/** Resolves and proves the target once per process; throws TestTargetError otherwise. */
export function verifyLocalTestTarget(): LocalTestTarget {
  if (verified) return verified;

  const apiUrl = process.env.SUPABASE_URL;
  if (!apiUrl) throw new TestTargetError("SUPABASE_URL is not set: name the local stack explicitly.");
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new TestTargetError(`SUPABASE_URL is not a URL: ${apiUrl}.`);
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.port) {
    throw new TestTargetError(`SUPABASE_URL is not a loopback http URL with an explicit port: ${apiUrl} (remote or unknown target refused).`);
  }
  const apiPort = parsed.port;

  const gateways = docker(["ps", "--filter", `name=^${GATEWAY_PREFIX}`, "--format", "{{.Names}}|{{.Ports}}"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, ports = ""] = line.split("|");
      return { name: name!, ports: publishedGatewayPorts(ports) };
    })
    .filter((g) => g.name.startsWith(GATEWAY_PREFIX) && g.ports.includes(apiPort));
  if (gateways.length === 0) throw new TestTargetError(`No running local Supabase gateway publishes port ${apiPort} (SUPABASE_URL=${apiUrl}).`);
  if (gateways.length > 1) throw new TestTargetError(`Ambiguous target: several gateways publish port ${apiPort} (${gateways.map((g) => g.name).join(", ")}).`);

  const gatewayContainer = gateways[0]!.name;
  const projectId = gatewayContainer.slice(GATEWAY_PREFIX.length);
  const dbContainer = `${DB_PREFIX}${projectId}`;
  const requestedProject = process.env.LOCAL_SUPABASE_PROJECT_ID;
  if (requestedProject && requestedProject !== projectId) {
    throw new TestTargetError(`SUPABASE_URL reaches project ${projectId}, not the requested LOCAL_SUPABASE_PROJECT_ID=${requestedProject}.`);
  }
  const requestedContainer = process.env.LOCAL_SUPABASE_DB_CONTAINER;
  if (requestedContainer && requestedContainer !== dbContainer) {
    throw new TestTargetError(`SUPABASE_URL reaches project ${projectId} (${dbContainer}), not the requested LOCAL_SUPABASE_DB_CONTAINER=${requestedContainer}.`);
  }
  const runningDb = docker(["ps", "--filter", `name=^${dbContainer}$`, "--format", "{{.Names}}"]).trim();
  if (runningDb !== dbContainer) throw new TestTargetError(`The database container ${dbContainer} of project ${projectId} is not running.`);

  const dbAnswer = docker(["exec", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", "select 1"]).trim();
  if (dbAnswer !== "1") throw new TestTargetError(`The database ${dbContainer} does not answer (select 1 → ${JSON.stringify(dbAnswer)}).`);
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const probe = `fetch(${JSON.stringify(`${apiUrl.replace(/\/$/, "")}/auth/v1/health`)}, { headers: { apikey: process.env.QA_PROBE_KEY } })
    .then((r) => process.exit(r.status === 200 ? 0 : 3), () => process.exit(4));`;
  try {
    execFileSync(process.execPath, ["-e", probe], { env: { ...process.env, QA_PROBE_KEY: apiKey }, timeout: DOCKER_TIMEOUT_MS, stdio: "ignore" });
  } catch {
    throw new TestTargetError(`The API at ${apiUrl} (gateway ${gatewayContainer}) does not answer /auth/v1/health.`);
  }

  verified = { projectId, apiUrl, apiPort, gatewayContainer, dbContainer };
  process.stderr.write(`[test-target] project=${projectId} api=${apiUrl} (gateway ${gatewayContainer} publishes ${apiPort}) db=${dbContainer} — verified\n`);
  return verified;
}

/** Test-only: forget the memoized target (unit tests of this module). */
export function resetVerifiedTestTargetForTests(): void {
  verified = null;
}
