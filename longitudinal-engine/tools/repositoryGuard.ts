/**
 * V0.3_001B — operator-only preview tooling. `tsx` executes the current
 * working tree, not the committed SHA it happens to report — so merely
 * printing `git rev-parse HEAD` is not an attestation of what code a
 * preview run actually executed. A dirty working tree could silently run
 * uncommitted detector/runtime/tool changes while still claiming the
 * previous committed SHA. This guard closes that gap: it MUST pass before
 * any authentication, athlete resolution, or remote read is attempted.
 *
 * Deliberately never runs `git fetch` — `git rev-parse origin/main` reads
 * only the LOCAL remote-tracking ref (whatever the last `git fetch` left
 * behind), performing zero network I/O itself. If that ref is stale, the
 * guard fails and tells the operator to fetch manually — this tool never
 * mutates git state on its own.
 */
import { execSync } from "node:child_process";

export interface RepositoryGuardState {
  readonly branch: string;
  readonly head: string;
  readonly originMain: string;
  readonly clean: boolean;
}

export class GitStateResolutionError extends Error {
  constructor(cause: string) {
    super(`GitStateResolutionError: could not resolve local git state (${cause}). Preview execution refuses to proceed with an unverified working tree — never falls back to reporting "unknown" as a successful canonicalHead.`);
    this.name = "GitStateResolutionError";
  }
}

export class DirtyWorkingTreeError extends Error {
  constructor() {
    super("DirtyWorkingTreeError: the working tree has uncommitted changes. tsx executes the working tree, not the committed SHA — a dirty tree means the preview could silently run code that was never reviewed or pushed. Commit or stash first.");
    this.name = "DirtyWorkingTreeError";
  }
}

export class WrongBranchError extends Error {
  constructor(actualBranch: string) {
    super(`WrongBranchError: current branch is "${actualBranch}", not "main". Refusing to run the preview from any other branch.`);
    this.name = "WrongBranchError";
  }
}

export class HeadNotAtOriginMainError extends Error {
  constructor(head: string, originMain: string) {
    super(
      `HeadNotAtOriginMainError: local HEAD (${head}) does not match the last-known origin/main (${originMain}). This tool never runs "git fetch" automatically — if origin/main has moved, run "git fetch origin main" yourself first; if HEAD is simply ahead/behind, reconcile before previewing.`
    );
    this.name = "HeadNotAtOriginMainError";
  }
}

export type GitCommandRunner = (command: string) => string;

function defaultGitRunner(command: string): string {
  return execSync(command).toString().trim();
}

/** Pure, injectable git-state read — no assertion, no side effects beyond the read-only git commands themselves (no fetch, no checkout, no mutation). */
export function resolveRepositoryGuardState(runGit: GitCommandRunner = defaultGitRunner): RepositoryGuardState {
  try {
    const branch = runGit("git rev-parse --abbrev-ref HEAD");
    const head = runGit("git rev-parse HEAD");
    const originMain = runGit("git rev-parse origin/main");
    const statusOutput = runGit("git status --porcelain");
    return { branch, head, originMain, clean: statusOutput.length === 0 };
  } catch (err) {
    throw new GitStateResolutionError(err instanceof Error ? err.message : String(err));
  }
}

/** Pure assertion over an already-resolved state — the unit-testable core of the guard, independent of any real git process. */
export function assertRepositoryGuard(state: RepositoryGuardState): void {
  if (!state.clean) throw new DirtyWorkingTreeError();
  if (state.branch !== "main") throw new WrongBranchError(state.branch);
  if (state.head !== state.originMain) throw new HeadNotAtOriginMainError(state.head, state.originMain);
}

/**
 * The single entry point `previewRemoteRefresh.ts` calls, BEFORE any
 * authentication/athlete-resolution/remote-read step. Resolves + asserts
 * in one call; on success returns the verified state so the caller can use
 * `state.head` directly as `canonicalHead` — never "unknown" for a
 * successful preview.
 */
export function runRepositoryGuard(runGit: GitCommandRunner = defaultGitRunner): RepositoryGuardState {
  const state = resolveRepositoryGuardState(runGit);
  assertRepositoryGuard(state);
  return state;
}
