import { describe, expect, it } from "vitest";
import { downsampleStream, parseStreamPairs } from "../src/strava";

describe("strava stream parsing", () => {
  it("parses the key_by_type object shape", () => {
    const raw = {
      time: { data: [0, 1, 2, 3] },
      heartrate: { data: [90, 95, 100, 105] },
      latlng: { data: [[1, 2]] },
    };
    expect(parseStreamPairs(raw)).toEqual([
      [0, 90],
      [1, 95],
      [2, 100],
      [3, 105],
    ]);
  });

  it("parses the array shape and drops zero/invalid HR points", () => {
    const raw = [
      { type: "time", data: [0, 1, 2] },
      { type: "heartrate", data: [88, 0, 92] },
    ];
    expect(parseStreamPairs(raw)).toEqual([
      [0, 88],
      [2, 92],
    ]);
  });

  it("returns [] when streams are missing (activity without HR)", () => {
    expect(parseStreamPairs({ time: { data: [0, 1] } })).toEqual([]);
    expect(parseStreamPairs(null)).toEqual([]);
    expect(parseStreamPairs({})).toEqual([]);
  });
});

describe("stream downsampling (storage fixture)", () => {
  it("keeps <= 1 point per 5 s, always first and last", () => {
    const pairs: Array<[number, number]> = Array.from({ length: 601 }, (_, i) => [i, 100 + (i % 40)]);
    const out = downsampleStream(pairs, 5);
    expect(out[0]).toEqual([0, 100]);
    expect(out[out.length - 1][0]).toBe(600);
    for (let i = 1; i < out.length - 1; i++) expect(out[i][0] - out[i - 1][0]).toBeGreaterThanOrEqual(5);
    expect(out.length).toBeLessThanOrEqual(122); // 600 s / 5 s + endpoints
  });

  it("caps very long streams", () => {
    const pairs: Array<[number, number]> = Array.from({ length: 30000 }, (_, i) => [i * 5, 120]);
    const out = downsampleStream(pairs, 5, 4000);
    expect(out.length).toBeLessThanOrEqual(4001);
    expect(out[out.length - 1][0]).toBe(149995);
  });

  it("passes short streams through untouched", () => {
    expect(downsampleStream([[0, 90], [3, 95]], 5)).toEqual([
      [0, 90],
      [3, 95],
    ]);
  });
});
