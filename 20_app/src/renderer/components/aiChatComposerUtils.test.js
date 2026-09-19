import { describe, expect, it } from "vitest";
import {
  AI_COMPOSER_MIN_HEIGHT,
  clampAiComposerHeight,
  getAiComposerMaxHeight,
} from "./aiChatComposerUtils";

describe("AI chat composer resizing", () => {
  it("uses 40 percent of the viewport as the maximum height", () => {
    expect(getAiComposerMaxHeight(1000)).toBe(400);
    expect(getAiComposerMaxHeight(600)).toBe(240);
  });

  it("never makes the maximum smaller than the minimum height", () => {
    expect(getAiComposerMaxHeight(100)).toBe(AI_COMPOSER_MIN_HEIGHT);
    expect(getAiComposerMaxHeight(undefined)).toBe(AI_COMPOSER_MIN_HEIGHT);
  });

  it("clamps drag and keyboard heights to the supported range", () => {
    expect(clampAiComposerHeight(20, 1000)).toBe(58);
    expect(clampAiComposerHeight(220.6, 1000)).toBe(221);
    expect(clampAiComposerHeight(800, 1000)).toBe(400);
  });
});
