import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordHealthDataConsent, HealthDataConsentError } from "./consentRepo";
import { PRIVACY_NOTICE_VERSION } from "./privacyNotice";

vi.mock("../../lib/supabase", () => ({ supabase: { from: vi.fn() } }));
import { supabase } from "../../lib/supabase";

const mockedFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

function chain(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  mockedFrom.mockReturnValue({ update });
  return { update, eq, select };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordHealthDataConsent (PILOT_012)", () => {
  it("updates only the athlete's own onboarding row with the current notice version — never a client timestamp", async () => {
    const { update, eq } = chain({ data: [{ athlete_id: "athlete-1" }], error: null });

    await recordHealthDataConsent("athlete-1");

    expect(mockedFrom).toHaveBeenCalledWith("athlete_onboarding_profiles");
    expect(update).toHaveBeenCalledWith({ privacy_notice_version: PRIVACY_NOTICE_VERSION });
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("throws HealthDataConsentError on a Supabase error", async () => {
    chain({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(recordHealthDataConsent("athlete-1")).rejects.toThrow(HealthDataConsentError);
  });

  it("throws HealthDataConsentError when no row was updated (e.g. RLS filtered it out)", async () => {
    chain({ data: [], error: null });
    await expect(recordHealthDataConsent("athlete-1")).rejects.toThrow(HealthDataConsentError);
  });
});
