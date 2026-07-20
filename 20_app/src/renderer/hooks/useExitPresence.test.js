import { describe, expect, it } from "vitest";
import {
  EXIT_PRESENCE_FALLBACK_MS,
  isOwnOpacityTransition,
} from "./useExitPresence";

describe("exit presence lifecycle", () => {
  it("uses a fallback longer than the 120ms exit transition", () => {
    expect(EXIT_PRESENCE_FALLBACK_MS).toBe(200);
  });

  it("accepts only the surface's own opacity transition", () => {
    const surface = {};
    expect(isOwnOpacityTransition({
      target: surface,
      currentTarget: surface,
      propertyName: "opacity",
    })).toBe(true);
    expect(isOwnOpacityTransition({
      target: {},
      currentTarget: surface,
      propertyName: "opacity",
    })).toBe(false);
    expect(isOwnOpacityTransition({
      target: surface,
      currentTarget: surface,
      propertyName: "transform",
    })).toBe(false);
  });
});
