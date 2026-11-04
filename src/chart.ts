/**
 * OpenHRV — shared chart system (granularity wave, /design applied to data).
 *
 * ONE component renders every detail chart in the app: server-rendered SVG
 * with labeled axes (y tick values + unit, x time labels), min/max markers,
 * a client crosshair (value bubble with exact value + full timestamp,
 * Apple Health behavior), a selected-point readout, and a data-table
 * toggle for accessibility. Geometry constants are stamped onto the
 * container as data attributes so the client enhancer (CHART_JS) positions
 * the bubble from the SAME mapping the server used to draw — no drift.
 */

export interface ChartPoint {
  v: number;
  /** Short axis label, e.g. "07:00" or "Nov 3". */
  label: string;
  /** Full readout for the bubble/readout, e.g. "Tue Nov 3 · 07:00 · 62 ms". */
  full: string;
}

export interface ChartZone {
  vFrom: number;
  vTo: number;
  color: string;
  label: string;
}

export interface LineChartOpts {
  id: string;
  points: ChartPoint[];
  unit: string;
  color: string;
  zones?: ChartZone[];
  decimals?: number;
  height?: number;
  /** Y-axis caption shown at the top-left; defaults to the unit. */
  yLabel?: string;
}

export const CHART_W = 720;
export const PAD_L = 48;
export const PAD_R = 14;
export const PAD_T = 22;
export const PAD_B = 26;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => esc(s).replace(/'/g, "&#39;");

export interface ChartDomain {
  min: number;
  max: number;
}

export function chartDomain(values: number[], zones: ChartZone[] = []): ChartDomain {
  let min = Math.min(...values);
  let max = Math.max(...values);
  for (const z of zones) {
    min = Math.min(min, z.vFrom);
    max = Math.max(max, z.vTo);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

const fmt = (v: number, decimals: number): string =>
  decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));

/** Server-rendered line/area chart with labeled axes, zones, crosshair
 *  hooks, readout and a data-table toggle. Empty series renders an honest
 *  empty state instead of a naked frame. */
export function lineChart(opts: LineChartOpts): string {
  const { points, unit, color, id } = opts;
  const decimals = opts.decimals ?? 0;
  const H = opts.height ?? 220;
  if (!points.length) {
    return `<div class="chart chart-empty" data-chart="${escAttr(id)}"><p class="sub">No data in this range yet.</p></div>`;
  }
  const values = points.map((p) => p.v);
  const dom = chartDomain(values, opts.zones ?? []);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number): number =>
    points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (points.length - 1)) * plotW;
  const y = (v: number): number => PAD_T + (1 - (v - dom.min) / (dom.max - dom.min)) * plotH;

  // Y ticks: 4 gridlines with value labels + the unit as the axis title.
  let ticks = "";
  for (let i = 0; i <= 3; i++) {
    const v = dom.min + ((dom.max - dom.min) * i) / 3;
    const ty = y(v);
    ticks += `<line class="chart-grid" x1="${PAD_L}" y1="${ty.toFixed(1)}" x2="${CHART_W - PAD_R}" y2="${ty.toFixed(1)}" stroke="#e5e5ea" stroke-width="1"/>` +
      `<text x="${PAD_L - 6}" y="${(ty + 3).toFixed(1)}" text-anchor="end" class="chart-tick">${fmt(v, decimals)}</text>`;
  }
  // Axis title sits ABOVE the plot, left-aligned at the plot edge —
  // end-anchoring it in the 48px gutter clipped any label over ~7 chars
  // ("Heart rate (bpm)" rendered as "e (bpm)" in the wave screenshots).
  const yTitle = `<text x="${PAD_L}" y="${PAD_T - 8}" text-anchor="start" class="chart-unit">${esc(opts.yLabel ?? unit)}</text>`;

  // Zone bands (value ranges) with labels at the right edge.
  let zoneSvg = "";
  for (const z of opts.zones ?? []) {
    const yTop = y(Math.min(z.vTo, dom.max));
    const yBot = y(Math.max(z.vFrom, dom.min));
    zoneSvg += `<rect x="${PAD_L}" y="${yTop.toFixed(1)}" width="${plotW}" height="${Math.max(0, yBot - yTop).toFixed(1)}" fill="${z.color}" fill-opacity="0.10"/>` +
      `<text x="${CHART_W - PAD_R - 4}" y="${(yTop + 11).toFixed(1)}" text-anchor="end" class="chart-zone">${esc(z.label)}</text>`;
  }

  // X labels: up to 8, evenly sampled, first + last always present.
  const step = Math.max(1, Math.ceil(points.length / 8));
  let xLabels = "";
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="chart-tick">${esc(p.label)}</text>`;
  });

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

  // Min / max markers with value labels.
  let minI = 0;
  let maxI = 0;
  values.forEach((v, i) => {
    if (v < values[minI]) minI = i;
    if (v > values[maxI]) maxI = i;
  });
  const marker = (i: number, above: boolean, tag: string): string =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(points[i].v).toFixed(1)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"/>` +
    `<text x="${x(i).toFixed(1)}" y="${(y(points[i].v) + (above ? -8 : 14)).toFixed(1)}" text-anchor="middle" class="chart-extreme">${tag} ${fmt(points[i].v, decimals)}${unit ? " " + esc(unit) : ""}</text>`;

  const dataJson = escAttr(
    JSON.stringify(points.map((p) => ({ v: p.v, full: p.full }))),
  );
  const tableRows = points
    .map((p) => `<tr><td>${esc(p.full)}</td><td>${fmt(p.v, decimals)}${unit ? " " + esc(unit) : ""}</td></tr>`)
    .join("");

  return `<div class="chart" data-chart="${escAttr(id)}" data-w="${CHART_W}" data-h="${H}" data-padl="${PAD_L}" data-padr="${PAD_R}" data-padt="${PAD_T}" data-padb="${PAD_B}" data-vmin="${dom.min}" data-vmax="${dom.max}" data-points='${dataJson}'>
<svg viewBox="0 0 ${CHART_W} ${H}" width="100%" role="img" aria-label="Chart, ${esc(unit)}">${yTitle}${zoneSvg}${ticks}<path d="${area}" fill="${color}" fill-opacity="0.13" stroke="none"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${marker(maxI, true, "max")}${points.length > 1 && minI !== maxI ? marker(minI, false, "min") : ""}${xLabels}</svg>
<div class="chart-guide" hidden></div><div class="chart-bubble" hidden></div>
<div class="chart-foot"><span class="chart-readout" aria-live="polite"></span><button type="button" class="chart-tbtn">Data table</button></div>
<div class="chart-table" hidden><table><thead><tr><th>Time</th><th>Value</th></tr></thead><tbody>${tableRows}</tbody></table></div>
</div>`;
}

