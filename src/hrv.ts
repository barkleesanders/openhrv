/**
 * OpenHRV — pure TypeScript HRV engine.
 *
 * Implements the published mathematics in SPEC.md (Task Force 1996 time-domain
 * metrics, Baevsky stress index, FFT-based LF/HF) with the exact artifact
 * cleaning spec verified against the independent Python oracle in oracle/.
 * No I/O, no platform APIs — safe to unit test and reuse from any source
 * (manual entry, CSV, Web Bluetooth, camera PPG, Health import).
 */

export interface HrvResult {
  count: number;
  artifactsRemoved: number;
  meanRrMs: number;
  meanHrBpm: number;
  minRrMs: number;
  maxRrMs: number;
  minHrBpm: number;
  maxHrBpm: number;
  sdnnMs: number;
  rmssdMs: number;
  pnn50Pct: number;
  baevskySi: number;
  baevskyMoMs: number;
  baevskyAmoPct: number;
  baevskyMxdmnMs: number;
  lfMs2: number;
  hfMs2: number;
  lfHfRatio: number;
  totalPowerMs2: number;
}

const FS = 4; // tachogram resample rate (Hz)
const LF: [number, number] = [0.04, 0.15];
const HF: [number, number] = [0.15, 0.4];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Artifact cleaning, exactly as specified in SPEC.md and oracle/compute_oracle.py:
 * 1) drop RR outside [300, 2000] ms;
 * 2) sequential pass — drop a value deviating >20% from the median of the
 *    up-to-5 previously accepted values (needs >=3 accepted to judge).
 */
export function cleanRr(rrMs: number[]): { cleaned: number[]; removed: number } {
  const inRange = rrMs.filter((x) => Number.isFinite(x) && x >= 300 && x <= 2000);
  let removed = rrMs.length - inRange.length;
  const accepted: number[] = [];
  for (const x of inRange) {
    if (accepted.length >= 3) {
      const ref = median(accepted.slice(-5));
      if (Math.abs(x - ref) > 0.2 * ref) {
        removed++;
        continue;
      }
    }
    accepted.push(x);
  }
  return { cleaned: accepted, removed };
}

function fft(re: Float64Array, im: Float64Array): void {
  // Iterative radix-2 Cooley–Tukey, in place. Length must be a power of two.
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

function frequencyDomain(rr: number[]): { lf: number; hf: number; total: number } {
  const times: number[] = [];
  let t = 0;
  for (const x of rr) {
    t += x / 1000;
    times.push(t);
  }
  const duration = times[times.length - 1] - times[0];
  const n = Math.max(8, Math.floor(duration * FS));
  const samples = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ts = times[0] + i / FS;
    while (j < times.length - 2 && times[j + 1] < ts) j++;
    const t0 = times[j];
    const t1 = times[j + 1];
    const frac = t1 === t0 ? 0 : (ts - t0) / (t1 - t0);
    samples[i] = rr[j] + frac * (rr[j + 1] - rr[j]);
  }
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  let nfft = 1;
  while (nfft < n) nfft *= 2;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let wsum2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum2 += w * w;
    re[i] = (samples[i] - mean) * w;
  }
  fft(re, im);
  const df = FS / nfft;
  const band = (lo: number, hi: number): number => {
    let sum = 0;
    for (let k = 0; k <= nfft / 2; k++) {
      const f = (k * FS) / nfft;
      if (f >= lo && f < hi) sum += (re[k] * re[k] + im[k] * im[k]) / (FS * wsum2);
    }
    return sum * df;
  };
  return { lf: band(LF[0], LF[1]), hf: band(HF[0], HF[1]), total: band(0, 0.4) };
}

export function computeHrv(rrMs: number[]): HrvResult {
  const { cleaned, removed } = cleanRr(rrMs);
  if (cleaned.length < 10) {
    throw new Error(`need at least 10 clean RR intervals, got ${cleaned.length}`);
  }
  const n = cleaned.length;
  const meanRr = cleaned.reduce((a, b) => a + b, 0) / n;
  const diffs: number[] = [];
  for (let i = 0; i < n - 1; i++) diffs.push(cleaned[i + 1] - cleaned[i]);
  const rmssd = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / diffs.length);
  const variance = cleaned.reduce((a, x) => a + (x - meanRr) * (x - meanRr), 0) / (n - 1);
  const sdnn = Math.sqrt(variance);
  const nn50 = diffs.filter((d) => Math.abs(d) > 50).length;
  const minRr = Math.min(...cleaned);
  const maxRr = Math.max(...cleaned);

  // Baevsky stress index, 50 ms bins.
  const binW = 50;
  const lo = Math.floor(minRr / binW) * binW;
  const bins = new Map<number, number>();
  for (const x of cleaned) {
    const b = lo + Math.floor((x - lo) / binW) * binW;
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  let modalBin = lo;
  let modalCount = 0;
  for (const [b, c] of bins) {
    if (c > modalCount) {
      modalCount = c;
      modalBin = b;
    }
  }
  const moMs = modalBin + binW / 2;
  const amoPct = (100 * modalCount) / n;
  const mxdmnMs = maxRr - minRr;
  const si = mxdmnMs > 0 ? amoPct / (2 * (moMs / 1000) * (mxdmnMs / 1000)) : 0;

  const { lf, hf, total } = frequencyDomain(cleaned);
  return {
    count: n,
    artifactsRemoved: removed,
    meanRrMs: meanRr,
    meanHrBpm: 60000 / meanRr,
    minRrMs: minRr,
    maxRrMs: maxRr,
    minHrBpm: 60000 / maxRr,
    maxHrBpm: 60000 / minRr,
    sdnnMs: sdnn,
    rmssdMs: rmssd,
    pnn50Pct: (100 * nn50) / diffs.length,
    baevskySi: si,
    baevskyMoMs: moMs,
    baevskyAmoPct: amoPct,
    baevskyMxdmnMs: mxdmnMs,
    lfMs2: lf,
    hfMs2: hf,
    lfHfRatio: hf > 0 ? lf / hf : 0,
    totalPowerMs2: total,
  };
}

/** Parse RR intervals from pasted text / CSV content (ms, or seconds if values < 10). */
export function parseRrText(text: string): number[] {
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((x) => x > 0);
  if (nums.length && nums.every((x) => x < 10)) return nums.map((x) => x * 1000);
  return nums;
}
