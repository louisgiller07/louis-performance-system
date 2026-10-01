import { describe, expect, it } from "vitest";
import { acquireFunctionsRuntime, type FunctionsRuntimeDeps } from "./functionsRuntime.js";

function fakeDeps(initiallyRunning: boolean) {
  const calls: string[] = [];
  let running = initiallyRunning;
  const deps: FunctionsRuntimeDeps = {
    containerRunning: () => running,
    startServe: () => {
      calls.push("start");
      running = true;
      return () => {
        calls.push("stopServe");
        // Killing the CLI does not always stop the container.
      };
    },
    stopContainer: () => {
      calls.push("stopContainer");
      running = false;
    },
  };
  return { deps, calls, isRunning: () => running };
}

describe("acquireFunctionsRuntime — the harness only cleans up what it started", () => {
  it("an already running runtime is reused and left running at the end", () => {
    const f = fakeDeps(true);
    const lease = acquireFunctionsRuntime(f.deps);
    expect(lease.owned).toBe(false);
    lease.release();
    expect(f.calls).toEqual([]);
    expect(f.isRunning()).toBe(true);
  });

  it("no runtime → the harness starts one and stops both the serve process and the container it created", () => {
    const f = fakeDeps(false);
    const lease = acquireFunctionsRuntime(f.deps);
    expect(lease.owned).toBe(true);
    expect(f.calls).toEqual(["start"]);
    lease.release();
    lease.release(); // idempotent
    expect(f.calls).toEqual(["start", "stopServe", "stopContainer"]);
    expect(f.isRunning()).toBe(false);
  });
});