/** Sleep stage composition bar — stage TOTALS (minutes) as proportional
 *  segments in Health's sleep colors. This is a composition, never a
 *  sequence: the sync lanes provide durations, not stage intervals. */
export const STAGE_COLORS: Record<string, string> = {
  deep: "#5e5ce6",
  core: "#0a84ff",
  rem: "#64d2ff",
  awake: "#ff9f0a",
  asleep: "#0a84ff",
  unspecified: "#8e8e93",
  asleep_unspecified: "#8e8e93",
  inbed: "#d1d1d6",
  in_bed: "#d1d1d6",
};

export function stageBar(segments: Array<{ stage: string; minutes: number }>): string {
  const disp = (stage: string): string => {
    const k = stage.toLowerCase();
    if (k === "rem") return "REM";
    if (k === "unspecified" || k === "asleep_unspecified") return "Asleep (unspecified)";
    if (k === "inbed" || k === "in_bed") return "In bed";
    return stage.charAt(0).toUpperCase() + stage.slice(1);
  };
  const segs = segments.filter((s) => s.minutes > 0);
  const total = segs.reduce((a, s) => a + s.minutes, 0);
  if (!total) return "";
  const bar = segs
    .map((s) => {
      const pct = (s.minutes / total) * 100;
      const color = STAGE_COLORS[s.stage.toLowerCase()] ?? "#8e8e93";
      return `<div class="stage-seg" style="width:${pct.toFixed(1)}%;background:${color}" title="${esc(disp(s.stage))} ${Math.round(s.minutes)} min"></div>`;
    })
    .join("");
  const legend = segs
    .map((s) => {
      const color = STAGE_COLORS[s.stage.toLowerCase()] ?? "#8e8e93";
      const hrs = Math.floor(s.minutes / 60);
      const mins = Math.round(s.minutes % 60);
      return `<div class="stat"><span><span class="stage-dot" style="background:${color}"></span>${esc(disp(s.stage))}</span><b>${hrs ? hrs + " h " : ""}${mins} min</b></div>`;
    })
    .join("");
  return `<div class="stagebar" role="img" aria-label="Sleep stage totals">${bar}</div>${legend}` +
    `<p class="sub">Stage totals for the night. This sync provides stage durations, not their sequence, so no timeline is drawn.</p>`;
}

