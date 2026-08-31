/**
 * Pure, network-free regression for testDb.ts's local-target safety guard
 * (V0.3_003D hardening). No real credentials, no network call — every case
 * here either exercises pure string/URL logic or verifies createTestClient()
 * throws before it would ever reach the network.
 *
 * Explicitly saves/restores the three relevant env vars around every test
 * (rather than relying on vitest's per-file isolation, or on vi.stubEnv
 * alone — it has no "unset" form) so this file can never leak a mutated
 * SUPABASE_SECRET_KEY/SUPABASE_URL into another test file's run, including
 * a real key an operator exported for the opt-in T17 suite.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, UnsafeTestTargetError } from "./testDb.js";

const ENV_KEYS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isLoopbackSupabaseUrl", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321", true],
    ["https://uvolpldwwyvadlamulvr.supabase.co", false],
    ["https://example.supabase.co", false],
    ["http://192.168.1.10:54321", false],
    ["http://localhost:9999", false],
    ["http://127.0.0.1:9999", false],
    ["http://127.0.0.2:54321", false],
    ["not-a-url", false],
    ["", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLoopbackSupabaseUrl(url)).toBe(expected);
  });
});

describe("resolveTestSupabaseUrl", () => {
  it("defaults to the well-known local URL when SUPABASE_URL is unset", () => {
    delete process.env.SUPABASE_URL;
    expect(resolveTestSupabaseUrl()).toBe("http://127.0.0.1:54321");
  });

  it("reflects SUPABASE_URL when set — the exact value createTestClient() will safety-check", () => {
    process.env.SUPABASE_URL = "https://uvolpldwwyvadlamulvr.supabase.co";
    expect(resolveTestSupabaseUrl()).toBe("https://uvolpldwwyvadlamulvr.supabase.co");
  });
});

describe("createTestClient — refuses an unsafe target before any network use", () => {
  it("throws UnsafeTestTargetError when SUPABASE_URL points at the real production project, even with a key present", () => {
    process.env.SUPABASE_SECRET_KEY = "not-a-real-key-never-used";
    process.env.SUPABASE_URL = "https://uvolpldwwyvadlamulvr.supabase.co";
    expect(() => createTestClient()).toThrow(UnsafeTestTargetError);
  });

  it("throws UnsafeTestTargetError for an arbitrary non-loopback https URL", () => {
    process.env.SUPABASE_SECRET_KEY = "not-a-real-key-never-used";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(() => createTestClient()).toThrow(UnsafeTestTargetError);
  });

  it("throws UnsafeTestTargetError for the right host on the wrong port", () => {
    process.env.SUPABASE_SECRET_KEY = "not-a-real-key-never-used";
    process.env.SUPABASE_URL = "http://localhost:9999";
    expect(() => createTestClient()).toThrow(UnsafeTestTargetError);
  });

  it("does not throw UnsafeTestTargetError for the local default (only a client construction, no network call)", () => {
    process.env.SUPABASE_SECRET_KEY = "not-a-real-key-never-used";
    delete process.env.SUPABASE_URL;
    expect(() => createTestClient()).not.toThrow(UnsafeTestTargetError);
  });

  it("still throws MissingTestServerKeyError when no key is present, regardless of URL", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    expect(() => createTestClient()).toThrow(/No Supabase server key/);
  });
});
