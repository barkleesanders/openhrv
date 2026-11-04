/**
 * OpenHRV — AI Coach grounding. The coach runs on Workers AI inside the
 * owner's own Cloudflare account and sees ONLY the context assembled here
 * from the owner's stored data — no external APIs, no trackers, no other
 * users' data (there are no other users). The builder is a pure function so
 * the exact grounding text is unit-tested.
 */
import type { FactorImpact } from "./insights";
import type { LabDay } from "./lab";

export interface CoachData {
  battery: number | null;
  stress: number | null;
  pressure: number | null;
  latestMeasurement: { taken_at: string; mean_hr_bpm: number; rmssd_ms: number; sdnn_ms: number; source: string } | null;
  days: LabDay[]; // ascending
  sleepMedianH: number | null;
  sleepLastH: number | null;
  impacts: FactorImpact[];
  /** Phase B: today's deterministic stress drivers + actions from the
   *  Today coach panel, so chat answers use the same evidence lines. */
  drivers?: string[];
  /** Latest Apple Health aggregate day — where most of the owner's HRV
   *  actually lives (daily SDNN). Without it the coach falsely claims no
   *  HRV data exists while the dashboard shows SDNN (production bug,
   *  2026-11-04). */
  aggregate?: {
    date: string;
    sdnnMs: number | null;
    sdnnBaselineMs: number | null;
    restingHrBpm: number | null;
    sleepH: number | null;
    steps: number | null;
  } | null;
  recentMoods: Array<{ date: string; mood: number }>;
  counts: { measurements: number; sleep: number; journal: number; breathing: number; tests: number };
}

export const COACH_SYSTEM_PROMPT = [
  "You are the OpenHRV coach inside a private, single-user health app.",
  "Answer ONLY from the owner's stored data provided in the DATA block below.",
  "If the data does not cover the question, say so plainly and suggest what to measure or log — never invent readings, dates, or medical facts.",
  "You are not a medical professional: no diagnoses, no treatment advice. You may explain HRV concepts (RMSSD, SDNN, Baevsky stress index, sleep debt) in plain language and point to patterns in the data.",
  "Keep answers short and specific, citing the numbers you used.",
].join(" ");

const r1 = (v: number | null): string => (v === null ? "—" : String(Math.round(v * 10) / 10));

export function buildCoachContext(d: CoachData): string {
  const lines: string[] = ["DATA — the owner's stored OpenHRV data:"];
  lines.push(
    `Today scores: Battery ${d.battery === null ? "—" : Math.round(d.battery) + "%"}, Stress ${d.stress === null ? "—" : Math.round(d.stress) + "%"}, Pressure ${d.pressure === null ? "—" : Math.round(d.pressure)}.`,
  );
  if (d.latestMeasurement) {
    const m = d.latestMeasurement;
    lines.push(
      `Latest measurement ${String(m.taken_at).slice(0, 16).replace("T", " ")} via ${m.source}: HR ${r1(m.mean_hr_bpm)} bpm, RMSSD ${r1(m.rmssd_ms)} ms, SDNN ${r1(m.sdnn_ms)} ms.`,
    );
  } else {
    lines.push(
      d.aggregate
        ? "No RR measurements stored yet \u2014 the HRV figures below come from Apple Health daily aggregates (SDNN)."
        : "No measurements stored yet.",
    );
  }
  if (d.aggregate) {
    const a = d.aggregate;
    const parts: string[] = [];
    if (a.sdnnMs !== null) {
      let s = `HRV (SDNN) ${r1(a.sdnnMs)} ms`;
      if (a.sdnnBaselineMs !== null && a.sdnnBaselineMs > 0) {
        const pct = Math.round(((a.sdnnMs - a.sdnnBaselineMs) / a.sdnnBaselineMs) * 100);
        s += ` (personal baseline median ${r1(a.sdnnBaselineMs)} ms, ${pct >= 0 ? "+" : ""}${pct}%)`;
      }
      parts.push(s);
    }
    if (a.restingHrBpm !== null) parts.push(`resting HR ${r1(a.restingHrBpm)} bpm`);
    if (a.sleepH !== null) parts.push(`sleep ${a.sleepH.toFixed(1)} h`);
    if (a.steps !== null) parts.push(`steps ${Math.round(a.steps)}`);
    if (parts.length) lines.push(`Latest Apple Health day ${a.date}: ${parts.join(", ")}.`);
  }
  const last14 = d.days.slice(-14);
  if (last14.length) {
    lines.push("Last days (date: RMSSD ms, Battery, Stress, sleep h, steps, mood):");
    for (const day of last14) {
      lines.push(
        `- ${day.date}: ${r1(day.rmssd)}, ${r1(day.battery)}, ${r1(day.stress)}, ${day.sleepHours === null ? "—" : day.sleepHours.toFixed(1)}, ${day.steps ?? "—"}, ${day.mood ?? "—"}${day.tags.length ? ` [tags: ${day.tags.join(", ")}]` : ""}`,
      );
    }
  }
  lines.push(
    `Sleep: last night ${d.sleepLastH === null ? "—" : d.sleepLastH.toFixed(1) + " h"}, personal median ${d.sleepMedianH === null ? "—" : d.sleepMedianH.toFixed(1) + " h"}.`,
  );
  if (d.drivers && d.drivers.length) {
    lines.push("Today's coach-panel drivers and suggested actions (deterministic, from the same data):");
    for (const line of d.drivers.slice(0, 8)) lines.push(`- ${line}`);
  }
  const usable = d.impacts.filter((i) => i.enoughData && i.metrics);
  if (usable.length) {
    lines.push("Measured factor impacts (days with vs without the factor):");
    for (const i of usable.slice(0, 6)) {
      lines.push(
        `- ${i.factor}: RMSSD ${i.metrics!.rmssd.deltaPct.toFixed(0)}%, Battery ${i.metrics!.battery.deltaPct.toFixed(0)}%, Stress ${i.metrics!.stress.deltaPct.toFixed(0)}% (${i.nWith} days with, ${i.nWithout} without).`,
      );
    }
  }
  if (d.recentMoods.length) {
    lines.push(
      `Recent journal moods: ${d.recentMoods.slice(0, 7).map((m) => `${m.date} ${m.mood}/10`).join(", ")}.`,
    );
  }
  lines.push(
    `Store sizes: ${d.counts.measurements} measurements, ${d.counts.sleep} sleep records, ${d.counts.journal} journal entries, ${d.counts.breathing} breathing sessions, ${d.counts.tests} self-tests.`,
  );
  return lines.join("\n");
}