/** Client enhancer: crosshair + bubble + readout + table toggle for every
 *  .chart on the page. ES5-style like the rest of the app's inline scripts.
 *  Positions derive from the same geometry constants the server stamped
 *  into data attributes. */
export const CHART_JS = `
function chartInit(root) {
  var pts; try { pts = JSON.parse(root.getAttribute("data-points") || "[]"); } catch (e) { pts = []; }
  if (!pts.length) return;
  var W = +root.getAttribute("data-w"), H = +root.getAttribute("data-h");
  var pL = +root.getAttribute("data-padl"), pR = +root.getAttribute("data-padr");
  var pT = +root.getAttribute("data-padt"), pB = +root.getAttribute("data-padb");
  var vmin = +root.getAttribute("data-vmin"), vmax = +root.getAttribute("data-vmax");
  var bubble = root.querySelector(".chart-bubble"), guide = root.querySelector(".chart-guide");
  var readout = root.querySelector(".chart-readout");
  function pos(i) {
    var fx = pts.length === 1 ? (pL + (W - pL - pR) / 2) / W : (pL + i / (pts.length - 1) * (W - pL - pR)) / W;
    var fy = (pT + (1 - (pts[i].v - vmin) / (vmax - vmin)) * (H - pT - pB)) / H;
    return { x: fx, y: fy };
  }
  function show(i) {
    var r = root.getBoundingClientRect(); if (!r.width) return;
    var p = pos(i);
    guide.hidden = false; bubble.hidden = false;
    guide.style.left = (p.x * 100) + "%"; guide.style.height = (r.width * H / W) + "px";
    bubble.textContent = pts[i].full;
    bubble.style.left = Math.min(Math.max(p.x * 100, 12), 88) + "%";
    bubble.style.top = (p.y * (r.width * H / W)) + "px";
    if (readout) readout.textContent = pts[i].full;
  }
  function hide() { guide.hidden = true; bubble.hidden = true; }
  function onMove(e) {
    var r = root.getBoundingClientRect(); if (!r.width) return;
    var cx = (e.touches && e.touches.length ? e.touches[0].clientX : e.clientX) - r.left;
    var frac = (cx / r.width * W - pL) / (W - pL - pR);
    var i = Math.round(frac * (pts.length - 1));
    show(Math.max(0, Math.min(pts.length - 1, i)));
  }
  root.addEventListener("pointermove", onMove);
  root.addEventListener("touchmove", onMove, { passive: true });
  root.addEventListener("pointerdown", onMove);
  root.addEventListener("pointerleave", hide);
  var btn = root.querySelector(".chart-tbtn"), tbl = root.querySelector(".chart-table");
  if (btn && tbl) btn.addEventListener("click", function() { tbl.hidden = !tbl.hidden; btn.textContent = tbl.hidden ? "Data table" : "Hide table"; });
}
document.querySelectorAll(".chart[data-points]").forEach(chartInit);
`;

