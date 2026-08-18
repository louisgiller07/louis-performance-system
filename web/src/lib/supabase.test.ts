import { describe, expect, it, vi, afterEach } from "vitest";
import { resolvePublicKey, MissingSupabaseConfigError } from "./supabase";

function env(overrides: Partial<ImportMetaEnv>): ImportMetaEnv {
  return {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    ...overrides,
  } as ImportMetaEnv;
}

describe("resolvePublicKey", () => {
  it("prefers the publishable key when both are present", () => {
    const key = resolvePublicKey(env({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", VITE_SUPABASE_ANON_KEY: "legacy_anon_y" }));
    expect(key).toBe("sb_publishable_x");
  });

  it("falls back to the legacy anon key when publishable is absent", () => {
    const key = resolvePublicKey(env({ VITE_SUPABASE_ANON_KEY: "legacy_anon_y" }));
    expect(key).toBe("legacy_anon_y");
  });

  it("throws MissingSupabaseConfigError when neither key is present", () => {
    expect(() => resolvePublicKey(env({}))).toThrow(MissingSupabaseConfigError);
  });
});

describe("supabase client module", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws MissingSupabaseConfigError at import time when VITE_SUPABASE_URL is missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    // The module is already cached from the static import at the top of
    // this file (loaded with the default test env) — force re-evaluation
    // so the stubbed env actually takes effect for this import.
    vi.resetModules();
    await expect(import("./supabase")).rejects.toThrow(/VITE_SUPABASE_URL/);
  });
});
