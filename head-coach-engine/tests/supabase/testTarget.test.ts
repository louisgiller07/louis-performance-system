/**
 * QA-ISOLATION-01 — unit tests of the integration target guard (docker and the API probe mocked: no stack needed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync: (...args: unknown[]) => execFileSync(...args) }));

const { publishedGatewayPorts, resetVerifiedTestTargetForTests, TestTargetError, verifyLocalTestTarget } = await import("./testTarget.js");

const ENV_KEYS = ["SUPABASE_URL", "LOCAL_SUPABASE_PROJECT_ID", "LOCAL_SUPABASE_DB_CONTAINER"] as const;
let saved: Record<string, string | undefined>;

/** A docker double: running gateways (name → Ports column) and DB containers. */
function stacks(gateways: Record<string, string>, dbs: string[], options: { dbAnswer?: string; apiStatusOk?: boolean } = {}) {
  execFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "docker" && args[0] === "ps" && args[2] === "name=^supabase_kong_") {
      return Object.entries(gateways).map(([n, p]) => `${n}|${p}`).join("\n") + "\n";
    }
    if (cmd === "docker" && args[0] === "ps") {
      const wanted = args[2]!.replace(/^name=\^/, "").replace(/\$$/, "");
      return dbs.includes(wanted) ? `${wanted}\n` : "\n";
    }
    if (cmd === "docker" && args[0] === "exec") return `${options.dbAnswer ?? "1"}\n`;
    if (cmd === process.execPath) {
      if (options.apiStatusOk === false) throw new Error("exit 3");
      return "";
    }
    throw new Error(`unexpected command ${cmd} ${args.join(" ")}`);
  });
}

const INT01 = { supabase_kong_nalynt_int01: "0.0.0.0:54821->8000/tcp, [::]:54821->8000/tcp" };
const DEV = { "supabase_kong_louis-performance-system": "8000/tcp" };

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  execFileSync.mockReset();
  resetVerifiedTestTargetForTests();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("publishedGatewayPorts", () => {
  it.each([
    ["0.0.0.0:54821->8000/tcp, [::]:54821->8000/tcp", ["54821", "54821"]],
    ["127.0.0.1:54321->8000/tcp", ["54321"]],
    ["8000/tcp", []],
    ["0.0.0.0:54823->3000/tcp", []],
  ])("%s → %j", (column, ports) => {
    expect(publishedGatewayPorts(column)).toEqual(ports);
  });
});

describe("verifyLocalTestTarget", () => {
  it("no SUPABASE_URL → refused, no docker call (never a default stack)", () => {
    expect(() => verifyLocalTestTarget()).toThrow(TestTargetError);
    expect(() => verifyLocalTestTarget()).toThrow(/SUPABASE_URL is not set/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(["https://uvolpldwwyvadlamulvr.supabase.co", "http://192.168.1.10:54821", "http://127.0.0.1", "not a url"])("remote or unknown %s → refused before docker", (url) => {
    process.env.SUPABASE_URL = url;
    expect(() => verifyLocalTestTarget()).toThrow(TestTargetError);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("no gateway publishes the port (e.g. the dev stack lost its binding) → refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    stacks({ ...INT01, ...DEV }, ["supabase_db_nalynt_int01"]);
    expect(() => verifyLocalTestTarget()).toThrow(/No running local Supabase gateway publishes port 54321/);
  });

  it("two gateways publish the port → ambiguous, refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    stacks({ ...INT01, supabase_kong_other: "0.0.0.0:54821->8000/tcp" }, ["supabase_db_nalynt_int01", "supabase_db_other"]);
    expect(() => verifyLocalTestTarget()).toThrow(/Ambiguous target/);
  });

  it("requested project different from the one behind the URL → refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    process.env.LOCAL_SUPABASE_PROJECT_ID = "nalynt-sec";
    stacks(INT01, ["supabase_db_nalynt_int01"]);
    expect(() => verifyLocalTestTarget()).toThrow(/reaches project nalynt_int01, not the requested LOCAL_SUPABASE_PROJECT_ID=nalynt-sec/);
  });

  it("requested DB container of another stack (API and psql split) → refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    process.env.LOCAL_SUPABASE_DB_CONTAINER = "supabase_db_louis-performance-system";
    stacks(INT01, ["supabase_db_nalynt_int01", "supabase_db_louis-performance-system"]);
    expect(() => verifyLocalTestTarget()).toThrow(/not the requested LOCAL_SUPABASE_DB_CONTAINER=supabase_db_louis-performance-system/);
  });

  it("DB container of the project not running → refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    stacks(INT01, []);
    expect(() => verifyLocalTestTarget()).toThrow(/supabase_db_nalynt_int01 of project nalynt_int01 is not running/);
  });

  it("API not answering → refused", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    stacks(INT01, ["supabase_db_nalynt_int01"], { apiStatusOk: false });
    expect(() => verifyLocalTestTarget()).toThrow(/does not answer \/auth\/v1\/health/);
  });

  it("consistent explicit target → derived from what runs, printed once, memoized", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54821";
    process.env.LOCAL_SUPABASE_PROJECT_ID = "nalynt_int01";
    process.env.LOCAL_SUPABASE_DB_CONTAINER = "supabase_db_nalynt_int01";
    stacks({ ...INT01, ...DEV }, ["supabase_db_nalynt_int01", "supabase_db_louis-performance-system"]);
    const target = verifyLocalTestTarget();
    expect(target).toEqual({
      projectId: "nalynt_int01",
      apiUrl: "http://127.0.0.1:54821",
      apiPort: "54821",
      gatewayContainer: "supabase_kong_nalynt_int01",
      dbContainer: "supabase_db_nalynt_int01",
    });
    const calls = execFileSync.mock.calls.length;
    expect(verifyLocalTestTarget()).toBe(target);
    expect(execFileSync.mock.calls.length).toBe(calls);
    expect(process.stderr.write).toHaveBeenCalledTimes(1);
    expect(String((process.stderr.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain("[test-target] project=nalynt_int01");
  });

  it("URL only (no project / container given) → the DB is the one of the project behind the URL", () => {
    process.env.SUPABASE_URL = "http://localhost:54821";
    stacks({ ...INT01, ...DEV }, ["supabase_db_nalynt_int01", "supabase_db_louis-performance-system"]);
    expect(verifyLocalTestTarget().dbContainer).toBe("supabase_db_nalynt_int01");
  });
});