export const CHART_CSS = `
.sparkwrap{position:relative;display:block}
.sparkmax,.sparkmin{position:absolute;right:0;font-size:10px;font-weight:600;color:#8e8e93;line-height:1}
.sparkmax{top:0}.sparkmin{bottom:0}
.chart{position:relative;margin-top:6px}
.chart svg{display:block}
.chart-tick{font-size:11px;fill:#8e8e93}
.chart-unit{font-size:11px;font-weight:600;fill:#8e8e93}
.chart-zone{font-size:10px;font-weight:600;fill:#636366}
.chart-extreme{font-size:11px;font-weight:600;fill:#636366}
.chart-guide{position:absolute;top:0;width:1px;background:#aeaeb2;pointer-events:none}
.chart-bubble{position:absolute;transform:translate(-50%,-130%);background:#1c1c1e;color:#fff;font-size:12px;font-weight:600;padding:4px 8px;border-radius:8px;white-space:nowrap;pointer-events:none;z-index:3}
.chart-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px}
.chart-readout{font-size:12px;color:#636366}
.chart-tbtn{background:none;border:none;color:var(--acc);font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;min-height:32px}
.chart-table{max-height:260px;overflow:auto;margin-top:6px}
.chart-table table{width:100%;border-collapse:collapse;font-size:13px}
.chart-table th,.chart-table td{text-align:left;padding:5px 4px;border-bottom:1px solid #e5e5ea}
.stagebar{display:flex;height:18px;border-radius:9px;overflow:hidden;margin:8px 0 4px}
.stage-seg{height:100%}
.stage-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
.seg a{display:inline-block;padding:6px 13px;border-radius:8px;color:#636366;text-decoration:none;font-weight:600;font-size:14px;min-height:32px;line-height:20px}
.seg a.on{background:#fff;color:#1c1c1e;box-shadow:0 1px 3px rgba(0,0,0,.14)}

/* Phase 2: trio header, journal, reports */
.trio{display:flex;gap:10px;text-align:left}
.trio .tcell{flex:1;min-width:0}
.trio .tval{font-size:31px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.trio .tname{font-size:14px;color:var(--txt);margin-top:1px}
.trio .tstate{display:inline-block;font-size:13px;font-weight:600;padding-bottom:2px;border-bottom:4px solid #3a3a3c;border-radius:2px;margin-top:3px}
.statgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 10px;margin-top:6px}
.statgrid .sg .sgn{font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--dim);text-transform:uppercase}
.statgrid .sg .sgv{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
.gaugestrip{display:flex;gap:4px;overflow-x:auto;padding:6px 0 2px}
.gday{flex:0 0 auto;text-align:center;text-decoration:none;color:inherit;width:68px}
.gday .gv{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.gday .gd{font-size:11px;color:var(--dim)}
.gday.sel{background:var(--bg);border-radius:12px;outline:2px solid var(--acc)}
.calstrip{display:flex;gap:6px;overflow-x:auto;padding:4px 0 8px}
.calday{flex:0 0 auto;width:44px;text-align:center;text-decoration:none;color:inherit}
.calday .cd{font-size:12px;color:var(--dim)}
.orb{width:30px;height:30px;border-radius:50%;margin:4px auto 0;border:2px solid var(--line);display:block}
.jcard{display:block;background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:12px 14px;margin:8px 0;text-decoration:none;color:inherit}
.jcard .jt{display:flex;gap:10px;align-items:baseline}
.jcard .jtime{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums;flex:0 0 52px}
.jcard .jtitle{font-size:16px;font-weight:600}
.jcard .jdetail{color:var(--dim);font-size:14px;margin-top:2px}
.jcard .jsrc{margin-left:auto;color:var(--dim);font-size:11px;flex:none}
details.sect{border-bottom:1px solid var(--line);padding:10px 0}
details.sect:last-child{border-bottom:none}
details.sect summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px;min-height:32px}
details.sect summary::-webkit-details-marker{display:none}
.sect .sval{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.sect .sname{font-size:17px;font-weight:600}
.sect .sstate{font-size:13px;font-weight:600}
.sect .chip{margin-left:auto;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.sect .sbody{padding:6px 0 4px}
.answrap{display:flex;align-items:flex-end;gap:14px}
.ansbar{width:64px;height:120px;border-radius:10px;overflow:hidden;display:flex;flex-direction:column-reverse;background:var(--bg)}
.ansbar .ans-sym{background:#ff453a}
.ansbar .ans-para{background:#0a84ff}
.chart-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
.lgchip{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dim)}
.daynav{display:flex;justify-content:space-between;align-items:center;margin:8px 0}

`;

