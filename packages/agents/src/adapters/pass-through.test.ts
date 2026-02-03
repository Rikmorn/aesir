import type { NormalizedEvent } from "@aesir/types";
import { describe, expect, it } from "vitest";
import { adaptPassThrough } from "./pass-through.js";
import { IncomingEventSchema } from "./types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    id: "evt_testPT",
    type: "some.unknown.event",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: "corr_testPT",
    payload: {},
    ...overrides,
  } as NormalizedEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptPassThrough", () => {
  it("wraps NormalizedEvent preserving original type", () => {
    const event = makeEvent({
      type: "custom.integration.fired",
      source: "linear",
      payload: { foo: "bar" },
    });

    const result = adaptPassThrough(event);

    expect(result.type).toBe("custom.integration.fired");
    expect(result.data).toEqual({ foo: "bar" });

    expect(IncomingEventSchema.safeParse(result).success).toBe(true);
  });

  it("sets source to {source}:webhook format", () => {
    const event = makeEvent({
      source: "github",
    });

    const result = adaptPassThrough(event);

    expect(result.source).toBe("github:webhook");
  });

  it("has no correlationKey (always goes to slow_path)", () => {
    const event = makeEvent({
      type: "slack.exotic.event",
      source: "slack",
      payload: { data: 123 },
    });

    const result = adaptPassThrough(event);

    expect(result.correlationKey).toBeUndefined();
  });

  it("handles missing payload gracefully", () => {
    const event = makeEvent({
      type: "bare.event",
      source: "linear",
      payload: undefined,
    });

    const result = adaptPassThrough(event);

    expect(result.data).toEqual({});
    expect(result.type).toBe("bare.event");
    expect(result.source).toBe("linear:webhook");
    expect(result.deduplicationId).toBe("corr_testPT");

    expect(IncomingEventSchema.safeParse(result).success).toBe(true);
  });
});
