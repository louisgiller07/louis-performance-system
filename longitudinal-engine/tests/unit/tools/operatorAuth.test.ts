import { describe, expect, it } from "vitest";
import { assertCorrectRemoteProject, promptHidden, signInInteractive, WrongSupabaseProjectError, NoInteractiveTtyError } from "../../../tools/operatorAuth.js";

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
