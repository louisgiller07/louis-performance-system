import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSupabaseTargetAllowed, isLocalSupabaseUrl, REMOTE_SUPABASE_IN_DEV_MESSAGE, RemoteSupabaseInDevError } from "./supabaseTarget";

const REMOTE = "https://abcdefghijklmnop.supabase.co";

describe("local dev safety — remote Supabase refused in development mode", () => {
  it.each(["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321", "http://api.localhost:54321"])("DEV + %s → accepted", (url) => {
    expect(() => assertSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: url })).not.toThrow();
  });

  it.each([REMOTE, "https://supabase.example.com", "http://192.168.1.20:54321", "not a url"])("DEV + %s → refused (general rule, not a hostname list)", (url) => {
    expect(() => assertSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: url })).toThrow(RemoteSupabaseInDevError);
  });

  it("the refusal says why, in French", () => {
    expect(() => assertSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: REMOTE })).toThrow(REMOTE_SUPABASE_IN_DEV_MESSAGE);
  });

  it("DEV + remote + explicit opt-in (exactly \"true\") → accepted; anything else stays refused", () => {
    expect(() => assertSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: REMOTE, VITE_ALLOW_REMOTE_SUPABASE_IN_DEV: "true" })).not.toThrow();
    for (const v of ["1", "yes", "TRUE", ""]) {
      expect(() => assertSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: REMOTE, VITE_ALLOW_REMOTE_SUPABASE_IN_DEV: v })).toThrow(RemoteSupabaseInDevError);
    }
  });

  it("production build (DEV false) + remote → never blocked by this guard", () => {
    expect(() => assertSupabaseTargetAllowed({ DEV: false, VITE_SUPABASE_URL: REMOTE })).not.toThrow();
  });

  it("local host detection", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl(REMOTE)).toBe(false);
  });
});

describe("the client module enforces it before creating any client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("DEV + remote URL → importing the client fails (no client, no request)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", REMOTE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.resetModules();
    await expect(import("./supabase")).rejects.toThrow(REMOTE_SUPABASE_IN_DEV_MESSAGE);
  });

  it("DEV + remote URL + opt-in → the client is created", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", REMOTE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.stubEnv("VITE_ALLOW_REMOTE_SUPABASE_IN_DEV", "true");
    vi.resetModules();
    await expect(import("./supabase")).resolves.toHaveProperty("supabase");
  });

  it("production mode (DEV false) + remote URL → the client is created", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SUPABASE_URL", REMOTE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.resetModules();
    await expect(import("./supabase")).resolves.toHaveProperty("supabase");
  });
});

describe("isSupabaseTargetAllowed — the pure check main.tsx runs before loading the app", () => {
  it("same contract as the assertion", async () => {
    const { isSupabaseTargetAllowed } = await import("./supabaseTarget");
    expect(isSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(true);
    expect(isSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: REMOTE })).toBe(false);
    expect(isSupabaseTargetAllowed({ DEV: true, VITE_SUPABASE_URL: REMOTE, VITE_ALLOW_REMOTE_SUPABASE_IN_DEV: "true" })).toBe(true);
    expect(isSupabaseTargetAllowed({ DEV: false, VITE_SUPABASE_URL: REMOTE })).toBe(true);
  });
});
