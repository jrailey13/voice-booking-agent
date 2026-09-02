import { describe, it, expect } from "vitest";
import { elapsedSeconds } from "./audioDuration";

describe("elapsedSeconds", () => {
  it("returns whole seconds for the fixed 10s record window", () => {
    expect(elapsedSeconds(1000, 11000)).toBe(10);
  });

  it("rounds to the nearest second", () => {
    expect(elapsedSeconds(0, 16400)).toBe(16); // 16.4s -> 16
    expect(elapsedSeconds(0, 16600)).toBe(17); // 16.6s -> 17
  });

  it("clamps sub-second clips to a 1s minimum", () => {
    expect(elapsedSeconds(0, 0)).toBe(1); // instantaneous
    expect(elapsedSeconds(0, 400)).toBe(1); // rounds to 0, clamped to 1
  });

  it("never returns a negative or zero duration under clock skew", () => {
    expect(elapsedSeconds(5000, 4000)).toBe(1); // end before start
  });
});
