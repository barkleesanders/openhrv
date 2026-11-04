#!/usr/bin/env python3
"""
OpenHRV oracle — independent reference computation.

This script is the FROZEN reference for the HRV engine. It is written in
pure-stdlib Python (no numpy) and uses a direct O(N^2) DFT, a completely
different code path from the TypeScript engine's radix-2 FFT, so the
Vitest oracle tests compare two independent implementations of the same
published mathematics:

  * Time-domain metrics per Task Force (1996) HRV standards:
    SDNN (sample std, ddof=1), RMSSD, pNN50.
  * Baevsky Stress Index: SI = AMo / (2 * Mo * MxDMn), 50 ms histogram
    bins; Mo = modal bin midpoint (s), AMo = modal bin share (%), MxDMn =
    (max-min) of cleaned RR (s).
  * Frequency domain: RR tachogram resampled at 4 Hz by linear
    interpolation over beat times, mean-detrended, Hann-windowed,
    zero-padded to the next power of two >= sample count; PSD(f) =
    |DFT(w*x)|^2 / (fs * sum(w^2)); band powers by rectangle integration
    over LF 0.04-0.15 Hz and HF 0.15-0.40 Hz.

Artifact cleaning (identical spec in SPEC.md and src/hrv.ts):
  1. Drop RR < 300 ms or > 2000 ms (physiologically impossible here).
  2. Sequential pass: keep a value if it is within 20% of the median of
     the up-to-5 previously ACCEPTED values (first values have no
     reference and are kept if in range); otherwise drop it.
Metrics are computed on the CLEANED series.

Run:  python3 oracle/compute_oracle.py
Writes oracle/vectors.json (vectors + expected values + tolerances).
"""
import json
import math
import random
import statistics
from pathlib import Path

FS = 4.0
LF = (0.04, 0.15)
HF = (0.15, 0.40)


def clean_rr(rr):
    in_range = [x for x in rr if 300.0 <= x <= 2000.0]
    removed_range = len(rr) - len(in_range)
    accepted = []
    removed_dev = 0
    for x in in_range:
        if len(accepted) >= 3:
            ref = statistics.median(accepted[-5:])
            if abs(x - ref) > 0.20 * ref:
                removed_dev += 1
                continue
        accepted.append(x)
    return accepted, removed_range + removed_dev


def time_domain(rr):
    n = len(rr)
    mean_rr = sum(rr) / n
    diffs = [rr[i + 1] - rr[i] for i in range(n - 1)]
    rmssd = math.sqrt(sum(d * d for d in diffs) / len(diffs))
    sdnn = statistics.stdev(rr)  # ddof=1
    nn50 = sum(1 for d in diffs if abs(d) > 50.0)
    pnn50 = 100.0 * nn50 / len(diffs)
    return {
        "count": n,
        "mean_rr_ms": mean_rr,
        "mean_hr_bpm": 60000.0 / mean_rr,
        "min_rr_ms": min(rr),
        "max_rr_ms": max(rr),
        "max_hr_bpm": 60000.0 / min(rr),
        "min_hr_bpm": 60000.0 / max(rr),
        "sdnn_ms": sdnn,
        "rmssd_ms": rmssd,
        "pnn50_pct": pnn50,
    }


def baevsky(rr):
    bin_w = 50.0
    lo = math.floor(min(rr) / bin_w) * bin_w
    bins = {}
    for x in rr:
        b = lo + math.floor((x - lo) / bin_w) * bin_w
        bins[b] = bins.get(b, 0) + 1
    modal_bin, modal_count = max(bins.items(), key=lambda kv: kv[1])
    mo_s = (modal_bin + bin_w / 2.0) / 1000.0
    amo_pct = 100.0 * modal_count / len(rr)
    mxdmn_s = (max(rr) - min(rr)) / 1000.0
    si = amo_pct / (2.0 * mo_s * mxdmn_s) if mxdmn_s > 0 else 0.0
    return {"baevsky_si": si, "baevsky_mo_ms": mo_s * 1000.0, "baevsky_amo_pct": amo_pct, "baevsky_mxdmn_ms": mxdmn_s * 1000.0}


