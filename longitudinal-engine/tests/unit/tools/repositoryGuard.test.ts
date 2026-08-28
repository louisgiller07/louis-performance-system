import { describe, expect, it } from "vitest";
import {
  assertRepositoryGuard,
  resolveRepositoryGuardState,
  runRepositoryGuard,
  DirtyWorkingTreeError,
  WrongBranchError,
  HeadNotAtOriginMainError,
  GitStateResolutionError,
  type GitCommandRunner,
} from "../../../tools/repositoryGuard.js";

const SHA_A = "a1d41e4a94fdcb9b65fd52a1717c82e25caf196a";
const SHA_B = "afb9119182a7ac4a80f97149520d9700e98d27b4";

function fakeGit(responses: { branch?: string; head?: string; originMain?: string; status?: string; throwOn?: string }): GitCommandRunner {
  return (command: string) => {
    if (responses.throwOn && command.includes(responses.throwOn)) {
      throw new Error(`simulated git failure for: ${command}`);
    }
    if (command.includes("--abbrev-ref")) return responses.branch ?? "main";
    if (command.includes("origin/main")) return responses.originMain ?? SHA_A;
    if (command.includes("status")) return responses.status ?? "";
    if (command.includes("rev-parse HEAD")) return responses.head ?? SHA_A;
    throw new Error(`fakeGit: unexpected command "${command}"`);
  };
}

describe("assertRepositoryGuard — pure assertion over an already-resolved state", () => {
  it("A. clean main + HEAD == origin/main -> accepted", () => {
    expect(() => assertRepositoryGuard({ branch: "main", head: SHA_A, originMain: SHA_A, clean: true })).not.toThrow();
  });

  it("B. dirty tree -> rejected with DirtyWorkingTreeError", () => {
    expect(() => assertRepositoryGuard({ branch: "main", head: SHA_A, originMain: SHA_A, clean: false })).toThrow(DirtyWorkingTreeError);
  });

  it("C. clean tree but HEAD != origin/main -> rejected with HeadNotAtOriginMainError", () => {
    expect(() => assertRepositoryGuard({ branch: "main", head: SHA_A, originMain: SHA_B, clean: true })).toThrow(HeadNotAtOriginMainError);
  });

  it("D. wrong branch -> rejected with WrongBranchError", () => {
    expect(() => assertRepositoryGuard({ branch: "feature/x", head: SHA_A, originMain: SHA_A, clean: true })).toThrow(WrongBranchError);
  });

  it("dirty-tree check runs before the branch check (checked first, most fundamental)", () => {
    expect(() => assertRepositoryGuard({ branch: "feature/x", head: SHA_A, originMain: SHA_A, clean: false })).toThrow(DirtyWorkingTreeError);
  });
});

describe("resolveRepositoryGuardState — E. git state resolution failure -> rejected, never a successful \"unknown\" head", () => {
  it("throws GitStateResolutionError when any underlying git command fails", () => {
    const runGit = fakeGit({ throwOn: "rev-parse HEAD" });
    expect(() => resolveRepositoryGuardState(runGit)).toThrow(GitStateResolutionError);
  });

  it("never returns a state with head \"unknown\" — a failure always throws instead", () => {
    const runGit = fakeGit({ throwOn: "origin/main" });
    let thrown = false;
    try {
      resolveRepositoryGuardState(runGit);
    } catch (err) {
      thrown = true;
      expect(err).toBeInstanceOf(GitStateResolutionError);
    }
    expect(thrown).toBe(true);
  });

  it("on success, resolves exactly the values the injected runner returned", () => {
    const runGit = fakeGit({ branch: "main", head: SHA_A, originMain: SHA_A, status: "" });
    const state = resolveRepositoryGuardState(runGit);
    expect(state).toEqual({ branch: "main", head: SHA_A, originMain: SHA_A, clean: true });
  });

  it("a non-empty status output resolves clean: false", () => {
    const runGit = fakeGit({ status: " M some/file.ts" });
    const state = resolveRepositoryGuardState(runGit);
    expect(state.clean).toBe(false);
  });
});

describe("runRepositoryGuard — F. combined resolve+assert entry point", () => {
  it("returns the verified state on success — never 'unknown', never a failure silently swallowed", () => {
    const runGit = fakeGit({ branch: "main", head: SHA_A, originMain: SHA_A, status: "" });
    const state = runRepositoryGuard(runGit);
    expect(state.head).toBe(SHA_A);
    expect(state.head).not.toBe("unknown");
  });

  it("propagates the typed assertion error for a dirty tree", () => {
    const runGit = fakeGit({ status: " M dirty.ts" });
    expect(() => runRepositoryGuard(runGit)).toThrow(DirtyWorkingTreeError);
  });

  it("propagates the typed resolution error when git itself fails", () => {
    const runGit = fakeGit({ throwOn: "status" });
    expect(() => runRepositoryGuard(runGit)).toThrow(GitStateResolutionError);
  });
});
