import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertCorrectRemoteProject, promptHidden, signInInteractive, signOutBestEffort, WrongSupabaseProjectError, NoInteractiveTtyError } from "../../../tools/operatorAuth.js";

describe("assertCorrectRemoteProject — project-identity guard", () => {
  it("accepts a URL referencing the correct project", () => {
    expect(() => assertCorrectRemoteProject("https://uvolpldwwyvadlamulvr.supabase.co")).not.toThrow();
  });

  it("rejects a URL referencing the forbidden project, even alone", () => {
    expect(() => assertCorrectRemoteProject("https://evynmzyjhobdpmxdiwsy.supabase.co")).toThrow(WrongSupabaseProjectError);
  });

  it("rejects a URL that mentions BOTH refs — forbidden check wins unconditionally", () => {
    expect(() => assertCorrectRemoteProject("https://evynmzyjhobdpmxdiwsy.supabase.co/uvolpldwwyvadlamulvr")).toThrow(WrongSupabaseProjectError);
  });

  it("rejects a URL referencing neither project", () => {
    expect(() => assertCorrectRemoteProject("https://some-other-project.supabase.co")).toThrow(WrongSupabaseProjectError);
  });

  it("rejects the local stack URL by default (remote mode only accepts the real project)", () => {
    expect(() => assertCorrectRemoteProject("http://127.0.0.1:54321")).toThrow(WrongSupabaseProjectError);
  });
});

describe("promptHidden — refuses to run without a real interactive TTY", () => {
  it("throws NoInteractiveTtyError immediately when stdin is not a TTY (never falls back to a visible/echoed read)", async () => {
    // vitest's own stdin is never a TTY — this proves the guard fires under
    // exactly the conditions Claude Code's own Bash tool would present.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(promptHidden("Password: ")).rejects.toThrow(NoInteractiveTtyError);
  });
});

describe("signInInteractive — never prompts at all (not even the visible email question) without a real TTY", () => {
  it("throws NoInteractiveTtyError before any prompt — regression test for the bug where the email prompt alone silently read EOF as an empty answer and proceeded toward a password prompt under a non-interactive stdin", async () => {
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(signInInteractive({ url: "http://127.0.0.1:54321", publicKey: "irrelevant-for-this-test" })).rejects.toThrow(NoInteractiveTtyError);
  });
});

function mockAuthClient(signOutImpl: (args: unknown) => Promise<{ error: { message: string } | null }>): { client: SupabaseClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const client = {
    auth: {
      signOut: async (args: unknown) => {
        calls.push(args);
        return signOutImpl(args);
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("signOutBestEffort — local-scope-only sign-out, never global", () => {
  it("calls auth.signOut with exactly { scope: \"local\" } — no other scope, no bare call", async () => {
    const { client, calls } = mockAuthClient(async () => ({ error: null }));
    await signOutBestEffort(client);
    expect(calls).toEqual([{ scope: "local" }]);
  });

  it("never calls signOut with no arguments (the SDK default is global scope)", async () => {
    const { client, calls } = mockAuthClient(async () => ({ error: null }));
    await signOutBestEffort(client);
    expect(calls[0]).not.toBeUndefined();
    expect(calls).not.toContainEqual(undefined);
  });

  it("never uses scope \"global\"", async () => {
    const { client, calls } = mockAuthClient(async () => ({ error: null }));
    await signOutBestEffort(client);
    expect((calls[0] as { scope: string }).scope).not.toBe("global");
  });

  it("never uses scope \"others\"", async () => {
    const { client, calls } = mockAuthClient(async () => ({ error: null }));
    await signOutBestEffort(client);
    expect((calls[0] as { scope: string }).scope).not.toBe("others");
  });

  it("a signOut failure is swallowed (best-effort) — never throws, never returns anything", async () => {
    const { client } = mockAuthClient(async () => ({ error: { message: "network error" } }));
    await expect(signOutBestEffort(client)).resolves.toBeUndefined();
  });

  it("a signOut that throws is also swallowed — never propagates, never leaks credential-shaped content in the thrown/caught value", async () => {
    const client = {
      auth: {
        signOut: async () => {
          throw new Error("SENTINEL_SHOULD_NEVER_PROPAGATE");
        },
      },
    } as unknown as SupabaseClient;
    await expect(signOutBestEffort(client)).resolves.toBeUndefined();
  });
});