// ------------------------------------------------------- phase 2 chart types

export interface MultiSeries {
  label: string;
  color: string;
  points: ChartPoint[];
}

/** Multi-line chart (Latest results: Stress / Energy / Health on one set
 *  of labeled axes). Series must be index-aligned by the caller. The
 *  crosshair payload combines every series' value at the touched index. */
export function multiLineChart(opts: {
  id: string;
  unit: string;
  yLabel?: string;
  decimals?: number;
  series: MultiSeries[];
  height?: number;
}): string {
  const decimals = opts.decimals ?? 0;
  const H = opts.height ?? 220;
  const series = opts.series.filter((s) => s.points.length);
  if (!series.length) {
    return `<div class="chart chart-empty" data-chart="${escAttr(opts.id)}"><p class="sub">No data in this range yet.</p></div>`;
  }
  const n = Math.max(...series.map((s) => s.points.length));
  const values = series.flatMap((s) => s.points.map((p) => p.v));
  const dom = chartDomain(values);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number): number => (n === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW);
  const y = (v: number): number => PAD_T + (1 - (v - dom.min) / (dom.max - dom.min)) * plotH;
  let ticks = "";
  for (let i = 0; i <= 3; i++) {
    const v = dom.min + ((dom.max - dom.min) * i) / 3;
    const ty = y(v);
    ticks += `<line class="chart-grid" x1="${PAD_L}" y1="${ty.toFixed(1)}" x2="${CHART_W - PAD_R}" y2="${ty.toFixed(1)}" stroke="#e5e5ea" stroke-width="1"/>` +
      `<text x="${PAD_L - 6}" y="${(ty + 3).toFixed(1)}" text-anchor="end" class="chart-tick">${fmt(v, decimals)}</text>`;
  }
  const yTitle = `<text x="${PAD_L}" y="${PAD_T - 8}" text-anchor="start" class="chart-unit">${esc(opts.yLabel ?? opts.unit)}</text>`;
  const base = series[0].points;
  const step = Math.max(1, Math.ceil(n / 8));
  let xLabels = "";
  base.forEach((p, i) => {
    if (i % step !== 0 && i !== base.length - 1) return;
    const anchor = i === 0 ? "start" : i === base.length - 1 ? "end" : "middle";
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="chart-tick">${esc(p.label)}</text>`;
  });
  let paths = "";
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const combined: ChartPoint[] = base.map((p, i) => ({
    v: p.v,
    label: p.label,
    full: `${p.label} · ${series.map((s) => `${s.label} ${s.points[i] ? fmt(s.points[i].v, decimals) : "—"}${opts.unit ? " " + opts.unit : ""}`).join(" · ")}`,
  }));
  const dataJson = escAttr(JSON.stringify(combined.map((p) => ({ v: p.v, full: p.full }))));
  const tableRows = combined
    .map((p, i) => `<tr><td>${esc(p.label)}</td><td>${series.map((s) => `${esc(s.label)} ${s.points[i] ? fmt(s.points[i].v, decimals) : "—"}`).join(" · ")}</td></tr>`)
    .join("");
  const legend = series
    .map((s) => `<span class="lgchip"><span class="stage-dot" style="background:${s.color}"></span>${esc(s.label)} ${fmt(s.points[s.points.length - 1].v, decimals)}${opts.unit ? " " + esc(opts.unit) : ""}</span>`)
    .join("");
  return `<div class="chart" data-chart="${escAttr(opts.id)}" data-w="${CHART_W}" data-h="${H}" data-padl="${PAD_L}" data-padr="${PAD_R}" data-padt="${PAD_T}" data-padb="${PAD_B}" data-vmin="${dom.min}" data-vmax="${dom.max}" data-points='${dataJson}'>
<svg viewBox="0 0 ${CHART_W} ${H}" width="100%" role="img" aria-label="Chart, ${esc(opts.unit)}">${yTitle}${ticks}${paths}${xLabels}</svg>
<div class="chart-guide" hidden></div><div class="chart-bubble" hidden></div>
<div class="chart-foot"><span class="chart-readout" aria-live="polite"></span><button type="button" class="chart-tbtn">Data table</button></div>
<div class="chart-table" hidden><table><thead><tr><th>Time</th><th>Values</th></tr></thead><tbody>${tableRows}</tbody></table></div>
<div class="chart-legend">${legend}</div>
</div>`;
}

/** Labeled bar chart (Activity report daily bars). Same axes, crosshair
 *  payload, readout and table contract as the line chart. */
export function barChart(opts: {
  id: string;
  points: ChartPoint[];
  unit: string;
  color: string;
  yLabel?: string;
  decimals?: number;
  height?: number;
}): string {
  const { points, unit, color } = opts;
  const decimals = opts.decimals ?? 0;
  const H = opts.height ?? 200;
  if (!points.length) {
    return `<div class="chart chart-empty" data-chart="${escAttr(opts.id)}"><p class="sub">No data in this range yet.</p></div>`;
  }
  const values = points.map((p) => p.v);
  const maxV = Math.max(...values, 0);
  const dom = { min: 0, max: maxV === 0 ? 1 : maxV * 1.08 };
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / points.length;
  const bw = Math.max(2, Math.min(38, slot * 0.62));
  const y = (v: number): number => PAD_T + (1 - (v - dom.min) / (dom.max - dom.min)) * plotH;
  let ticks = "";
  for (let i = 0; i <= 3; i++) {
    const v = dom.min + ((dom.max - dom.min) * i) / 3;
    const ty = y(v);
    ticks += `<line class="chart-grid" x1="${PAD_L}" y1="${ty.toFixed(1)}" x2="${CHART_W - PAD_R}" y2="${ty.toFixed(1)}" stroke="#e5e5ea" stroke-width="1"/>` +
      `<text x="${PAD_L - 6}" y="${(ty + 3).toFixed(1)}" text-anchor="end" class="chart-tick">${fmt(v, decimals)}</text>`;
  }
  const yTitle = `<text x="${PAD_L}" y="${PAD_T - 8}" text-anchor="start" class="chart-unit">${esc(opts.yLabel ?? unit)}</text>`;
  const step = Math.max(1, Math.ceil(points.length / 8));
  let bars = "";
  let xLabels = "";
  let maxI = 0;
  values.forEach((v, i) => { if (v > values[maxI]) maxI = i; });
  points.forEach((p, i) => {
    const cx = PAD_L + slot * i + slot / 2;
    const top = y(p.v);
    bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, PAD_T + plotH - top).toFixed(1)}" rx="3" fill="${color}" fill-opacity="0.85"/>`;
    if (i === maxI) bars += `<text x="${cx.toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle" class="chart-extreme">max ${fmt(p.v, decimals)}${unit ? " " + esc(unit) : ""}</text>`;
    if (i % step === 0 || i === points.length - 1) {
      const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
      xLabels += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="chart-tick">${esc(p.label)}</text>`;
    }
  });
  const dataJson = escAttr(JSON.stringify(points.map((p) => ({ v: p.v, full: p.full }))));
  const tableRows = points.map((p) => `<tr><td>${esc(p.full)}</td><td>${fmt(p.v, decimals)}${unit ? " " + esc(unit) : ""}</td></tr>`).join("");
  return `<div class="chart" data-chart="${escAttr(opts.id)}" data-w="${CHART_W}" data-h="${H}" data-padl="${PAD_L}" data-padr="${PAD_R}" data-padt="${PAD_T}" data-padb="${PAD_B}" data-vmin="${dom.min}" data-vmax="${dom.max}" data-points='${dataJson}'>
<svg viewBox="0 0 ${CHART_W} ${H}" width="100%" role="img" aria-label="Bar chart, ${esc(unit)}">${yTitle}${ticks}${bars}${xLabels}</svg>
<div class="chart-guide" hidden></div><div class="chart-bubble" hidden></div>
<div class="chart-foot"><span class="chart-readout" aria-live="polite"></span><button type="button" class="chart-tbtn">Data table</button></div>
<div class="chart-table" hidden><table><thead><tr><th>Time</th><th>Value</th></tr></thead><tbody>${tableRows}</tbody></table></div>
</div>`;
}

export interface SegPoint extends ChartPoint {
  seg: string;
}

/** Segment-colored line (Heart report): one path per contiguous run of
 *  the same state, runs joined through the boundary point so the curve
 *  never breaks; a legend names every state present. */
export function segmentChart(opts: {
  id: string;
  points: SegPoint[];
  unit: string;
  yLabel?: string;
  segColors: Record<string, string>;
  segLabels: Record<string, string>;
  decimals?: number;
  height?: number;
}): string {
  const { points, unit } = opts;
  const decimals = opts.decimals ?? 0;
  const H = opts.height ?? 240;
  if (!points.length) {
    return `<div class="chart chart-empty" data-chart="${escAttr(opts.id)}"><p class="sub">No heart-rate data for this day yet.</p></div>`;
  }
  const values = points.map((p) => p.v);
  const dom = chartDomain(values);
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number): number => (points.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (points.length - 1)) * plotW);
  const y = (v: number): number => PAD_T + (1 - (v - dom.min) / (dom.max - dom.min)) * plotH;
  let ticks = "";
  for (let i = 0; i <= 3; i++) {
    const v = dom.min + ((dom.max - dom.min) * i) / 3;
    const ty = y(v);
    ticks += `<line class="chart-grid" x1="${PAD_L}" y1="${ty.toFixed(1)}" x2="${CHART_W - PAD_R}" y2="${ty.toFixed(1)}" stroke="#e5e5ea" stroke-width="1"/>` +
      `<text x="${PAD_L - 6}" y="${(ty + 3).toFixed(1)}" text-anchor="end" class="chart-tick">${fmt(v, decimals)}</text>`;
  }
  const yTitle = `<text x="${PAD_L}" y="${PAD_T - 8}" text-anchor="start" class="chart-unit">${esc(opts.yLabel ?? unit)}</text>`;
  const step = Math.max(1, Math.ceil(points.length / 8));
  let xLabels = "";
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="chart-tick">${esc(p.label)}</text>`;
  });
  let paths = "";
  let runStart = 0;
  const flush = (endIdx: number) => {
    const seg = points[runStart].seg;
    const upto = Math.min(endIdx + 1, points.length - 1);
    const d = points.slice(runStart, upto + 1).map((p, j, arr) => `${j ? "L" : "M"}${x(runStart + j).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    paths += `<path d="${d}" fill="none" stroke="${opts.segColors[seg] ?? "#d1d1d6"}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  for (let i = 1; i < points.length; i++) {
    if (points[i].seg !== points[runStart].seg) {
      flush(i - 1);
      runStart = i;
    }
  }
  flush(points.length - 1);
  let maxI = 0;
  values.forEach((v, i) => { if (v > values[maxI]) maxI = i; });
  const maxAnchor = maxI / Math.max(1, points.length - 1) < 0.18 ? "start" : maxI / Math.max(1, points.length - 1) > 0.82 ? "end" : "middle";
  const marker = `<circle cx="${x(maxI).toFixed(1)}" cy="${y(points[maxI].v).toFixed(1)}" r="3.5" fill="#fff" stroke="#ff2d55" stroke-width="2"/><text x="${x(maxI).toFixed(1)}" y="${(y(points[maxI].v) - 8).toFixed(1)}" text-anchor="${maxAnchor}" class="chart-extreme">max ${fmt(points[maxI].v, decimals)}${unit ? " " + esc(unit) : ""}</text>`;
  const seen: string[] = [];
  for (const p of points) if (!seen.includes(p.seg)) seen.push(p.seg);
  const legend = seen
    .map((s) => `<span class="lgchip"><span class="stage-dot" style="background:${opts.segColors[s] ?? "#d1d1d6"}"></span>${esc(opts.segLabels[s] ?? s)}</span>`)
    .join("");
  const dataJson = escAttr(JSON.stringify(points.map((p) => ({ v: p.v, full: p.full }))));
  const tableRows = points.map((p) => `<tr><td>${esc(p.full)}</td><td>${fmt(p.v, decimals)}${unit ? " " + esc(unit) : ""}</td></tr>`).join("");
  return `<div class="chart" data-chart="${escAttr(opts.id)}" data-w="${CHART_W}" data-h="${H}" data-padl="${PAD_L}" data-padr="${PAD_R}" data-padt="${PAD_T}" data-padb="${PAD_B}" data-vmin="${dom.min}" data-vmax="${dom.max}" data-points='${dataJson}'>
<svg viewBox="0 0 ${CHART_W} ${H}" width="100%" role="img" aria-label="Heart rate by state, ${esc(unit)}">${yTitle}${ticks}${paths}${marker}${xLabels}</svg>
<div class="chart-guide" hidden></div><div class="chart-bubble" hidden></div>
<div class="chart-foot"><span class="chart-readout" aria-live="polite"></span><button type="button" class="chart-tbtn">Data table</button></div>
<div class="chart-table" hidden><table><thead><tr><th>Time</th><th>Value</th></tr></thead><tbody>${tableRows}</tbody></table></div>
<div class="chart-legend">${legend}</div>
</div>`;
}

/** Semicircle mini-gauge glyph for the Stress Impact day strip: track
 *  arc, value arc, needle, and the value under the hub. Null renders a
 *  hollow glyph labeled "no data" by the caller. */
export function miniGauge(value: number | null, color: string): string {
  const cx = 32;
  const cy = 32;
  const r = 25;
  const pt = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  const arc = (fromDeg: number, toDeg: number): string => {
    const [x1, y1] = pt(fromDeg);
    const [x2, y2] = pt(toDeg);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };
  const track = `<path d="${arc(180, 0)}" fill="none" stroke="#3a3a3c" stroke-width="6" stroke-linecap="round"/>`;
  if (value === null) {
    return `<svg class="minigauge" viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">${track}<circle cx="${cx}" cy="${cy}" r="3.5" fill="#636366"/></svg>`;
  }
  const v = Math.max(0, Math.min(100, value));
  const valArc = v > 0.5 ? `<path d="${arc(180, 180 - 1.8 * v)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>` : "";
  const [nx, ny] = (() => {
    const rad = ((180 - 1.8 * v) * Math.PI) / 180;
    return [cx + 17 * Math.cos(rad), cy - 17 * Math.sin(rad)];
  })();
  return `<svg class="minigauge" viewBox="0 0 64 40" width="64" height="40" role="img" aria-label="Gauge ${Math.round(v)} percent">${track}${valArc}<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#f2f2f7" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#f2f2f7"/></svg>`;
}
