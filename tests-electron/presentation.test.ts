import { describe, expect, test } from "vitest";
import { reviewItemDurationLabel } from "../src/renderer/src/presentation";

describe("review duration presentation", () => {
  test("labels the default per-card estimate in seconds", () => {
    expect(reviewItemDurationLabel()).toBe("~45s");
  });

  test("uses minutes only for estimates of at least one minute", () => {
    expect(reviewItemDurationLabel(90)).toBe("~2m");
  });
});
