/**
 * OpenHRV — Today Coach panel (Phase B). Deterministic, rule-based
 * synthesis over the owner's own stored data: daily brief, what's
 * impacting you, what's driving stress (or keeping it low), what to work
 * on, and data-generated coach quick-ask chips. No LLM text — every
 * sentence cites the number behind it, so the whole panel is testable
 * and true by construction. All wording is original to OpenHRV.
 */
import type { FactorImpact } from "./insights";
import type { HourBucket, StressImpact } from "./reports";

export interface CoachEvent {
  title: string;
  start_at: string; // local ISO with offset, date = slice(0,10)
  end_at: string;
  calendar_name: string;
}

export interface CoachInput {
  date: string; // latest scored day YYYY-MM-DD
  battery: number | null;
  stress: number | null;
  pressure: number | null;
  hrvMs: number | null;
  baselineHrvMs: number | null;
  restingHrBpm: number | null;
  restingBaseline: number | null;
  sleepHours: number | null;
  sleepMedian: number | null;
  sleepDebtH: number; // vs the 8 h target, latest night
  wakeTime: string | null; // "06:40" latest night end
  impacts: FactorImpact[];
  buckets: HourBucket[]; // latest day hourly
  impact: StressImpact | null; // stationary-stress read on buckets
  standHours: number | null;
  bestStandHours: number | null;
  breathingOnDate: boolean;
  eventsToday: CoachEvent[];
  eventsTomorrow: CoachEvent[];
}

export interface CoachRow {
  text: string;
  href?: string;
}
export interface CoachAction {
  text: string;
  href?: string;
}
export interface CoachChip {
  label: string;
  question: string;
}
export interface CoachPanel {
  headline: string;
  briefLines: string[];
  mostImportant: string;
  impacting: CoachRow[];
  driversTitle: string;
  drivers: CoachRow[];
  protective: boolean;
  actions: CoachAction[];
  topAction: string;
  chips: CoachChip[];
  scheduleLine: string | null;
}

const r0 = (v: number): number => Math.round(v);
const r1 = (v: number): string => String(Math.round(v * 10) / 10);
const pct = (v: number): string => `${v >= 0 ? "+" : ""}${r0(v)}%`;
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** Contiguous hour ranges from a predicate, formatted "13:00–15:00". */
export function hourRanges(buckets: HourBucket[], pred: (b: HourBucket) => boolean): string[] {
  const hs = buckets.filter(pred).map((b) => b.hour).sort((a, b) => a - b);
  const out: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const h of hs) {
    if (start === null) { start = h; prev = h; continue; }
    if (h === (prev as number) + 1) { prev = h; continue; }
    out.push(`${hh(start)}–${hh((prev as number) + 1)}`);
    start = h; prev = h;
  }
  if (start !== null) out.push(`${hh(start)}–${hh((prev as number) + 1)}`);
  return out;
}

export interface ScheduleLoad {
  count: number;
  totalHours: number;
  beforeNoonHours: number;
  firstStart: string | null; // "HH:MM"
  earlyStart: boolean; // first event at/before wake + 30 min
}

/** Schedule-load math for one day's events. All times are the events'
 *  local wall times (the sync stores offset-bearing local ISO). */
export function scheduleLoad(events: CoachEvent[], wakeTime: string | null): ScheduleLoad {
  let total = 0;
  let beforeNoon = 0;
  let first: string | null = null;
  for (const e of events) {
    const s = Date.parse(e.start_at);
    const en = Date.parse(e.end_at);
    if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) continue;
    const hrs = (en - s) / 3_600_000;
    total += hrs;
    const startH = Number(e.start_at.slice(11, 13)) + Number(e.start_at.slice(14, 16)) / 60;
    if (startH < 12) beforeNoon += Math.min(hrs, 12 - startH);
    const t = e.start_at.slice(11, 16);
    if (first === null || t < first) first = t;
  }
  let earlyStart = false;
  if (first && wakeTime) {
    const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    earlyStart = toMin(first) <= toMin(wakeTime) + 30;
  }
  return {
    count: events.length,
    totalHours: Math.round(total * 10) / 10,
    beforeNoonHours: Math.round(beforeNoon * 10) / 10,
    firstStart: first,
    earlyStart,
  };
}

const isMedical = (title: string): boolean =>
  /\b(doctor|dentist|clinic|hospital|therapy|therapist|medical|appointment with dr|va |veteran|pharmacy|checkup|check-up|scan|lab work|bloodwork)\b/i.test(title);

