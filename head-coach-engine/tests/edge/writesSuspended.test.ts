// UX-11R.9 (R9-OPS-01) — the rollout write-suspension rule shared by session-execution,
// completed-session (PUT) and accept-training-plan. Pure, no Deno API.
import { describe, expect, it } from "vitest";
import {
  isWritesSuspended,
  writesSuspendedResponse,
  WRITES_SUSPENDED_CODE,
  WRITES_SUSPENDED_ENV,
  WRITES_SUSPENDED_MESSAGE,
} from "../../../supabase/functions/_shared/writesSuspended.js";

describe("isWritesSuspended (UX-11R.9 R9-OPS-01)", () => {
  it("only the exact string 'true' suspends", () => {
    expect(WRITES_SUSPENDED_ENV).toBe("NALYNT_WRITES_SUSPENDED");
    expect(isWritesSuspended("true")).toBe(true);
  });

  it("absent, 'false' or any other value → normal behaviour (never fail-closed)", () => {
    for (const value of [undefined, null, "", "false", "TRUE", "True", " true", "true ", "1", "yes", "on"]) {
      expect(isWritesSuspended(value)).toBe(false);
    }
  });
});

describe("writesSuspendedResponse (UX-11R.9 R9-OPS-01)", () => {
  it("503 with the stable { error: { code, message } } shape and a neutral message", async () => {
    const response = writesSuspendedResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: WRITES_SUSPENDED_CODE, message: WRITES_SUSPENDED_MESSAGE } });
    expect(WRITES_SUSPENDED_CODE).toBe("writes_suspended");
    expect(WRITES_SUSPENDED_MESSAGE).not.toMatch(/maintenance|migration|rollout|NALYNT_|secret|deploy/i);
  });
});
