import { afterEach, describe, expect, it, vi } from "vitest";
import { localIntegrationRequested } from "./localDb.js";

// UX-11B.2.4c — the integration gate: skipping is only the explicit
// "not requested" mode; requested but unusable must fail, never skip.
describe("localIntegrationRequested", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("not requested → false (the voluntary unit-only mode)", () => {
    vi.stubEnv("RUN_LOCAL_SUPABASE_INTEGRATION", "");
    expect(localIntegrationRequested()).toBe(false);
  });

  it("requested without the server key → throws", () => {
    vi.stubEnv("RUN_LOCAL_SUPABASE_INTEGRATION", "1");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => localIntegrationRequested()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("requested without the publishable key when the suite needs it → throws", () => {
    vi.stubEnv("RUN_LOCAL_SUPABASE_INTEGRATION", "1");
    vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect(() => localIntegrationRequested({ requirePublishableKey: true })).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
  });

  it("requested against a non-local URL → throws", () => {
    vi.stubEnv("RUN_LOCAL_SUPABASE_INTEGRATION", "1");
    vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    expect(() => localIntegrationRequested()).toThrow(/not local/);
  });
});
