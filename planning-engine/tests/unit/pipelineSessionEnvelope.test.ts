import { describe, expect, it } from "vitest";
import type { PipelineSessionEnvelope } from "../../src/types/pipelineSessionEnvelope.js";

describe("PipelineSessionEnvelope — shape per domain", () => {
  it("constructs a valid envelope for a strength session", () => {
    const envelope: PipelineSessionEnvelope<{ setVolume: number }> = {
      date: "2026-10-19",
      domain: "strength",
      kind: "STRENGTH_LOWER",
      payload: { setVolume: 12 },
    };

    expect(envelope.domain).toBe("strength");
    expect(envelope.kind).toBe("STRENGTH_LOWER");
  });

  it("constructs a valid envelope for a dh_technical session", () => {
    const envelope: PipelineSessionEnvelope<{ focusedRunsCount: number }> = {
      date: "2026-10-20",
      domain: "dh_technical",
      kind: "DH_TECHNICAL",
      payload: { focusedRunsCount: 6 },
    };

    expect(envelope.domain).toBe("dh_technical");
    expect(envelope.kind).toBe("DH_TECHNICAL");
  });

  it("constructs a valid envelope for an aerobic session", () => {
    const envelope: PipelineSessionEnvelope<{ intensityZone: "easy" | "moderate" }> = {
      date: "2026-10-21",
      domain: "aerobic",
      kind: "AEROBIC_BASE",
      payload: { intensityZone: "moderate" },
    };

    expect(envelope.domain).toBe("aerobic");
    expect(envelope.kind).toBe("AEROBIC_BASE");
  });
});

describe("PipelineSessionEnvelope — generic payload", () => {
  it("accepts a string payload", () => {
    const envelope: PipelineSessionEnvelope<string> = {
      date: "2026-10-19",
      domain: "strength",
      kind: "STRENGTH_LOWER",
      payload: "placeholder-payload",
    };

    expect(envelope.payload).toBe("placeholder-payload");
  });

  it("accepts an object payload", () => {
    const payload = { loadProfile: "MODERATE" as const, durationMin: 60 };
    const envelope: PipelineSessionEnvelope<typeof payload> = {
      date: "2026-10-19",
      domain: "strength",
      kind: "STRENGTH_LOWER",
      payload,
    };

    expect(envelope.payload).toEqual({ loadProfile: "MODERATE", durationMin: 60 });
  });
});

describe("PipelineSessionEnvelope — identity preservation", () => {
  it("preserves date, domain, and kind exactly as constructed", () => {
    const envelope: PipelineSessionEnvelope<null> = {
      date: "2026-10-22",
      domain: "dh_technical",
      kind: "DH_PERFORMANCE",
      payload: null,
    };

    expect(envelope.date).toBe("2026-10-22");
    expect(envelope.domain).toBe("dh_technical");
    expect(envelope.kind).toBe("DH_PERFORMANCE");
  });

  it("never transforms the payload — the exact same reference/value comes back unchanged", () => {
    const payload = { foo: "bar", nested: { count: 1 } };
    const envelope: PipelineSessionEnvelope<typeof payload> = {
      date: "2026-10-19",
      domain: "aerobic",
      kind: "AEROBIC_BASE",
      payload,
    };

    expect(envelope.payload).toBe(payload); // same reference, no copy/transform
  });
});

describe("PipelineSessionEnvelope — determinism", () => {
  it("two envelopes built from the same inputs are deeply equal", () => {
    const build = (): PipelineSessionEnvelope<{ n: number }> => ({
      date: "2026-10-19",
      domain: "strength",
      kind: "STRENGTH_UPPER",
      payload: { n: 42 },
    });

    expect(build()).toEqual(build());
  });
});
