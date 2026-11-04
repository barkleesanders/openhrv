import { describe, expect, it } from "vitest";
import { buildFeed, orbColor, type FeedSources } from "../src/journalfeed";

const empty: FeedSources = { trios: [], sdnn: [], workouts: [], sleeps: [], breathing: [], notes: [], dayBattery: [] };

describe("buildFeed — day-grouped mixing + ordering", () => {
  it("groups every card kind under its day, newest day first, newest card first", () => {
    const src: FeedSources = {
      ...empty,
      trios: [{ id: 7, taken_at: "2026-11-03T07:15:00", stress: 30, battery: 80, health: 77, source: "ppg" }],
      sdnn: [{ date: "2026-11-03", at: "2026-11-03", sdnnMs: 165.7, restingHrBpm: 41, source: "Apple Health" }],
      workouts: [{ id: 42, start_at: "2026-11-03T17:30:00", name: "Evening Run", durationMin: 32, distanceM: 5200, source: "strava" }],
      sleeps: [{ date: "2026-11-03", start_at: "2026-11-02T23:10:00", end_at: "2026-11-03T06:40:00", hours: 7.5, source: "Apple Health" }],
      breathing: [{ taken_at: "2026-11-02T21:00:00", durationMin: 2 }],
      notes: [{ created_at: "2026-11-02T09:00:00", body: "Felt strong", mood: 8, tags: [] }],
      dayBattery: [
        { date: "2026-11-03", battery: 82 },
        { date: "2026-11-02", battery: 40 },
      ],
    };
    const feed = buildFeed(src);
    expect(feed.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-02"]);
    const day1 = feed[0];
    expect(day1.battery).toBe(82);
    expect(day1.label).toContain("November 3");
    // workout (17:30) before measurement (07:15) before the dateless SDNN summary
    expect(day1.cards.map((c) => c.kind)).toEqual(["workout", "measurement", "sleep", "sdnn"]);
    const trio = day1.cards.find((c) => c.kind === "measurement");
    expect(trio?.detail).toContain("Stress 30%");
    expect(trio?.detail).toContain("Health 77%");
    expect(trio?.href).toBe("/measurement/7");
    const run = day1.cards.find((c) => c.kind === "workout");
    expect(run?.detail).toContain("32 min");
    expect(run?.detail).toContain("5.2 km");
    const day2 = feed[1];
    expect(day2.cards.map((c) => c.kind)).toEqual(["breathing", "note"]);
    expect(day2.battery).toBe(40);
  });

  it("caps the number of days and skips card-less days", () => {
    const src: FeedSources = {
      ...empty,
      notes: Array.from({ length: 20 }, (_, i) => ({
        created_at: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00`,
        body: "n",
        mood: null,
        tags: [],
      })),
    };
    const feed = buildFeed(src, 5);
    expect(feed).toHaveLength(5);
    expect(feed[0].date).toBe("2026-10-20");
  });

  it("empty sources produce an empty feed (honest empty state upstream)", () => {
    expect(buildFeed(empty)).toEqual([]);
  });
});

describe("orbColor — charge-state fills", () => {
  it("maps charge bands to the design-system colors", () => {
    expect(orbColor(90)).toBe("#34c759");
    expect(orbColor(60)).toBe("#a6d854");
    expect(orbColor(30)).toBe("#ffcc00");
    expect(orbColor(10)).toBe("#ff453a");
    expect(orbColor(null)).toBe("#3a3a3c");
  });
});
