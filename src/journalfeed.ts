/**
 * OpenHRV — Journal timeline assembly (pure, unit-tested).
 *
 * The Journal page is a day-grouped, reverse-chronological feed mixing
 * every card type the store knows — measurement trios, SDNN samples,
 * workouts, sleep, breathing sessions and the owner's own notes — under
 * a calendar strip whose per-day orb is filled by that day's charge.
 * Structure modeled on mainstream HRV journals; all values are the
 * owner's real stored data, computed upstream.
 */
import { fmtTime12 } from "./timefmt";

export interface FeedTrioDay {
  date: string;
  battery: number | null;
}

export interface FeedMeasurement {
  id: number;
  taken_at: string;
  stress: number;
  battery: number;
  health: number | null;
  source: string;
}

export interface FeedSdnn {
  date: string;
  at: string;
  sdnnMs: number;
  restingHrBpm: number | null;
  source: string;
}

export interface FeedWorkout {
  id: number;
  start_at: string;
  name: string;
  durationMin: number;
  distanceM: number | null;
  source: string;
}

export interface FeedSleep {
  date: string;
  start_at: string;
  end_at: string;
  hours: number;
  source: string;
}

export interface FeedBreathing {
  taken_at: string;
  durationMin: number;
}

export interface FeedNote {
  created_at: string;
  body: string;
  mood: number | null;
  tags: string[];
}

export interface FeedSources {
  trios: FeedMeasurement[];
  sdnn: FeedSdnn[];
  workouts: FeedWorkout[];
  sleeps: FeedSleep[];
  breathing: FeedBreathing[];
  notes: FeedNote[];
  dayBattery: FeedTrioDay[];
}

export type FeedCardKind = "measurement" | "sdnn" | "workout" | "sleep" | "breathing" | "note";

export interface FeedCard {
  kind: FeedCardKind;
  at: string;
  timeLabel: string;
  title: string;
  detail: string;
  href: string | null;
  source: string;
}

export interface FeedDay {
  date: string;
  label: string;
  battery: number | null;
  cards: FeedCard[];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function feedDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const timeLabel = (iso: string): string => {
  const t = String(iso).slice(11, 16);
  return t ? fmtTime12(iso) : "";
};

/** Orb fill color for a day's charge (journal calendar strip). */
export function orbColor(battery: number | null): string {
  if (battery === null) return "#3a3a3c";
  if (battery >= 75) return "#34c759";
  if (battery >= 50) return "#a6d854";
  if (battery >= 25) return "#ffcc00";
  return "#ff453a";
}

export function buildFeed(src: FeedSources, maxDays = 14): FeedDay[] {
  const byDate = new Map<string, FeedCard[]>();
  const add = (date: string, card: FeedCard) => {
    const arr = byDate.get(date) ?? [];
    arr.push(card);
    byDate.set(date, arr);
  };
  for (const m of src.trios) {
    const date = String(m.taken_at).slice(0, 10);
    add(date, {
      kind: "measurement",
      at: m.taken_at,
      timeLabel: timeLabel(m.taken_at),
      title: "Measurement",
      detail: `Stress ${Math.round(m.stress)}% · Energy ${Math.round(m.battery)}%${m.health !== null ? ` · Health ${Math.round(m.health)}%` : ""}`,
      href: `/measurement/${m.id}`,
      source: m.source,
    });
  }
  for (const s of src.sdnn) {
    add(s.date, {
      kind: "sdnn",
      at: s.at,
      timeLabel: timeLabel(s.at),
      title: "SDNN",
      detail: `${Math.round(s.sdnnMs * 10) / 10} ms${s.restingHrBpm !== null ? ` · ♥ ${Math.round(s.restingHrBpm)} bpm resting` : ""}`,
      href: `/day/${s.date}`,
      source: s.source,
    });
  }
  for (const w of src.workouts) {
    const date = String(w.start_at).slice(0, 10);
    add(date, {
      kind: "workout",
      at: w.start_at,
      timeLabel: timeLabel(w.start_at),
      title: w.name,
      detail: `${Math.round(w.durationMin)} min${w.distanceM !== null ? ` · ${(w.distanceM / 1000).toFixed(1)} km` : ""}`,
      href: `/workout/${w.id}`,
      source: w.source,
    });
  }
  for (const s of src.sleeps) {
    add(s.date, {
      kind: "sleep",
      at: s.end_at,
      timeLabel: timeLabel(s.end_at),
      title: "Sleep",
      detail: `${s.hours.toFixed(1)} h · ${timeLabel(s.start_at)}–${timeLabel(s.end_at)}`,
      href: "/sleep",
      source: s.source,
    });
  }
  for (const b of src.breathing) {
    const date = String(b.taken_at).slice(0, 10);
    add(date, {
      kind: "breathing",
      at: b.taken_at,
      timeLabel: timeLabel(b.taken_at),
      title: "Breathing session",
      detail: `${Math.round(b.durationMin)} min`,
      href: `/day/${date}`,
      source: "openhrv",
    });
  }
  for (const n of src.notes) {
    const date = String(n.created_at).slice(0, 10);
    add(date, {
      kind: "note",
      at: n.created_at,
      timeLabel: timeLabel(n.created_at),
      title: "Note",
      detail: n.body.slice(0, 140),
      href: null,
      source: "journal",
    });
  }
  const batteryByDate = new Map(src.dayBattery.map((d) => [d.date, d.battery]));
  const days: FeedDay[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, maxDays)
    .map(([date, cards]) => ({
      date,
      label: feedDayLabel(date),
      battery: batteryByDate.get(date) ?? null,
      cards: cards.sort((a, b) => (a.at < b.at ? 1 : -1)),
    }));
  return days;
}
