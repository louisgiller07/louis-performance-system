/**
 * Local Edge Functions runtime ownership for the HTTP harnesses
 * (test:daily-run:v2:http, test:m3:http, test:m5:completed-session:http).
 *
 * A harness either REUSES a runtime that was already serving (a developer's
 * `supabase functions serve`, another session) — and then never stops it — or
 * STARTS its own `supabase functions serve` and, at the end, stops what it
 * started (the CLI process tree and the edge-runtime container it created).
 * Before this, every harness stopped the container on exit even when it had
 * not started it, silently taking down a runtime other work depended on.
 */
import { execSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const EDGE_CONTAINER = "supabase_edge_runtime_louis-performance-system";

export interface FunctionsRuntimeDeps {
  /** Whether this project's edge-runtime container is running right now. */
  containerRunning(): boolean;
  /** Starts `supabase functions serve`; returns how to stop that process tree. */
  startServe(): () => void;
  /** Stops this project's edge-runtime container (only ever called for a runtime the harness started). */
  stopContainer(): void;
}

export interface FunctionsRuntimeLease {
  /** true → the harness started the runtime and will clean it up; false → reused, left as found. */
  owned: boolean;
  release(): void;
}

/** Output of the `functions serve` a harness started (diagnostics only: printed when the runtime never becomes ready). */
export const SERVE_LOG = join(tmpdir(), "nalynt-harness-functions-serve.log");

export function serveLogTail(lines = 60): string {
  if (!existsSync(SERVE_LOG)) return "(no functions serve log: the runtime was reused, not started by this harness)";
  return readFileSync(SERVE_LOG, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

export function acquireFunctionsRuntime(deps: FunctionsRuntimeDeps): FunctionsRuntimeLease {
  if (deps.containerRunning()) return { owned: false, release: () => {} };
  const stopServe = deps.startServe();
  let released = false;
  return {
    owned: true,
    release: () => {
      if (released) return;
      released = true;
      stopServe();
      // Killing the CLI process tree does not reliably stop the container it created (proven on Windows).
      if (deps.containerRunning()) deps.stopContainer();
    },
  };
}

export function localFunctionsRuntimeDeps(repoRoot: string): FunctionsRuntimeDeps {
  const filter = `--filter "name=${EDGE_CONTAINER}" --format "{{.Names}}"`;
  return {
    containerRunning: () => execSync(`docker ps ${filter}`).toString().trim() !== "",
    startServe: () => {
      // Single command string (no user input). Output goes to a local log file kept for diagnostics
      // (the CLI prints no secret); it is only printed when the runtime never becomes ready.
      const log = openSync(SERVE_LOG, "w");
      const child = spawn("npx supabase functions serve", [], { cwd: repoRoot, stdio: ["ignore", log, log], shell: true });
      closeSync(log);
      return () => {
        if (child.pid == null || child.exitCode !== null) return;
        try {
          if (process.platform === "win32") execSync(`taskkill /T /PID ${child.pid}`, { stdio: "ignore" });
          else child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      };
    },
    stopContainer: () => execSync(`docker stop ${EDGE_CONTAINER}`, { stdio: "ignore" }),
  };
}

/**
 * UX-11R.2 — a runtime this harness OWNS, started with an env file (e.g. the
 * Edge secret NALYNT_V2_PLAN_GENERATION_ENABLED). A runtime's environment is
 * fixed at start, so reusing someone else's is impossible here: if one is
 * already running the harness refuses loudly (never a false green). stop()
 * stops what it started and waits until the container is gone, so the next
 * start never collides with a container being removed.
 */
export async function startOwnedFunctionsRuntime(repoRoot: string, envFile: string): Promise<{ stop: () => Promise<void> }> {
  const deps = localFunctionsRuntimeDeps(repoRoot);
  if (deps.containerRunning()) {
    throw new Error("An Edge runtime is already running: this harness must own the runtime to set its environment. Stop `supabase functions serve` first, then rerun.");
  }
  const log = openSync(SERVE_LOG, "w");
  const child = spawn(`npx supabase functions serve --env-file "${envFile}"`, [], { cwd: repoRoot, stdio: ["ignore", log, log], shell: true });
  closeSync(log);
  return {
    stop: async () => {
      if (child.pid != null && child.exitCode === null) {
        try {
          if (process.platform === "win32") execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: "ignore" });
          else child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
      if (deps.containerRunning()) deps.stopContainer();
      for (let i = 0; i < 60; i += 1) {
        const exists = execSync(`docker ps -a --filter "name=${EDGE_CONTAINER}" --format "{{.Names}}"`).toString().trim() !== "";
        if (!exists) return;
        try {
          execSync(`docker rm -f ${EDGE_CONTAINER}`, { stdio: "ignore" });
        } catch {
          /* removal in progress */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("edge-runtime container still present after stop");
    },
  };
}