export function buildCoachPanel(inp: CoachInput): CoachPanel {
  const totalDays = inp.impacts.length ? Math.max(...inp.impacts.map((i) => i.nWith + i.nWithout)) : 0;
  const hrvPct = inp.hrvMs !== null && inp.baselineHrvMs ? ((inp.hrvMs - inp.baselineHrvMs) / inp.baselineHrvMs) * 100 : null;

  // ---------------------------------------------------------- brief
  const briefLines: string[] = [];
  if (inp.battery !== null && inp.stress !== null && inp.pressure !== null) {
    briefLines.push(`Battery ${r0(inp.battery)}% · Stress ${r0(inp.stress)}% · Pressure ${r0(inp.pressure)} on ${inp.date}.`);
  }
  if (inp.hrvMs !== null) {
    briefLines.push(
      hrvPct !== null
        ? `HRV ${r0(inp.hrvMs)} ms — ${pct(hrvPct)} vs your ${r0(inp.baselineHrvMs as number)} ms baseline.`
        : `HRV ${r0(inp.hrvMs)} ms.`,
    );
  }
  if (inp.sleepHours !== null) {
    briefLines.push(
      `Slept ${r1(inp.sleepHours)} h${inp.sleepMedian !== null ? ` (your median ${r1(inp.sleepMedian)} h)` : ""}${inp.sleepDebtH > 0 ? ` · debt ${r1(inp.sleepDebtH)} h vs the 8 h target` : " · no sleep debt vs the 8 h target"}.`,
    );
  }
  let headline: string;
  if (inp.battery !== null && inp.stress !== null && inp.battery >= 75 && inp.stress < 25) {
    headline = "Recovered — capacity is high today";
  } else if (inp.stress !== null && inp.stress >= 50) {
    headline = "Stress is running high — go deliberate today";
  } else if (inp.sleepDebtH >= 1) {
    headline = "Under-recovered — sleep is the story today";
  } else if (inp.battery !== null && inp.battery < 40) {
    headline = "Running low — protect the day";
  } else {
    headline = "Steady — a normal-capacity day";
  }

  // ------------------------------------------------- schedule context
  const load = scheduleLoad(inp.eventsToday, inp.wakeTime);
  let scheduleLine: string | null = null;
  if (load.count > 0) {
    scheduleLine = `Today's schedule: ${load.count} event${load.count === 1 ? "" : "s"}, ${r1(load.totalHours)} h booked${load.firstStart ? `, first at ${load.firstStart}` : ""}${load.beforeNoonHours > 0 ? ` (${r1(load.beforeNoonHours)} h before noon)` : ""}.`;
    briefLines.push(scheduleLine);
    const med = inp.eventsToday.find((e) => isMedical(e.title));
    if (med) {
      briefLines.push(`Includes a medical block: ${med.title} at ${med.start_at.slice(11, 16)} — plan a light morning around it.`);
    }
    if (load.earlyStart && inp.wakeTime) {
      briefLines.push(`First event at ${load.firstStart} lands within 30 min of your ${inp.wakeTime} wake time — a tight start.`);
    }
  }
  const tomorrowLoad = scheduleLoad(inp.eventsTomorrow, null);
  if (tomorrowLoad.count > 0 && tomorrowLoad.firstStart) {
    briefLines.push(`Tomorrow starts at ${tomorrowLoad.firstStart} (${tomorrowLoad.count} event${tomorrowLoad.count === 1 ? "" : "s"}, ${r1(tomorrowLoad.totalHours)} h booked).`);
  }

  // ------------------------------------------------------ impacting
  const impacting: CoachRow[] = [];
  const usable = inp.impacts.filter((i) => i.enoughData && i.metrics);
  const neg = usable
    .filter((i) => (i.metrics!.stress.deltaPct >= 10 || i.metrics!.battery.deltaPct <= -3))
    .sort((a, b) => b.metrics!.stress.deltaPct - a.metrics!.stress.deltaPct)[0];
  const pos = usable
    .filter((i) => i !== neg && (i.metrics!.battery.deltaPct >= 3 || i.metrics!.stress.deltaPct <= -10))
    .sort((a, b) => b.metrics!.battery.deltaPct - a.metrics!.battery.deltaPct)[0];
  const fmtImpact = (i: FactorImpact): string =>
    `${i.factor}: Battery ${pct(i.metrics!.battery.deltaPct)}, Stress ${pct(i.metrics!.stress.deltaPct)} on those days · ${i.nWith} of ${i.nWith + i.nWithout} days`;
  if (neg) impacting.push({ text: fmtImpact(neg), href: "/impact" });
  if (pos) impacting.push({ text: fmtImpact(pos), href: "/impact" });
  if (inp.sleepHours !== null && inp.sleepMedian !== null && Math.abs(inp.sleepHours - inp.sleepMedian) >= 0.5) {
    impacting.push({
      text: inp.sleepHours < inp.sleepMedian
        ? `Last night ran ${r1(inp.sleepMedian - inp.sleepHours)} h under your ${r1(inp.sleepMedian)} h median sleep.`
        : `Last night ran ${r1(inp.sleepHours - inp.sleepMedian)} h over your ${r1(inp.sleepMedian)} h median sleep — a genuine top-up.`,
      href: "/sleep",
    });
  }
  if (inp.impact && inp.impact.stressMinutes !== null && inp.impact.stressMinutes > 0) {
    impacting.push({ text: `Stationary stress so far on the latest measured day: ${inp.impact.stressMinutes} min with your heart up while you sat still.`, href: "/reports/stress" });
  }
  if (inp.standHours !== null) {
    impacting.push({ text: `Stand hours on the latest measured day: ${inp.standHours}${inp.bestStandHours !== null ? ` (your best days reach ${inp.bestStandHours})` : ""}.`, href: "/reports/activity" });
  }
  if (!impacting.length) {
    impacting.push({ text: "No factor has enough paired days yet — keep logging journal tags and measuring, and this card ranks what moves you.", href: "/impact" });
  }

  // -------------------------------------------------------- drivers
  // Hard drivers block protective mode; soft ones become "Watch:" lines
  // when stress is low (a 0% day with a small sleep debt is a good day
  // with a watch item, not a driven day).
  const drivers: CoachRow[] = [];
  let hard = 0;
  if (inp.impact && inp.impact.stressMinutes !== null && inp.impact.stressMinutes > 0) {
    hard++;
    const ranges = hourRanges(inp.buckets, (b) => b.hr !== null && inp.restingBaseline !== null && b.hr >= inp.restingBaseline * 1.2 && (b.steps ?? 0) < 50);
    drivers.push({
      text: `Stationary stress ${inp.impact.stressMinutes} min — heart elevated while still${ranges.length ? ` around ${ranges.join(", ")}` : ""}.`,
      href: "/reports/stress",
    });
  }
  if (inp.sleepDebtH >= 0.5 && inp.sleepHours !== null) {
    if (inp.sleepDebtH >= 1) hard++;
    drivers.push({ text: `Sleep debt ${r1(inp.sleepDebtH)} h — last night ${r1(inp.sleepHours)} h against the 8 h target.`, href: "/sleep" });
  }
  if (hrvPct !== null && hrvPct <= -10) {
    hard++;
    drivers.push({ text: `HRV ${r0(inp.hrvMs as number)} ms is ${r0(Math.abs(hrvPct))}% below your ${r0(inp.baselineHrvMs as number)} ms baseline — recovery is lagging.` });
  }
  if (inp.restingHrBpm !== null && inp.restingBaseline !== null && inp.restingHrBpm - inp.restingBaseline >= 3) {
    hard++;
    drivers.push({ text: `Resting heart rate ${r0(inp.restingHrBpm)} bpm is ${r0(inp.restingHrBpm - inp.restingBaseline)} bpm above your baseline — a classic strain signal.` });
  }
  if (inp.standHours !== null && inp.impact && inp.impact.hoursWithData >= 6 && inp.standHours <= 4) {
    drivers.push({ text: `Low movement: ${inp.standHours} stand hours across ${inp.impact.hoursWithData} measured hours.`, href: "/reports/activity" });
  }
  for (const i of usable) {
    if (i.factor.startsWith("tag:") && i.metrics!.stress.deltaPct >= 15) {
      hard++;
      drivers.push({ text: `Days tagged "${i.factor.slice(5)}" run ${pct(i.metrics!.stress.deltaPct)} stress (${i.nWith} days).`, href: "/impact" });
    }
  }
  if (scheduleLine && load.beforeNoonHours >= 2) {
    drivers.push({ text: `Front-loaded morning: ${r1(load.beforeNoonHours)} h booked before noon today.` });
  }
  const protective = (inp.stress ?? 100) < 25 && hard === 0;
  let finalDrivers = drivers;
  if (protective) {
    const keep: CoachRow[] = [];
    if (inp.sleepDebtH < 0.5 && inp.sleepHours !== null) {
      keep.push({ text: `Sleep is doing its job: ${r1(inp.sleepHours)} h last night, debt only ${r1(inp.sleepDebtH)} h.`, href: "/sleep" });
    } else if (inp.sleepHours !== null && inp.sleepMedian !== null && inp.sleepHours >= inp.sleepMedian) {
      keep.push({ text: `Last night ran ${r1(inp.sleepHours)} h — at or above your recorded median, a genuine top-up.`, href: "/sleep" });
    }
    if (hrvPct !== null && hrvPct >= 0) {
      keep.push({ text: `HRV ${r0(inp.hrvMs as number)} ms is at or above your baseline (${pct(hrvPct)}) — the recovery signal is green.` });
    }
    if (inp.impact && inp.impact.stressMinutes === 0) {
      keep.push({ text: `Zero stationary-stress minutes across ${inp.impact.hoursWithData} measured hours — no still-and-revved blocks.`, href: "/reports/stress" });
    }
    if (inp.standHours !== null && inp.standHours >= 6) {
      keep.push({ text: `${inp.standHours} stand hours kept the day moving.`, href: "/reports/activity" });
    }
    if (!keep.length && inp.stress !== null) {
      keep.push({ text: `Stress ${r0(inp.stress)}% sits low with no driver firing — nothing in today's signals is pushing it up.` });
    }
    finalDrivers = [...keep, ...drivers.map((d) => ({ ...d, text: `Watch: ${d.text}` }))];
  }

  // -------------------------------------------------------- actions
  const actions: CoachAction[] = [];
  if (inp.sleepDebtH >= 0.5) {
    let when = "";
    if (inp.wakeTime && inp.sleepMedian !== null) {
      const need = Math.min(9.5, 8 + inp.sleepDebtH);
      const wakeMin = Number(inp.wakeTime.slice(0, 2)) * 60 + Number(inp.wakeTime.slice(3, 5));
      const outMin = ((wakeMin - Math.round(need * 60)) % 1440 + 1440) % 1440;
      when = ` — lights-out by ${String(Math.floor(outMin / 60)).padStart(2, "0")}:${String(outMin % 60).padStart(2, "0")} repays it tonight`;
    }
    actions.push({ text: `Sleep debt ${r1(inp.sleepDebtH)} h${when}.`, href: "/sleep" });
  }
  if (inp.impact && inp.impact.stressMinutes !== null && inp.impact.stressMinutes >= 60) {
    const ranges = hourRanges(inp.buckets, (b) => b.hr !== null && inp.restingBaseline !== null && b.hr >= inp.restingBaseline * 1.2 && (b.steps ?? 0) < 50);
    actions.push({
      text: `Your still-and-elevated block${ranges.length ? ` ran ${ranges[0]}` : ""} — a 10-minute walk right after that block is the lever that breaks it.`,
      href: "/reports/stress",
    });
  }
  if (inp.standHours !== null && inp.bestStandHours !== null && inp.bestStandHours - inp.standHours >= 2) {
    actions.push({
      text: `Stand hours: ${inp.standHours} on the latest day vs ${inp.bestStandHours} on your best days — two short walks close most of that gap.`,
      href: "/reports/activity",
    });
  }
  if (inp.stress !== null && inp.stress >= 50 && !inp.breathingOnDate) {
    actions.push({ text: `Stress ${r0(inp.stress)}% with no breathing session logged — a 2-minute box-breathing round is the fastest reset you own.`, href: "/more#breathing" });
  }
  if (load.count >= 4) {
    actions.push({ text: `Heavy schedule (${load.count} events, ${r1(load.totalHours)} h) — put the hardest thing in your first free block, not the last.` });
  }
  const capped = actions.slice(0, 3);
  let topAction: string;
  if (capped.length) {
    topAction = capped[0].text;
  } else if (inp.battery !== null && inp.stress !== null && inp.battery >= 75 && inp.stress < 25) {
    topAction = "Capacity is there: a hard session or the hardest task on your list fits today — your numbers support it.";
  } else {
    topAction = "Nothing is flagging — hold the current rhythm and let tonight's sleep set tomorrow up.";
  }
  const mostImportant = capped.length ? capped[0].text : topAction;

  // ---------------------------------------------------------- chips
  const chips: CoachChip[] = [];
  if (!protective && drivers.length) chips.push({ label: "Why is my stress up?", question: "Why is my stress up today?" });
  if (inp.sleepDebtH >= 0.5) chips.push({ label: "How do I repay my sleep debt?", question: "How do I repay my sleep debt?" });
  if (hrvPct !== null && hrvPct >= 25) chips.push({ label: "Why is my HRV so high?", question: "Why is my HRV so high?" });
  if (inp.impact && inp.impact.stressMinutes !== null && inp.impact.stressMinutes >= 60) {
    chips.push({ label: "What is stationary stress doing?", question: "What is stationary stress doing to me?" });
  }
  if (inp.battery !== null && inp.battery < 40) chips.push({ label: "Why is my Battery low?", question: "Why is my Battery low today?" });
  if (!chips.length) chips.push({ label: "How am I doing today?", question: "How am I doing today?" });
  if (chips.length === 1 && totalDays > 0) chips.push({ label: "What moves my numbers most?", question: "What moves my numbers most?" });

  return {
    headline,
    briefLines,
    mostImportant,
    impacting: impacting.slice(0, 4),
    driversTitle: protective ? "What's keeping stress low" : "What's driving stress",
    drivers: finalDrivers.slice(0, 5),
    protective,
    actions: capped,
    topAction,
    chips: chips.slice(0, 3),
    scheduleLine,
  };
}
