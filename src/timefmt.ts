/**
 * timefmt.ts - the site's one clock-time formatter. Barklee's rule
 * (2026-11-04): every human-visible clock time in the UI is 12-hour
 * ("2:05 PM"). Machine formats (ISO strings, API JSON, stored data)
 * are NOT touched by this module - display only.
 */

/** "7:00 AM" for an hour of day 0-23. */
export function fmtHour12(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ap}`;
}

/** "7:05 AM" for numeric hour + minute (minute >= 60 rolls over). */
export function fmtHourMin12(hour: number, minute: number): string {
  let h = Math.floor(hour);
  let m = Math.floor(minute);
  if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  h = ((h % 24) + 24) % 24;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** "2:05 PM" from an ISO timestamp or an "HH:MM" string.
 *  Unparseable input is returned unchanged. */
export function fmtTime12(input: string): string {
  const s = String(input);
  const t = s.length >= 16 && s[10] === "T" ? s.slice(11, 16) : s.slice(0, 5);
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(3, 5));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return s;
  return fmtHourMin12(hh, mm);
}