def dft_psd(samples, fs):
    """Direct DFT PSD — deliberately NOT an FFT (independent code path)."""
    n = len(samples)
    nfft = 1
    while nfft < n:
        nfft *= 2
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    xw = [samples[i] * win[i] for i in range(n)]
    wsum2 = sum(w * w for w in win)
    freqs = []
    psd = []
    for k in range(nfft // 2 + 1):
        re = 0.0
        im = 0.0
        for t in range(n):
            ang = -2 * math.pi * k * t / nfft
            re += xw[t] * math.cos(ang)
            im += xw[t] * math.sin(ang)
        freqs.append(k * fs / nfft)
        psd.append((re * re + im * im) / (fs * wsum2))
    return freqs, psd, nfft


def frequency_domain(rr):
    # Beat times (s): value rr[i] is the interval ending at t_i.
    times = []
    t = 0.0
    for x in rr:
        t += x / 1000.0
        times.append(t)
    duration = times[-1] - times[0]
    n = int(duration * FS)
    samples = []
    j = 0
    for i in range(n):
        ts = times[0] + i / FS
        while j < len(times) - 2 and times[j + 1] < ts:
            j += 1
        t0, t1 = times[j], times[j + 1]
        v0, v1 = rr[j], rr[j + 1]
        frac = 0.0 if t1 == t0 else (ts - t0) / (t1 - t0)
        samples.append(v0 + frac * (v1 - v0))
    mean = sum(samples) / len(samples)
    samples = [s - mean for s in samples]
    freqs, psd, _ = dft_psd(samples, FS)
    df = freqs[1] - freqs[0]

    def band(lo, hi):
        return sum(p for f, p in zip(freqs, psd) if lo <= f < hi) * df

    lf = band(*LF)
    hf = band(*HF)
    return {
        "lf_ms2": lf,
        "hf_ms2": hf,
        "lf_hf_ratio": (lf / hf) if hf > 0 else 0.0,
        "total_power_ms2": band(0.0, 0.40),
    }


def metrics(rr_raw):
    cleaned, removed = clean_rr(rr_raw)
    out = {"artifacts_removed": removed}
    out.update(time_domain(cleaned))
    out.update(baevsky(cleaned))
    out.update(frequency_domain(cleaned))
    return out


def gen_vectors():
    v1 = []
    for i in range(300):
        v1.append(round(860.0 + 50.0 * math.sin(2 * math.pi * i / 24.0) + 12.0 * math.sin(2 * math.pi * i / 7.0 + 1.3), 1))
    rng = random.Random(42)
    v2 = []
    for i in range(240):
        base = 720.0 + (940.0 - 720.0) * i / 239.0
        v2.append(round(base + rng.gauss(0, 38), 1))
    rng3 = random.Random(7)
    v3 = [round(800.0 + rng3.gauss(0, 55), 1) for _ in range(260)]
    for idx, val in [(17, 380.0), (63, 1650.0), (101, 250.0), (140, 1950.0), (205, 420.0), (233, 1500.0)]:
        v3[idx] = val
    return [
        {"name": "v1_steady_rsa", "description": "300 beats, resting ~860 ms RR with respiratory sinus arrhythmia (sinusoidal modulation). No artifacts.", "rr_ms": v1},
        {"name": "v2_recovery_drift", "description": "240 beats, post-exercise recovery: mean RR drifts 720->940 ms, gaussian jitter sd 38 ms (seed 42). No artifacts.", "rr_ms": v2},
        {"name": "v3_ectopic_artifacts", "description": "260 beats, ~800 ms RR sd 55 ms (seed 7) with 6 injected artifacts (250-1950 ms). Cleaning must remove exactly those 6; metrics are post-cleaning.", "rr_ms": v3},
    ]


def main():
    vectors = gen_vectors()
    for v in vectors:
        v["expected"] = metrics(v["rr_ms"])
    doc = {
        "generated_by": "oracle/compute_oracle.py (pure-stdlib Python, direct DFT — independent of the TypeScript FFT engine)",
        "tolerances": {
            "time_domain_rel": 0.005,
            "baevsky_rel": 0.01,
            "band_power_rel": 0.08,
            "lf_hf_rel": 0.10,
        },
        "vectors": vectors,
    }
    out = Path(__file__).with_name("vectors.json")
    out.write_text(json.dumps(doc, indent=1))
    for v in vectors:
        e = v["expected"]
        print(f"{v['name']}: n={e['count']} removed={e['artifacts_removed']} RMSSD={e['rmssd_ms']:.2f} SDNN={e['sdnn_ms']:.2f} pNN50={e['pnn50_pct']:.2f} LF/HF={e['lf_hf_ratio']:.3f} SI={e['baevsky_si']:.1f}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
