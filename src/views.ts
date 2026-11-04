/** OpenHRV — server-rendered PWA views (original design, app-structure layout). */

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0b3d2e"/><path d="M8 52 H30 L38 30 L50 72 L60 45 H92" fill="none" stroke="#4ade80" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NAV = [
  { href: "/", key: "today", label: "Today", icon: "◉" },
  { href: "/measure", key: "measure", label: "Measure", icon: "♥" },
  { href: "/journal", key: "journal", label: "Journal", icon: "✎" },
  { href: "/mydata", key: "mydata", label: "My Data", icon: "▦" },
  { href: "/more", key: "more", label: "More", icon: "•••" },
];

export function layout(active: string, title: string, body: string, sha = ""): string {
  const nav = NAV.map(
    (n) =>
      `<a href="${n.href}" class="${n.key === active ? "on" : ""}"><span class="ni">${n.icon}</span>${n.label}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · OpenHRV</title>
<meta name="description" content="OpenHRV — open-source HRV, readiness and stress tracking. Clean-room, single-user, your data in your own Cloudflare account.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0b3d2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<style>
:root{--bg:#071a13;--card:#0d2b20;--line:#1d4a38;--txt:#e7f5ee;--dim:#9dbfae;--acc:#4ade80;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--txt);padding-bottom:84px}
header{padding:18px 18px 6px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:18px 0 8px}.sub{color:var(--dim);font-size:13px}
main{padding:6px 14px 14px;max-width:760px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:10px 0}
.row{display:flex;gap:10px}.row>.card{flex:1}
.gauge{font-size:34px;font-weight:700}.glabel{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.stat{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}.stat:last-child{border-bottom:none}
.stat b{font-variant-numeric:tabular-nums}
nav{position:fixed;left:0;right:0;bottom:0;background:#09231a;border-top:1px solid var(--line);display:flex;z-index:10}
nav a{flex:1;text-align:center;color:var(--dim);text-decoration:none;font-size:11px;padding:8px 0 12px}
nav a.on{color:var(--acc)}nav .ni{display:block;font-size:18px;line-height:1.2}
button{background:var(--acc);color:#052e1b;border:none;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--acc);border:1px solid var(--line)}
textarea,input,select{width:100%;background:#081f16;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px;margin:6px 0}
canvas{width:100%;height:120px}
.tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dim);margin:2px}
footer{color:var(--dim);font-size:11px;text-align:center;padding:10px}
.msg{font-size:13px;color:var(--dim);min-height:18px}
.err{color:var(--bad)}
</style></head>
<body>
<header><h1>${title}</h1></header>
<main>${body}</main>
<footer>OpenHRV · open-source clean-room build${sha ? ` · build ${sha.slice(0, 7)}` : ""} · not affiliated with Welltory</footer>
<nav>${nav}</nav>
<script>
try { var th = JSON.parse(localStorage.getItem("openhrv-theme") || "null"); if (th && th.acc) { document.documentElement.style.setProperty("--acc", th.acc); document.documentElement.style.setProperty("--card", th.card); document.documentElement.style.setProperty("--bg", th.bg); } } catch (e) {}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function(){});
if (navigator.modelContext && navigator.modelContext.registerTool) {
  var tools = [
    { name: "openhrv_get_today", description: "Get today's Battery (readiness) and Pressure (stress) scores and latest HRV metrics.", inputSchema: { type: "object", properties: {} },
      execute: function() { return fetch("/api/today").then(function(r){return r.json();}); } },
    { name: "openhrv_list_measurements", description: "List recent HRV measurements.", inputSchema: { type: "object", properties: {} },
      execute: function() { return fetch("/api/measurements?limit=10").then(function(r){return r.json();}); } }
  ];
  tools.forEach(function(t){ try { navigator.modelContext.registerTool(t); } catch(e) {} });
  fetch("/api/webmcp/beacon", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ event: "webmcp_tools_registered", count: tools.length }) }).catch(function(){});
}
</script>
</body></html>`;
}

export interface TodayData {
  battery: number | null;
  stress: number | null;
  pressure: number | null;
  latest: Record<string, number | string> | null;
  history: Array<Record<string, number | string>>;
  insights?: Array<{ severity: string; text: string }>;
  showWelcome?: boolean;
  /** Which input drives today's gauges: a real RR measurement, or the
   *  imported Apple Health daily aggregates. */
  scoreSource?: "measurement" | "health" | null;
  scoreAt?: string | null;
  healthLatest?: {
    date: string;
    sdnnMs: number;
    restingHrBpm: number | null;
    sleepHours: number | null;
    source: string;
  } | null;
}

export function todayPage(d: TodayData, sha = ""): string {
  const score = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
  const latest = d.latest
    ? `<div class="card"><h2>Latest measurement</h2>
       <div class="stat"><span>Heart rate</span><b>${Number(d.latest.mean_hr_bpm).toFixed(0)} bpm</b></div>
       <div class="stat"><span>RMSSD</span><b>${Number(d.latest.rmssd_ms).toFixed(1)} ms</b></div>
       <div class="stat"><span>SDNN</span><b>${Number(d.latest.sdnn_ms).toFixed(1)} ms</b></div>
       <div class="stat"><span>pNN50</span><b>${Number(d.latest.pnn50_pct).toFixed(1)} %</b></div>
       <div class="stat"><span>Stress index (Baevsky)</span><b>${Number(d.latest.baevsky_si).toFixed(0)}</b></div>
       <div class="stat"><span>LF / HF</span><b>${Number(d.latest.lf_hf_ratio).toFixed(2)}</b></div>
       <div class="stat"><span>Source</span><b>${String(d.latest.source)}</b></div>
       <p><button class="ghost" id="shareLatest">Share this summary</button></p></div>
<script>
document.getElementById("shareLatest").addEventListener("click", function() {
  var text = "OpenHRV — HR ${Number(d.latest.mean_hr_bpm).toFixed(0)} bpm · RMSSD ${Number(d.latest.rmssd_ms).toFixed(1)} ms · SDNN ${Number(d.latest.sdnn_ms).toFixed(1)} ms · stress index ${Number(d.latest.baevsky_si).toFixed(0)}";
  if (navigator.share) navigator.share({ title: "OpenHRV measurement", text: text }).catch(function(){});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ document.getElementById("shareLatest").textContent = "Copied to clipboard"; });
});
</script>`
    : d.healthLatest
      ? `<div class="card"><h2>Latest from Apple Health</h2>
       <div class="stat"><span>HRV (SDNN) · ${d.healthLatest.date}</span><b>${d.healthLatest.sdnnMs.toFixed(1)} ms</b></div>
       ${d.healthLatest.restingHrBpm !== null ? `<div class="stat"><span>Resting heart rate</span><b>${d.healthLatest.restingHrBpm.toFixed(0)} bpm</b></div>` : ""}
       ${d.healthLatest.sleepHours !== null ? `<div class="stat"><span>Last night's sleep</span><b>${d.healthLatest.sleepHours.toFixed(1)} h</b></div>` : ""}
       <div class="stat"><span>Source</span><b>${String(d.healthLatest.source).replace(/</g, "&lt;")}</b></div>
       <p class="sub">Today's gauges are computed from your imported daily Health aggregates. An in-app measurement adds beat-to-beat RMSSD, stress index and LF/HF detail.</p>
       <p><a href="/measure"><button>Measure now</button></a></p></div>`
      : `<div class="card"><h2>No measurements yet</h2><p class="sub">Take your first HRV measurement to light up this dashboard.</p><p><a href="/measure"><button>Measure now</button></a></p></div>`;
  const sourceNote =
    d.scoreSource === "health"
      ? `<p class="sub" style="text-align:center">Gauges from Apple Health daily data · ${d.scoreAt ?? ""}</p>`
      : "";
  const insights = d.insights && d.insights.length
    ? `<div class="card"><h2>Insights</h2>${d.insights.map((i) => `<div class="stat"><span style="max-width:85%">${i.text.replace(/</g, "&lt;")}</span><b>${i.severity === "warn" ? "⚠" : i.severity === "good" ? "✓" : "ℹ"}</b></div>`).join("")}<p class="sub">Computed from your stored data only — see <a href="/lab" style="color:var(--acc)">Science Lab</a> for the correlations behind them.</p></div>`
    : "";
  const welcome = d.showWelcome
    ? `<div class="card"><h2>Welcome to OpenHRV</h2><p class="sub">New here? The 2-minute setup tour explains data sources, permissions and notifications.</p><p><a href="/welcome"><button>Start the tour</button></a></p></div>`
    : "";
  const hist = d.history.length
    ? `<div class="card"><h2>Recent</h2>${d.history
        .map(
          (m) =>
            `<div class="stat"><span>${String(m.taken_at).slice(0, 16).replace("T", " ")} · ${String(m.source)}</span><b>RMSSD ${Number(m.rmssd_ms).toFixed(0)} ms</b></div>`,
        )
        .join("")}</div>`
    : "";
  return layout(
    "today",
    "Today",
    `${welcome}<div class="row">
       <a href="/battery" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Battery · charge</div><div class="gauge" style="color:var(--acc)">${score(d.battery)}${d.battery === null ? "" : "<span style='font-size:16px'>%</span>"}</div><div class="sub">how charged you are · tap for detail</div></div></a>
       <a href="/stress" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Stress</div><div class="gauge" style="color:var(--bad)">${score(d.stress)}${d.stress === null ? "" : "<span style='font-size:16px'>%</span>"}</div><div class="sub">from stress index + HRV · tap for detail</div></div></a>
     </div>
     <div class="row">
       <a href="/pressure" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Pressure · load</div><div class="gauge" style="color:var(--warn)">${score(d.pressure)}</div><div class="sub">load estimate from stress index + LF/HF · tap for detail</div></div></a>
       <a href="/impact" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Factor impact</div><div class="gauge" style="font-size:20px;padding-top:10px">What moves you →</div><div class="sub">measured impact of tags, sleep &amp; habits</div></div></a>
     </div>${sourceNote}${insights}${latest}${hist}`,
    sha,
  );
}

export function measurePage(sha = ""): string {
  return layout(
    "measure",
    "Measure",
    `<div class="card"><h2>Paste RR intervals</h2>
     <p class="sub">One value per line or comma-separated, in milliseconds (seconds are auto-detected). Or import a CSV/text file below.</p>
     <textarea id="rr" rows="6" placeholder="812, 795, 834, ..."></textarea>
     <input type="file" id="file" accept=".csv,.txt">
     <label class="sub">Source label <input id="src" value="manual" style="width:auto"></label>
     <p><button id="go">Compute &amp; save</button></p>
     <p class="msg" id="msg"></p>
     <div id="result"></div>
     <canvas id="chart" width="700" height="120"></canvas></div>
     <div class="card"><h2>Bluetooth heart-rate monitor</h2>
     <p class="sub">Web Bluetooth (Chrome/Edge, secure context). Connect a BLE chest strap broadcasting the Heart Rate service; RR intervals stream in live.</p>
     <p><button class="ghost" id="ble">Connect chest strap</button></p><p class="msg" id="blemsg"></p></div>
     <div class="card"><h2>Camera measurement</h2>
     <p class="sub">Place a fingertip over the rear camera + light. OpenHRV samples brightness changes (PPG) and estimates beats. Accuracy varies by device — treat as experimental.</p>
     <p><button class="ghost" id="cam">Start camera measurement</button></p>
     <video id="vid" playsinline style="width:100%;display:none;border-radius:12px"></video>
     <p class="msg" id="cammsg"></p></div>
<script>
var rrFromBle = [];
function showResult(r) {
  document.getElementById("result").innerHTML =
    "<div class='stat'><span>Mean HR</span><b>" + r.meanHrBpm.toFixed(0) + " bpm</b></div>" +
    "<div class='stat'><span>RMSSD</span><b>" + r.rmssdMs.toFixed(1) + " ms</b></div>" +
    "<div class='stat'><span>SDNN</span><b>" + r.sdnnMs.toFixed(1) + " ms</b></div>" +
    "<div class='stat'><span>pNN50</span><b>" + r.pnn50Pct.toFixed(1) + " %</b></div>" +
    "<div class='stat'><span>Stress index</span><b>" + r.baevskySi.toFixed(0) + "</b></div>" +
    "<div class='stat'><span>LF/HF</span><b>" + r.lfHfRatio.toFixed(2) + "</b></div>" +
    "<div class='stat'><span>Beats used</span><b>" + r.count + " (" + r.artifactsRemoved + " artifacts removed)</b></div>";
}
function drawChart(rr) {
  var c = document.getElementById("chart"), x = c.getContext("2d");
  x.clearRect(0,0,c.width,c.height); if (!rr.length) return;
  var mn = Math.min.apply(null, rr), mx = Math.max.apply(null, rr);
  x.strokeStyle = "#4ade80"; x.beginPath();
  rr.forEach(function(v, i) { var px = i / (rr.length - 1) * c.width, py = c.height - (v - mn) / (mx - mn || 1) * (c.height - 8) - 4; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke();
}
function submitRr(rr, source) {
  fetch("/api/measurements", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ rr_ms: rr, source: source }) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (!j.ok) throw new Error(j.error || "failed"); document.getElementById("msg").textContent = "Saved measurement #" + j.id; showResult(j.metrics); drawChart(rr); })
    .catch(function(e){ document.getElementById("msg").innerHTML = "<span class='err'>" + e.message + "</span>"; });
}
document.getElementById("file").addEventListener("change", function(ev) {
  var f = ev.target.files[0]; if (!f) return;
  f.text().then(function(t){ document.getElementById("rr").value = t.slice(0, 200000); });
});
document.getElementById("go").addEventListener("click", function() {
  var nums = (document.getElementById("rr").value.match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number).filter(function(x){return x > 0;});
  if (nums.length && nums.every(function(x){return x < 10;})) nums = nums.map(function(x){return x * 1000;});
  if (nums.length < 10) { document.getElementById("msg").innerHTML = "<span class='err'>Need at least 10 RR intervals.</span>"; return; }
  submitRr(nums, document.getElementById("src").value || "manual");
});
document.getElementById("ble").addEventListener("click", function() {
  var m = document.getElementById("blemsg");
  if (!navigator.bluetooth) { m.innerHTML = "<span class='err'>Web Bluetooth is not available in this browser. Use Chrome/Edge over HTTPS, or paste/import RR data instead.</span>"; return; }
  navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] })
    .then(function(d){ return d.gatt.connect(); })
    .then(function(s){ return s.getPrimaryService("heart_rate"); })
    .then(function(sv){ return sv.getCharacteristic("heart_rate_measurement"); })
    .then(function(ch) {
      m.textContent = "Connected — collecting beats. Press again after ~60 beats to save.";
      document.getElementById("ble").textContent = "Save collected beats";
      ch.addEventListener("characteristicvaluechanged", function(ev) {
        var v = ev.target.value, flags = v.getUint8(0), off = 1;
        if (flags & 1) off += 2; else off += 1;
        if (flags & 8) off += 2;
        if (flags & 16) { var n = (v.byteLength - off) / 2; for (var i = 0; i < n; i++) rrFromBle.push(v.getUint16(off + i * 2, true) * 1000 / 1024); }
        m.textContent = "Collecting… " + rrFromBle.length + " RR intervals";
      });
      return ch.startNotifications();
    })
    .catch(function(e){ m.innerHTML = "<span class='err'>" + e.message + "</span>"; });
  document.getElementById("ble").onclick = function(){ if (rrFromBle.length >= 10) submitRr(rrFromBle.slice(), "bluetooth"); };
});
document.getElementById("cam").addEventListener("click", function() {
  var m = document.getElementById("cammsg"), vid = document.getElementById("vid");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { m.innerHTML = "<span class='err'>Camera API not available in this browser. Use manual/BLE/import instead.</span>"; return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
    .then(function(stream) {
      vid.srcObject = stream; vid.style.display = "block"; vid.play();
      m.textContent = "Measuring 30 s — keep your fingertip steady over the camera…";
      var cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
      var cx = cv.getContext("2d", { willReadFrequently: true }), samples = [], t0 = performance.now();
      var iv = setInterval(function() {
        cx.drawImage(vid, 0, 0, 64, 64);
        var px = cx.getImageData(0, 0, 64, 64).data, sum = 0;
        for (var i = 0; i < px.length; i += 16) sum += px[i];
        samples.push({ t: performance.now(), v: sum });
        if (performance.now() - t0 > 30000) {
          clearInterval(iv); stream.getTracks().forEach(function(tr){ tr.stop(); }); vid.style.display = "none";
          var vals = samples.map(function(s){ return s.v; }), mean = vals.reduce(function(a,b){return a+b;},0) / vals.length;
          var beats = [];
          for (var k = 1; k < samples.length - 1; k++) if (vals[k] > mean && vals[k] >= vals[k-1] && vals[k] > vals[k+1] && (!beats.length || samples[k].t - beats[beats.length-1] > 350)) beats.push(samples[k].t);
          var rr = []; for (var b = 1; b < beats.length; b++) rr.push(beats[b] - beats[b-1]);
          if (rr.length >= 10) { m.textContent = "Detected " + rr.length + " beats — saving."; submitRr(rr, "camera"); }
          else m.innerHTML = "<span class='err'>Could not detect a steady pulse (" + rr.length + " beats). Try again with the flash covered fully, or use another source.</span>";
        }
      }, 40);
    })
    .catch(function(e){ m.innerHTML = "<span class='err'>Camera unavailable: " + e.message + "</span>"; });
});
</script>`,
    sha,
  );
}

export function journalPage(sha = ""): string {
  return layout(
    "journal",
    "Journal",
    `<div class="card"><h2>New entry</h2>
     <textarea id="body" rows="3" placeholder="How do you feel? What happened today?"></textarea>
     <input id="tags" placeholder="tags, comma separated (e.g. coffee, poor-sleep)">
     <p><button id="add">Add entry</button></p><p class="msg" id="msg"></p></div>
     <div class="card"><h2>Voice comment</h2>
     <p class="sub">Record a spoken note instead of typing — it is stored in your own Cloudflare storage and attached to your next journal entry. Transcription runs on Workers AI inside your account when available.</p>
     <p><button class="ghost" id="vrec">● Record</button> <button class="ghost" id="vstop" disabled>Stop</button></p>
     <audio id="vprev" controls style="width:100%;display:none"></audio>
     <p class="msg" id="vmsg"></p><div id="vtranscript"></div></div>
     <div class="card"><h2>Entries</h2><div id="list"><p class="sub">Loading…</p></div></div>
<script>
var pendingVoiceId = null;
function load() {
  fetch("/api/journal").then(function(r){return r.json();}).then(function(j) {
    document.getElementById("list").innerHTML = j.entries.length ? j.entries.map(function(e) {
      var audio = e.voice_note_id ? "<audio controls preload='none' style='width:100%' src='/api/voice/" + e.voice_note_id + "/audio'></audio>" : "";
      return "<div class='stat'><span>" + String(e.created_at).slice(0,16).replace("T"," ") + "</span><b>" + e.mood + "/10</b></div><p style='margin:4px 0'>" + e.body.replace(/</g,"&lt;") + "</p>" + audio + (e.tags || []).map(function(t){return "<span class='tag'>" + t + "</span>";}).join("");
    }).join("") : "<p class='sub'>No entries yet.</p>";
  });
}
document.getElementById("add").addEventListener("click", function() {
  var tags = document.getElementById("tags").value.split(",").map(function(s){return s.trim();}).filter(Boolean);
  fetch("/api/journal", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ body: document.getElementById("body").value, mood: 5, tags: tags, voice_note_id: pendingVoiceId }) })
    .then(function(r){return r.json();}).then(function(j){ document.getElementById("msg").textContent = j.ok ? "Saved." : (j.error || "failed"); pendingVoiceId = null; load(); });
});
var mediaRec = null, chunks = [], recStarted = 0;
document.getElementById("vrec").addEventListener("click", function() {
  var m = document.getElementById("vmsg");
  if (!navigator.mediaDevices || !window.MediaRecorder) { m.innerHTML = "<span class='err'>Audio recording is not available in this browser.</span>"; return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    chunks = []; recStarted = Date.now();
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = function(ev){ if (ev.data.size) chunks.push(ev.data); };
    mediaRec.onstop = function() {
      stream.getTracks().forEach(function(t){ t.stop(); });
      var blob = new Blob(chunks, { type: mediaRec.mimeType || "audio/webm" });
      var prev = document.getElementById("vprev"); prev.src = URL.createObjectURL(blob); prev.style.display = "block";
      m.textContent = "Uploading…";
      var fd = new FormData(); fd.append("file", blob, "voice" + (blob.type.includes("mp4") ? ".m4a" : ".webm")); fd.append("duration_s", String(Math.round((Date.now() - recStarted) / 1000)));
      fetch("/api/voice", { method: "POST", body: fd }).then(function(r){return r.json();}).then(function(j) {
        if (!j.ok) { m.innerHTML = "<span class='err'>" + (j.error || "upload failed") + "</span>"; return; }
        pendingVoiceId = j.id;
        m.textContent = "Voice note saved — it will attach to your next journal entry.";
        if (j.transcript) document.getElementById("vtranscript").innerHTML = "<p class='sub'>Transcript: " + String(j.transcript).replace(/</g,"&lt;") + "</p>";
      }).catch(function(e){ m.innerHTML = "<span class='err'>" + e.message + "</span>"; });
    };
    mediaRec.start();
    document.getElementById("vrec").disabled = true; document.getElementById("vstop").disabled = false;
    m.textContent = "Recording… speak now, then press Stop.";
  }).catch(function(e){ m.innerHTML = "<span class='err'>Microphone unavailable: " + e.message + "</span>"; });
});
document.getElementById("vstop").addEventListener("click", function() {
  if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop();
  document.getElementById("vrec").disabled = false; document.getElementById("vstop").disabled = true;
});
load();
</script>`,
    sha,
  );
}

export function myDataPage(sha = ""): string {
  return layout(
    "mydata",
    "My Data",
    `<div class="card"><h2>Categories</h2>
     <div class="stat"><span>Measurements (HRV)</span><b id="c-measurements">…</b></div>
     <div class="stat"><span>Sleep records</span><b id="c-sleep">…</b></div>
     <div class="stat"><span>Journal entries</span><b id="c-journal">…</b></div>
     <div class="stat"><span>Breathing sessions</span><b id="c-breathing">…</b></div>
     <div class="stat"><span>Self tests</span><b id="c-tests">…</b></div></div>
     <div class="card"><h2>Category details</h2><div id="cats"><p class="sub">Loading…</p></div></div>
     <div class="card"><h2>Measurement history</h2><canvas id="chart" width="700" height="140"></canvas><div id="hist"></div></div>
     <div class="card"><h2>Import Apple Health</h2><p class="sub">Automated: Health Auto Export app → REST import. Also: iOS Shortcuts POST and export.xml upload — all set up in More → Settings &amp; connections, where your import token lives.</p><p><a href="/more#settings"><button class="ghost">Open import settings</button></a></p></div>
     <div class="card"><h2>Imported samples</h2><div id="samples"><p class="sub">Loading…</p></div></div>
<script>
fetch("/api/mydata/categories").then(function(r){return r.json();}).then(function(j) {
  document.getElementById("cats").innerHTML = j.categories.map(function(cat) {
    var lat = cat.metrics.filter(function(m){ return m.latest; }).map(function(m){ return m.label + " " + Number(m.latest.value).toFixed(1) + " " + m.latest.unit; }).join(" · ");
    return "<div class='stat'><span><a href='/mydata/" + cat.key + "' style='color:var(--acc);text-decoration:none'>" + cat.title + "</a><br><span class='sub'>" + (lat || "no samples yet") + "</span></span><b>" + cat.sampleCount + "</b></div>";
  }).join("");
});
function shareText(text, btn) {
  if (navigator.share) navigator.share({ title: "OpenHRV", text: text }).catch(function(){});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ btn.textContent = "Copied"; });
}
fetch("/api/mydata").then(function(r){return r.json();}).then(function(j) {
  ["measurements","sleep","journal","breathing","tests"].forEach(function(k){ document.getElementById("c-" + k).textContent = j.counts[k]; });
  fetch("/api/samples?limit=12").then(function(r){return r.json();}).then(function(s) {
    document.getElementById("samples").innerHTML = s.samples.length ? s.samples.map(function(x) {
      return "<div class='stat'><span>" + String(x.start_at).slice(0,16).replace("T"," ") + " · " + x.type + "</span><b>" + (x.value === null ? "" : Number(x.value).toFixed(1) + " " + x.unit) + " · " + x.source + "</b></div>";
    }).join("") : "<p class='sub'>No imported samples yet.</p>";
  });
  var ms = j.measurements.slice().reverse();
  document.getElementById("hist").innerHTML = j.measurements.map(function(m, i){ return "<div class='stat'><span>" + String(m.taken_at).slice(0,16).replace("T"," ") + " · " + m.source + "</span><b>" + Number(m.mean_hr_bpm).toFixed(0) + " bpm · RMSSD " + Number(m.rmssd_ms).toFixed(0) + "</b> <button class='ghost sharebtn' style='padding:2px 8px' data-i='" + i + "'>Share</button></div>"; }).join("") || "<p class='sub'>Nothing yet.</p>";
  document.querySelectorAll(".sharebtn").forEach(function(b){ b.addEventListener("click", function(){ var m = j.measurements[Number(b.getAttribute("data-i"))]; shareText("OpenHRV " + String(m.taken_at).slice(0,10) + " — HR " + Number(m.mean_hr_bpm).toFixed(0) + " bpm · RMSSD " + Number(m.rmssd_ms).toFixed(1) + " ms · SDNN " + Number(m.sdnn_ms).toFixed(1) + " ms", b); }); });
  var c = document.getElementById("chart"), x = c.getContext("2d");
  if (ms.length > 1) { var vs = ms.map(function(m){return m.rmssd_ms;}), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    x.strokeStyle = "#4ade80"; x.beginPath();
    vs.forEach(function(v, i){ var px = i / (vs.length - 1) * c.width, py = c.height - (v - mn) / (mx - mn || 1) * (c.height - 10) - 5; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); }
});
</script>`,
    sha,
  );
}

export function morePage(sha = ""): string {
  return layout(
    "more",
    "More",
    `<div class="card"><h2>Breathing</h2><p class="sub">Guided box breathing — inhale 4 s, hold 4 s, exhale 4 s, hold 4 s.</p>
     <div class="gauge" id="phase" style="font-size:22px">Ready</div><p><button id="bstart">Start 2-minute session</button></p><p class="msg" id="bmsg"></p></div>
     <div class="card"><h2>Explore</h2>
     <div class="stat"><span><a href="/sleep" style="color:var(--acc);text-decoration:none">Sleep</a></span><b>nights, stages, debt</b></div>
     <div class="stat"><span><a href="/tests" style="color:var(--acc);text-decoration:none">Self-tests</a></span><b>Self-Discovery set</b></div>
     <div class="stat"><span><a href="/lab" style="color:var(--acc);text-decoration:none">Science Lab</a></span><b>correlations</b></div>
     <div class="stat"><span><a href="/coach" style="color:var(--acc);text-decoration:none">AI Coach</a></span><b>your data only</b></div>
     <div class="stat"><span><a href="/stories" style="color:var(--acc);text-decoration:none">Stories</a></span><b>HRV science, briefly</b></div>
     <div class="stat"><span><a href="/themes" style="color:var(--acc);text-decoration:none">Themes</a></span><b>face gallery</b></div>
     <div class="stat"><span><a href="/welcome" style="color:var(--acc);text-decoration:none">Setup tour</a></span><b>sources &amp; permissions</b></div>
     <div class="stat"><span><a href="/about" style="color:var(--acc);text-decoration:none">About &amp; feedback</a></span><b>what this is</b></div></div>
     <div class="card"><h2>Notifications</h2>
     <p class="sub">Web Push to this installed PWA. On iPhone: open OpenHRV in Safari while signed in, Share → Add to Home Screen, open it from the home screen, then tap Enable. iOS asks for notification permission inside the installed app.</p>
     <p><button class="ghost" id="push">Enable notifications</button> <button class="ghost" id="pushtest">Send test notification</button></p>
     <p class="msg" id="pmsg"></p>
     <div id="notifprefs"><p class="sub">Loading preferences…</p></div>
     <div id="notiflog"></div></div>
     <div class="card"><h2>About</h2><p class="sub">OpenHRV is an open-source, clean-room reimplementation built from a feature specification — original code and text, no trackers, data stored only in this Cloudflare account. Single-user instance locked to its owner via Cloudflare Access. <a href="/about" style="color:var(--acc)">Details &amp; feedback →</a></p></div>
     <div class="card" id="settings"><h2>Settings &amp; connections</h2>
     <h2 style="margin-top:10px">Apple Health import token</h2>
     <p class="sub">Use this token in the Health Auto Export app (REST API) and in iOS Shortcuts. It is the only credential those phone-side automations need.</p>
     <input id="token" readonly value="loading…">
     <p><button class="ghost" id="copytok">Copy token</button> <button class="ghost" id="regen">Regenerate</button></p>
     <p class="sub" id="urls"></p>
     <h2>Strava</h2>
     <p class="sub" id="stravastate">Checking…</p>
     <p><a href="/connect/strava"><button class="ghost">Connect Strava</button></a> <button class="ghost" id="stravasync">Sync activities</button></p>
     <h2>Import Apple Health export</h2>
     <p class="sub">Upload an Apple Health export.xml (large files are parsed up to 5,000 records per upload).</p>
     <input type="file" id="xmlfile" accept=".xml">
     <p><button class="ghost" id="xmlgo">Upload export.xml</button></p><p class="msg" id="xmlmsg"></p>
     <h2>Feature flags</h2>
     <p class="sub">This single-user build replaces subscriptions with owner-controlled flags — everything is yours; turn surfaces off if you don't use them.</p>
     <div id="flags"><p class="sub">Loading…</p></div>
     <h2>Your data</h2>
     <p><a href="/api/export/data.json"><button class="ghost">Download JSON export</button></a> <a href="/api/export/data.csv"><button class="ghost">Download measurements CSV</button></a></p>
     <h2>Delete my data</h2>
     <p class="sub">Permanently deletes every measurement, sample, journal entry, sleep record, voice note, push subscription and setting in this instance. This cannot be undone — export first.</p>
     <p><button class="ghost" id="deldata" style="color:var(--bad);border-color:var(--bad)">Delete all my data</button></p><p class="msg" id="delmsg"></p>
     <p class="sub">Write-back to Apple Health: Settings on your phone → the OpenHRV Write-Back Shortcut reads /api/export/health-writeback with this token and logs samples into Health. Automatic native write-back arrives with the Watch companion (D7).</p></div>
<script>
fetch("/api/settings/import-token").then(function(r){return r.json();}).then(function(j) {
  document.getElementById("token").value = j.token;
  document.getElementById("urls").innerHTML = "Health Auto Export URL: " + j.health_auto_export_url + "<br>Shortcut URL: " + j.shortcut_url + "<br>Write-back feed: " + j.writeback_url;
});
document.getElementById("copytok").addEventListener("click", function() {
  var t = document.getElementById("token"); t.select(); navigator.clipboard && navigator.clipboard.writeText(t.value);
});
document.getElementById("regen").addEventListener("click", function() {
  fetch("/api/settings/import-token/regenerate", { method: "POST" }).then(function(r){return r.json();}).then(function(j){ document.getElementById("token").value = j.token; });
});
fetch("/connect/strava/status").then(function(r){return r.json();}).then(function(j) {
  document.getElementById("stravastate").textContent = j.connected ? "Connected (athlete " + j.athlete_id + ")." : j.state;
});
document.getElementById("stravasync").addEventListener("click", function() {
  fetch("/connect/strava/sync", { method: "POST" }).then(function(r){return r.json();}).then(function(j) {
    document.getElementById("stravastate").textContent = j.ok ? "Synced: " + j.fetched + " activities, " + j.inserted + " new." : (j.error || "sync failed");
  });
});
document.getElementById("xmlgo").addEventListener("click", function() {
  var f = document.getElementById("xmlfile").files[0], m = document.getElementById("xmlmsg");
  if (!f) { m.textContent = "Choose a file first."; return; }
  var fd = new FormData(); fd.append("file", f);
  m.textContent = "Uploading & parsing…";
  fetch("/api/import/export-xml", { method: "POST", body: fd }).then(function(r){return r.json();}).then(function(j) {
    m.textContent = j.ok ? "Parsed " + j.parsed + " records, " + j.inserted + " new samples stored." : (j.error || "upload failed");
  });
});
</script>
<script>
var phases = ["Inhale", "Hold", "Exhale", "Hold"], timer = null;
document.getElementById("bstart").addEventListener("click", function() {
  var el = document.getElementById("phase"), i = 0, started = Date.now();
  if (timer) { clearInterval(timer); timer = null; el.textContent = "Ready"; return; }
  el.textContent = phases[0];
  timer = setInterval(function() {
    i = (i + 1) % 4; el.textContent = phases[i];
    if (Date.now() - started > 120000) { clearInterval(timer); timer = null; el.textContent = "Done";
      fetch("/api/breathing", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ pattern: "box-4-4-4-4", duration_s: 120 }) });
      document.getElementById("bmsg").textContent = "Session logged."; }
  }, 4000);
});
function urlB64ToUint8(b64) {
  var pad = "=".repeat((4 - (b64.length % 4)) % 4);
  var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
document.getElementById("push").addEventListener("click", function() {
  var m = document.getElementById("pmsg");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) { m.innerHTML = "<span class='err'>Web Push is not available here. On iPhone, open OpenHRV from your Home Screen (installed PWA) — push does not work in a Safari tab.</span>"; return; }
  Notification.requestPermission().then(function(p) {
    if (p !== "granted") { m.textContent = "Permission: " + p + ". Allow notifications to enable push."; return; }
    return navigator.serviceWorker.ready.then(function(reg) {
      return fetch("/api/push/vapid-public-key").then(function(r){ return r.json(); }).then(function(j) {
        if (!j.configured) throw new Error("Push is not configured on the server (VAPID secrets missing).");
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(j.publicKey) });
      });
    }).then(function(sub) {
      return fetch("/api/push/subscribe", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ subscription: sub.toJSON() }) });
    }).then(function(r){ return r.json(); }).then(function(j) {
      m.textContent = j.ok ? "Notifications enabled on this device." : (j.error || "subscribe failed");
      loadNotifLog();
    });
  }).catch(function(e){ m.innerHTML = "<span class='err'>" + e.message + "</span>"; });
});
document.getElementById("pushtest").addEventListener("click", function() {
  var m = document.getElementById("pmsg");
  fetch("/api/notifications/test", { method: "POST", headers: {"content-type": "application/json"}, body: "{}" })
    .then(function(r){ return r.json(); }).then(function(j) {
      m.textContent = j.ok ? "Test sent — check your notifications. (" + j.results.map(function(x){ return x.status; }).join(", ") + ")" : (j.error || "test failed");
      loadNotifLog();
    });
});
function loadNotifPrefs() {
  fetch("/api/notifications/config").then(function(r){ return r.json(); }).then(function(j) {
    if (!j.ok) return;
    document.getElementById("notifprefs").innerHTML = j.types.map(function(t) {
      return "<div class='stat'><span>" + t.label + "</span><span><input type='time' id='nt-" + t.type + "' value='" + (t.time || "") + "' style='width:auto;padding:4px' " + (t.time ? "" : "disabled") + "> <button class='ghost' style='padding:4px 10px' data-t='" + t.type + "'>" + (t.enabled ? "On" : "Off") + "</button></span></div>";
    }).join("") + "<p class='sub'>Times are " + j.timeZone + ". Toggle applies immediately; a changed time saves with the toggle.</p>";
    document.querySelectorAll("#notifprefs button[data-t]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var type = btn.getAttribute("data-t");
        var timeEl = document.getElementById("nt-" + type);
        fetch("/api/notifications/config", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ type: type, enabled: btn.textContent === "Off", time: timeEl && !timeEl.disabled ? timeEl.value : undefined }) })
          .then(function(){ loadNotifPrefs(); });
      });
    });
  });
}
function loadNotifLog() {
  fetch("/api/notifications/log").then(function(r){ return r.json(); }).then(function(j) {
    if (!j.ok || !j.log.length) { document.getElementById("notiflog").innerHTML = ""; return; }
    document.getElementById("notiflog").innerHTML = "<h2 style='margin-top:12px'>Delivery log</h2>" + j.log.slice(0, 8).map(function(x) {
      return "<div class='stat'><span>" + String(x.at).slice(0, 16).replace("T", " ") + " · " + x.type + "</span><b>" + x.status + (x.http_status ? " (" + x.http_status + ")" : "") + "</b></div>";
    }).join("");
  });
}
loadNotifPrefs(); loadNotifLog();
fetch("/api/settings/flags").then(function(r){ return r.json(); }).then(function(j) {
  var labels = { ai_coach: "AI Coach", science_lab: "Science Lab", stories: "Stories" };
  document.getElementById("flags").innerHTML = Object.keys(labels).map(function(k) {
    return "<div class='stat'><span>" + labels[k] + "</span><button class='ghost' style='padding:4px 10px' data-f='" + k + "'>" + (j.flags[k] ? "On" : "Off") + "</button></div>";
  }).join("");
  document.querySelectorAll("#flags button[data-f]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var body = {}; body[btn.getAttribute("data-f")] = btn.textContent === "Off";
      fetch("/api/settings/flags", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body) })
        .then(function(r){ return r.json(); }).then(function(j2){ btn.textContent = j2.flags[btn.getAttribute("data-f")] ? "On" : "Off"; });
    });
  });
});
document.getElementById("deldata").addEventListener("click", function() {
  var m = document.getElementById("delmsg");
  var typed = prompt("Type DELETE to permanently erase all data in this OpenHRV instance:");
  if (typed !== "DELETE") { m.textContent = "Cancelled."; return; }
  fetch("/api/account/delete", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ confirm: "DELETE" }) })
    .then(function(r){ return r.json(); }).then(function(j) {
      m.textContent = j.ok ? "Deleted: " + Object.keys(j.deleted).map(function(k){ return k + " " + j.deleted[k]; }).join(", ") + "." : (j.error || "delete failed");
    });
});
</script>`,
    sha,
  );
}

export function scoreDetailPage(kind: "battery" | "stress" | "pressure", sha = ""): string {
  const titles = { battery: "Battery", stress: "Stress", pressure: "Pressure" } as const;
  const subs = {
    battery: "Your charge — how recovered you are, and what is draining or recharging it.",
    stress: "Current stress from the measurement engine, its trend, and what drives it.",
    pressure: "Load / pressure — trend and the contributors behind today's number.",
  } as const;
  return layout(
    "today",
    titles[kind],
    `<div class="card"><div class="glabel">${titles[kind]}</div>
     <div class="gauge" id="gauge" style="font-size:44px">—</div>
     <div class="sub" id="state">${subs[kind]}</div></div>
     <div class="card"><h2>Trend · last 14 readings</h2><canvas id="trend" width="700" height="140"></canvas><p class="msg" id="tmsg"></p></div>
     <div class="card"><h2 id="drivers-title">${kind === "battery" ? "Draining / recharging" : "What drives it"}</h2><div id="drivers"><p class="sub">Loading…</p></div></div>
     <p><a href="/"><button class="ghost">← Back to Today</button></a></p>
<script>
fetch("/api/scores").then(function(r){return r.json();}).then(function(j) {
  var s = j["${kind}"];
  var driversEl = document.getElementById("drivers");
  if (s && s.contributors && s.contributors.length) {
    driversEl.innerHTML = s.contributors.map(function(ct) {
      return "<div class='stat'><span>" + ct.label + "</span><b>" + ct.detail + "</b></div>";
    }).join("");
  }
  if (!s || s.value === null) {
    document.getElementById("state").textContent = "No data yet — take a measurement or sync Apple Health to compute this score.";
    document.getElementById("tmsg").textContent = "Trend appears after a few days of data.";
    if (!s || !s.contributors || !s.contributors.length) driversEl.innerHTML = "<p class='sub'>No data — take a measurement first.</p>";
    return;
  }
  document.getElementById("gauge").textContent = Math.round(s.value) + ("${kind}" === "pressure" ? "" : "%");
  document.getElementById("state").textContent = s.state + " · updated " + String(s.at).slice(0,16).replace("T"," ") + (s.source === "health" ? " · from Apple Health daily data" : "");
  var vs = s.trend.map(function(p){return p.value;});
  if (vs.length > 1) {
    var c = document.getElementById("trend"), x = c.getContext("2d");
    x.strokeStyle = "#4ade80"; x.beginPath();
    vs.forEach(function(v, i){ var px = i / (vs.length - 1) * c.width, py = c.height - v / 100 * (c.height - 10) - 5; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  } else document.getElementById("tmsg").textContent = "Trend appears after a few days of data.";
}).catch(function() {
  document.getElementById("drivers").innerHTML = "<p class='sub'>Could not load — reload to try again.</p>";
  document.getElementById("tmsg").textContent = "Trend unavailable.";
});
</script>`,
    sha,
  );
}

export function impactPage(sha = ""): string {
  return layout(
    "today",
    "Factor Impact",
    `<div class="card"><h2>What moves your numbers</h2>
     <p class="sub">For each tracked factor, OpenHRV compares days with the factor against days without it (your personal baseline): effect on Stress, HRV (RMSSD) and Battery, with sample counts. Factors come from your journal tags and sleep records. A card shows "not enough data yet" until it has at least 3 days on both sides — no invented effects.</p>
     <div id="cards"><p class="sub">Loading…</p></div></div>
     <p><a href="/"><button class="ghost">← Back to Today</button></a></p>
<script>
function metricRow(name, m, invert) {
  var d = m.deltaPct, good = invert ? d < 0 : d > 0;
  return "<div class='stat'><span>" + name + "</span><b style='color:" + (good ? "var(--acc)" : "var(--bad)") + "'>" + (d >= 0 ? "+" : "") + d.toFixed(1) + "%</b></div>" +
    "<div class='stat'><span class='sub'>with factor / without</span><b>" + m.withMean.toFixed(1) + " / " + m.withoutMean.toFixed(1) + "</b></div>";
}
fetch("/api/impact").then(function(r){return r.json();}).then(function(j) {
  var el = document.getElementById("cards");
  if (!j.impacts.length) { el.innerHTML = "<p class='sub'>No factors tracked yet. Add tags to journal entries (e.g. caffeine, alcohol, workout) and keep measuring — impact cards appear here.</p>"; return; }
  var hrvLabel = j.hrvBasis === "sdnn" ? "HRV · SDNN (daily)" : j.hrvBasis === "mixed" ? "HRV · RMSSD / SDNN" : "HRV · RMSSD";
  el.innerHTML = j.impacts.map(function(f, idx) {
    var head = "<h2 style='margin-top:14px'>" + f.factor.replace(/</g,"&lt;") + "</h2><p class='sub'>" + f.nWith + " days with · " + f.nWithout + " days without</p>";
    if (!f.enoughData) return head + "<p class='sub'>Not enough data yet — keep logging this factor and measuring.</p>";
    return head + "<div id='f" + idx + "'>" + metricRow(hrvLabel, f.metrics.rmssd, false) + metricRow("Battery", f.metrics.battery, false) + metricRow("Stress", f.metrics.stress, true) + "</div>";
  }).join("");
});
</script>`,
    sha,
  );
}

export function manifestJson(): string {
  return JSON.stringify({
    name: "OpenHRV",
    short_name: "OpenHRV",
    description: "Open-source HRV, readiness and stress tracking.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#071a13",
    theme_color: "#0b3d2e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Measure HRV", short_name: "Measure", url: "/measure", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "New journal entry", short_name: "Journal", url: "/journal", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Breathing session", short_name: "Breathe", url: "/more", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Self-tests", short_name: "Tests", url: "/tests", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
  });
}

export function serviceWorkerJs(): string {
  return `const C = "openhrv-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(["/", "/measure", "/journal", "/mydata", "/more", "/manifest.webmanifest"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  let d = { title: "OpenHRV", body: "You have an update." };
  try { d = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/icon.svg" }));
});
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(clients.openWindow("/")); });
`;
}


export function sleepPage(sha = ""): string {
  return layout(
    "mydata",
    "Sleep",
    `<div class="card"><div class="glabel">Last night</div>
     <div class="gauge" id="last" style="font-size:40px">—</div>
     <div class="sub" id="lastsub">Loading…</div>
     <div id="stages"></div></div>
     <div class="card"><h2>Trend · last 14 nights</h2><canvas id="trend" width="700" height="140"></canvas><p class="msg" id="tmsg"></p></div>
     <div class="card"><h2>All nights</h2><div id="nights"><p class="sub">Loading…</p></div></div>
     <p><a href="/mydata"><button class="ghost">← Back to My Data</button></a></p>
<script>
fetch("/api/sleep").then(function(r){return r.json();}).then(function(j) {
  var s = j.summary;
  if (!s || !s.lastNight) { document.getElementById("lastsub").textContent = "No sleep recorded yet — import from Apple Health (Health Auto Export, a Shortcut, or export.xml) and your nights appear here."; document.getElementById("nights").innerHTML = ""; return; }
  var ln = s.lastNight;
  document.getElementById("last").textContent = ln.hours.toFixed(1) + " h";
  document.getElementById("lastsub").textContent = ln.date + " · debt " + ln.debtH.toFixed(1) + " h vs your " + s.targetH + " h target" + (ln.vsMedianPct !== null ? " · " + (ln.vsMedianPct >= 0 ? "+" : "") + ln.vsMedianPct + "% vs your median (" + s.medianHours + " h)" : "") + " · 7-night debt " + s.debt7dH + " h";
  if (ln.stages) {
    document.getElementById("stages").innerHTML = "<h2>Sleep stages</h2>" + Object.keys(ln.stages).map(function(k) {
      return "<div class='stat'><span>" + k + "</span><b>" + ln.stages[k] + " min</b></div>";
    }).join("");
  } else {
    document.getElementById("stages").innerHTML = "<p class='sub'>Stage detail appears when your import source provides stage segments (Health Auto Export does).</p>";
  }
  document.getElementById("nights").innerHTML = s.nights.map(function(n) {
    return "<div class='stat'><span>" + n.date + " · " + String(n.start_at).slice(11, 16) + "–" + String(n.end_at).slice(11, 16) + " · " + n.source + "</span><b>" + n.hours.toFixed(1) + " h</b></div>";
  }).join("");
  var pts = s.nights.slice(0, 14).reverse();
  if (pts.length > 1) {
    var c = document.getElementById("trend"), x = c.getContext("2d");
    x.strokeStyle = "#38bdf8"; x.beginPath();
    pts.forEach(function(n, i) { var px = i / (pts.length - 1) * c.width, py = c.height - Math.min(12, n.hours) / 12 * (c.height - 10) - 5; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    x.strokeStyle = "#fbbf24"; x.setLineDash([4, 4]); x.beginPath();
    var ty = c.height - s.targetH / 12 * (c.height - 10) - 5; x.moveTo(0, ty); x.lineTo(c.width, ty); x.stroke();
  } else document.getElementById("tmsg").textContent = "Trend appears after a few recorded nights.";
});
</script>`,
    sha,
  );
}

export function categoryPage(key: string, title: string, sha = ""): string {
  return layout(
    "mydata",
    title,
    `<div class="card"><h2>${title}</h2><p class="sub" id="blurb">Loading…</p><div id="metrics"></div></div>
     <div class="card" id="bppair" style="display:none"><h2>Paired readings</h2><div id="bp"></div></div>
     <div class="card"><h2>Recent samples</h2><div id="recent"><p class="sub">Loading…</p></div></div>
     <p><a href="/mydata"><button class="ghost">← Back to My Data</button></a></p>
<script>
fetch("/api/mydata/categories").then(function(r){return r.json();}).then(function(j) {
  var cat = j.categories.filter(function(c){ return c.key === ${JSON.stringify(key)}; })[0];
  if (!cat) { document.getElementById("blurb").textContent = "Unknown category."; return; }
  document.getElementById("blurb").textContent = cat.blurb;
  document.getElementById("metrics").innerHTML = cat.metrics.map(function(m) {
    if (!m.latest) return "<div class='stat'><span>" + m.label + "</span><b>no data</b></div>";
    return "<div class='stat'><span>" + m.label + " · n=" + m.count + "</span><b>" + Number(m.latest.value).toFixed(1) + " " + m.latest.unit + "</b></div>" +
      "<div class='stat'><span class='sub'>7-day average · range</span><b>" + (m.avg7d === null ? "—" : m.avg7d) + " · " + (m.min === null ? "—" : Number(m.min).toFixed(1)) + "–" + (m.max === null ? "—" : Number(m.max).toFixed(1)) + "</b></div>" +
      "<div class='stat'><span class='sub'>latest " + String(m.latest.at).slice(0, 16).replace("T", " ") + " · " + m.latest.source + "</span><b></b></div>";
  }).join("");
  if (cat.key === "blood-pressure" && j.bpReadings && j.bpReadings.length) {
    document.getElementById("bppair").style.display = "block";
    document.getElementById("bp").innerHTML = j.bpReadings.map(function(r) {
      return "<div class='stat'><span>" + String(r.at).slice(0, 16).replace("T", " ") + "</span><b>" + r.systolic + " / " + r.diastolic + " mmHg</b></div>";
    }).join("");
  }
  var types = cat.metrics.map(function(m){ return m.type; });
  var rec = (j.recentSamples || []).filter(function(s){ return types.indexOf(s.type) >= 0; }).slice(0, 25);
  document.getElementById("recent").innerHTML = rec.length ? rec.map(function(s) {
    return "<div class='stat'><span>" + String(s.start_at).slice(0, 16).replace("T", " ") + " · " + s.type + "</span><b>" + (s.value === null ? "" : Number(s.value).toFixed(1) + " " + s.unit) + " · " + s.source + "</b></div>";
  }).join("") : "<p class='sub'>No samples in this category yet — they arrive via Apple Health import or Strava.</p>";
});
</script>`,
    sha,
  );
}

export function labPage(sha = ""): string {
  return layout(
    "more",
    "Science Lab",
    `<div class="card"><h2>Correlations in your data</h2>
     <p class="sub">Pearson correlations across your daily series — measurements, sleep, steps, mood and journal tags. A correlation is a pattern to test, not proof of cause; the Lab shows the sample size with every number.</p>
     <div id="ranked"><p class="sub">Loading…</p></div></div>
     <div class="card"><h2>Explore a pair</h2>
     <div class="row">
       <label class="sub" style="flex:1">X <select id="sx"></select></label>
       <label class="sub" style="flex:1">Y <select id="sy"></select></label>
     </div>
     <canvas id="scatter" width="700" height="260"></canvas>
     <p class="msg" id="smsg"></p></div>
     <p><a href="/more"><button class="ghost">← Back to More</button></a></p>
<script>
var DAYS = [], LABELS = {};
function fillSelects() {
  var keys = Object.keys(LABELS);
  ["sx", "sy"].forEach(function(id) {
    document.getElementById(id).innerHTML = keys.map(function(k){ return "<option value='" + k + "'>" + LABELS[k] + "</option>"; }).join("");
  });
  document.getElementById("sx").value = "sleepHours"; document.getElementById("sy").value = "rmssd";
}
function drawScatter() {
  var kx = document.getElementById("sx").value, ky = document.getElementById("sy").value;
  var pts = DAYS.filter(function(d){ return d[kx] !== null && d[ky] !== null; });
  var c = document.getElementById("scatter"), x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  if (pts.length < 3) { document.getElementById("smsg").textContent = "Not enough paired days yet (" + pts.length + ") — correlations need at least 5."; return; }
  var xs = pts.map(function(d){ return d[kx]; }), ys = pts.map(function(d){ return d[ky]; });
  var mnx = Math.min.apply(null, xs), mxx = Math.max.apply(null, xs), mny = Math.min.apply(null, ys), mxy = Math.max.apply(null, ys);
  x.fillStyle = "#4ade80";
  pts.forEach(function(d) {
    var px = (d[kx] - mnx) / (mxx - mnx || 1) * (c.width - 24) + 12, py = c.height - (d[ky] - mny) / (mxy - mny || 1) * (c.height - 24) - 12;
    x.beginPath(); x.arc(px, py, 3.5, 0, 7); x.fill();
  });
  var mx = xs.reduce(function(a,b){return a+b;},0)/xs.length, my = ys.reduce(function(a,b){return a+b;},0)/ys.length, sxy=0, sxx=0, syy=0;
  pts.forEach(function(d){ sxy += (d[kx]-mx)*(d[ky]-my); sxx += (d[kx]-mx)*(d[kx]-mx); syy += (d[ky]-my)*(d[ky]-my); });
  var r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  document.getElementById("smsg").textContent = LABELS[kx] + " vs " + LABELS[ky] + ": r = " + r.toFixed(2) + " over " + pts.length + " days.";
}
fetch("/api/lab").then(function(r){return r.json();}).then(function(j) {
  DAYS = j.days; LABELS = j.labels;
  fillSelects(); drawScatter();
  document.getElementById("sx").addEventListener("change", drawScatter);
  document.getElementById("sy").addEventListener("change", drawScatter);
  document.getElementById("ranked").innerHTML = j.correlations.length ? j.correlations.map(function(c) {
    return "<div class='stat'><span>" + (LABELS[c.x] || c.x) + " ↔ " + (LABELS[c.y] || c.y) + "</span><b style='color:" + (c.r > 0 ? "var(--acc)" : "var(--bad)") + "'>r " + c.r.toFixed(2) + " · n=" + c.n + "</b></div>";
  }).join("") : "<p class='sub'>No pair has 5+ shared days yet. Keep measuring and logging — the Lab fills in as your history grows.</p>";
});
</script>`,
    sha,
  );
}

export function coachPage(sha = ""): string {
  return layout(
    "more",
    "AI Coach",
    `<div class="card"><h2>Ask your data</h2>
     <p class="sub">The coach runs on Workers AI inside this Cloudflare account and is grounded only in your stored OpenHRV data — measurements, sleep, journal moods and measured factor impacts. Nothing goes to an external AI service and there are no trackers. It explains patterns; it does not diagnose.</p>
     <div id="chat"></div>
     <textarea id="q" rows="2" placeholder="e.g. Why is my Battery low this week? What seems to help my RMSSD?"></textarea>
     <p><button id="ask">Ask coach</button></p><p class="msg" id="cmsg"></p></div>
     <p><a href="/more"><button class="ghost">← Back to More</button></a></p>
<script>
var history = [];
function bubble(role, text) {
  var el = document.getElementById("chat");
  var div = document.createElement("div");
  div.className = "stat"; div.style.display = "block";
  div.innerHTML = "<b>" + (role === "user" ? "You" : "Coach") + "</b><p style='margin:4px 0;white-space:pre-wrap'>" + text.replace(/</g, "&lt;") + "</p>";
  el.appendChild(div);
}
document.getElementById("ask").addEventListener("click", function() {
  var q = document.getElementById("q").value.trim(), m = document.getElementById("cmsg");
  if (!q) return;
  bubble("user", q); document.getElementById("q").value = ""; m.textContent = "Thinking…";
  fetch("/api/coach", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ message: q, history: history }) })
    .then(function(r){ return r.json(); }).then(function(j) {
      if (!j.ok) { m.innerHTML = "<span class='err'>" + (j.error || "coach unavailable") + "</span>"; return; }
      m.textContent = "";
      history.push({ role: "user", content: q }, { role: "assistant", content: j.reply });
      bubble("assistant", j.reply);
    }).catch(function(e){ m.innerHTML = "<span class='err'>" + e.message + "</span>"; });
});
</script>`,
    sha,
  );
}


export function storiesPage(sha = ""): string {
  const card = (title: string, body: string) => `<div class="card"><h2>${title}</h2><p class="sub" style="color:var(--txt);font-size:14px;line-height:1.55">${body}</p></div>`;
  return layout(
    "more",
    "Stories",
    card(
      "What RMSSD actually measures",
      "RMSSD is the root mean square of successive differences between heartbeats. Beat-to-beat wobble is mostly parasympathetic — the vagus nerve speeding and slowing the heart with each breath — so RMSSD is the most practical short-recording window into recovery status. It is why OpenHRV asks for a calm, seated morning reading: posture, caffeine and a flight of stairs all move it. Compare you to yourself (your rolling baseline), never to a population chart.",
    ) +
      card(
        "The stress index, explained",
        "The Baevsky stress index compresses the shape of your RR-interval histogram into one number: the tighter and more metronome-like your heartbeats, the higher the index and the more your autonomic system is leaning sympathetic. OpenHRV blends it with the LF/HF balance to form the Stress percentage. A single high reading after coffee or a hard workout is normal physiology; a multi-day climb is the signal worth acting on.",
      ) +
      card(
        "Sleep is an HRV input, not a separate stat",
        "Deep sleep is when parasympathetic activity peaks and the next day's HRV baseline is set. In your own data the Lab usually shows it plainly: nights over seven hours pair with higher next-morning RMSSD. That is why the Sleep page tracks debt against your own median rather than an eight-hour rule — your baseline is the one that predicts your readings.",
      ) +
      card(
        "How to take a clean morning reading",
        "Same time, same posture, before coffee and before your phone's first scroll. Sit or lie still for the full minute; let the first ten seconds settle. Chest straps give the cleanest RR series, camera readings are noisier — the artifact filter removes obvious outliers, but a steady hand beats any algorithm. Consistency of conditions matters more than the device.",
      ) +
      card(
        "Breathing and the vagus nerve",
        "Slow breathing around five to six breaths per minute resonates with the baroreflex and visibly raises HRV amplitude — the basis of the box-breathing session in More. The honest test is in your own data: log sessions, keep measuring, and let Factor Impact show whether breathing days really do run lower-stress for you.",
      ) +
      `<p><a href="/more"><button class="ghost">← Back to More</button></a></p>`,
    sha,
  );
}

export function welcomePage(sha = ""): string {
  const step = (n: number, title: string, body: string) =>
    `<div class="card"><div class="glabel">Step ${n}</div><h2 style="margin-top:4px">${title}</h2><p class="sub" style="font-size:14px;line-height:1.5">${body}</p></div>`;
  return layout(
    "more",
    "Welcome",
    step(1, "What OpenHRV is", "A private, open-source tracker for heart-rate variability, readiness (Battery), stress and pressure. Everything you record lives in this one Cloudflare account — there are no ads, no trackers and no other users.") +
      step(2, "Measure", "Take a one-minute HRV reading each morning: paste RR intervals, connect a Bluetooth chest strap, or use the camera sensor on the Measure page. Scores and trends come from these readings, so consistency beats intensity.") +
      step(3, "Connect Apple Health", "Your iPhone already holds years of health data. The Health Auto Export app can stream it here automatically; an iOS Shortcut can post it; or upload an export.xml once. Your import token and step-by-step setup live in More → Settings & connections. In the other direction, the Write-Back Shortcut logs OpenHRV breathing minutes and measurement summaries into Apple Health.") +
      step(4, "Notifications, on your terms", "Morning readiness, a measurement reminder, a low-Battery alert and an evening breathing nudge — each with its own switch and time, in More → Notifications. On iPhone, add OpenHRV to your Home Screen first; push works inside the installed app.") +
      step(5, "Permissions, in plain language", "Camera is used only for fingertip pulse readings, and frames never leave the device — only the computed RR intervals are sent. Bluetooth talks only to your heart-rate strap. Notifications are optional and off until you enable them. Microphone is used only when you record a journal voice comment.") +
      `<div class="card"><p><button id="done">Done — go to Today</button></p><p class="msg" id="wmsg"></p></div>
<script>
document.getElementById("done").addEventListener("click", function() {
  fetch("/api/settings/onboarded", { method: "POST" }).then(function() { location.href = "/"; })
    .catch(function() { location.href = "/"; });
});
</script>`,
    sha,
  );
}

export function testsPage(sha = ""): string {
  return layout(
    "more",
    "Self-tests",
    `<div class="card"><h2>Reaction time</h2>
     <p class="sub">Tap the box the instant it turns green. Five trials; your mean and best are scored.</p>
     <div id="rxbox" style="background:var(--line);border-radius:12px;padding:38px;text-align:center;font-weight:700;cursor:pointer;user-select:none">Tap to start</div>
     <p class="msg" id="rxmsg"></p><p><button class="ghost" id="rxsave" disabled>Save reaction result</button></p></div>
     <div class="card"><h2>Finger tapping · 30 s</h2>
     <p class="sub">Tap the button as fast as you comfortably can for 30 seconds — a simple motor-speed check.</p>
     <div class="gauge" id="tapcount" style="font-size:40px">0</div>
     <p><button id="tapbtn">Start &amp; tap</button></p><p class="msg" id="tapmsg"></p></div>
     <div class="card"><h2>Breath hold</h2>
     <p class="sub">Inhale normally, then hold. Stop the timer when you need to breathe — never push through dizziness, and never do this in water or while driving.</p>
     <div class="gauge" id="holdtime" style="font-size:40px">0.0 s</div>
     <p><button id="holdbtn">Start hold</button></p><p class="msg" id="holdmsg"></p></div>
     <div class="card"><h2>Orthostatic test</h2>
     <p class="sub">Pick a measurement taken lying down and one taken standing (within ~15 minutes of each other). OpenHRV compares heart rate and RMSSD between the two postures.</p>
     <label class="sub">Lying <select id="ortholying"></select></label>
     <label class="sub">Standing <select id="orthostanding"></select></label>
     <p><button class="ghost" id="orthogo">Compare &amp; save</button></p><p class="msg" id="orthomsg"></p></div>
     <div class="card"><h2>HRV episode</h2>
     <p class="sub">The Self-Discovery pattern: a baseline reading, a guided minute, then a second reading — the change is the result. Paste RR intervals for both (or use Measure first and come back).</p>
     <textarea id="epbase" rows="3" placeholder="Baseline RR intervals (ms)"></textarea>
     <p class="sub">Now breathe slowly — in for 4, out for 6 — for one minute.</p>
     <textarea id="eppost" rows="3" placeholder="Post-episode RR intervals (ms)"></textarea>
     <p><button class="ghost" id="epgo">Run episode &amp; save</button></p><p class="msg" id="epmsg"></p></div>
     <div class="card"><h2>Your results</h2><div id="results"><p class="sub">Loading…</p></div></div>
     <p><a href="/more"><button class="ghost">← Back to More</button></a></p>
<script>
function saveTest(type, result, msgId) {
  return fetch("/api/self-tests", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ test_type: type, result: result }) })
    .then(function(r){ return r.json(); }).then(function(j) {
      document.getElementById(msgId).textContent = j.ok ? "Saved." : (j.error || "save failed");
      loadResults();
    });
}
function loadResults() {
  fetch("/api/self-tests?limit=30").then(function(r){return r.json();}).then(function(j) {
    document.getElementById("results").innerHTML = j.tests.length ? j.tests.map(function(t) {
      var keys = Object.keys(t.result).slice(0, 4).map(function(k){ return k + " " + t.result[k]; }).join(" · ");
      return "<div class='stat'><span>" + String(t.taken_at).slice(0, 16).replace("T", " ") + " · " + t.test_type.replace(/_/g, " ") + "</span><b>" + keys + "</b></div>";
    }).join("") : "<p class='sub'>No tests yet — your history and trends build here.</p>";
  });
}
var rxTrials = [], rxState = "idle", rxT0 = 0, rxTimer = null;
var rxbox = document.getElementById("rxbox");
rxbox.addEventListener("click", function() {
  var m = document.getElementById("rxmsg");
  if (rxState === "idle" || rxState === "done") {
    rxTrials = []; rxState = "waiting"; rxbox.style.background = "var(--warn)"; rxbox.textContent = "Wait for green…";
    document.getElementById("rxsave").disabled = true;
    rxTimer = setTimeout(function(){ rxState = "go"; rxT0 = performance.now(); rxbox.style.background = "var(--acc)"; rxbox.textContent = "TAP!"; }, 1000 + Math.random() * 3000);
  } else if (rxState === "waiting") {
    clearTimeout(rxTimer); rxState = "idle"; rxbox.style.background = "var(--line)"; rxbox.textContent = "Too soon — tap to retry";
  } else if (rxState === "go") {
    var ms = Math.round(performance.now() - rxT0);
    rxTrials.push(ms);
    if (rxTrials.length >= 5) {
      rxState = "done"; rxbox.style.background = "var(--line)"; rxbox.textContent = "Done — tap to restart";
      var mean = Math.round(rxTrials.reduce(function(a,b){return a+b;},0) / rxTrials.length);
      m.textContent = "Trials: " + rxTrials.join(", ") + " ms · mean " + mean + " · best " + Math.min.apply(null, rxTrials);
      document.getElementById("rxsave").disabled = false;
      document.getElementById("rxsave").onclick = function(){ saveTest("reaction_time", { mean_ms: mean, best_ms: Math.min.apply(null, rxTrials), trials: rxTrials }, "rxmsg"); };
    } else {
      rxState = "waiting"; rxbox.style.background = "var(--warn)"; rxbox.textContent = "Wait for green… (" + rxTrials.length + "/5)";
      rxTimer = setTimeout(function(){ rxState = "go"; rxT0 = performance.now(); rxbox.style.background = "var(--acc)"; rxbox.textContent = "TAP!"; }, 1000 + Math.random() * 3000);
    }
  }
});
var tapN = 0, tapActive = false;
document.getElementById("tapbtn").addEventListener("click", function() {
  var m = document.getElementById("tapmsg"), btn = this;
  if (!tapActive) {
    tapN = 0; tapActive = true; btn.textContent = "TAP!"; document.getElementById("tapcount").textContent = "0";
    var end = Date.now() + 30000;
    var iv = setInterval(function() {
      var left = Math.ceil((end - Date.now()) / 1000);
      m.textContent = left + " s left…";
      if (Date.now() >= end) {
        clearInterval(iv); tapActive = false; btn.textContent = "Start & tap";
        m.textContent = tapN + " taps in 30 s.";
        saveTest("finger_tapping", { taps_30s: tapN }, "tapmsg");
      }
    }, 200);
  } else {
    tapN++; document.getElementById("tapcount").textContent = String(tapN);
  }
});
var holdStart = 0, holdIv = null, holding = false;
document.getElementById("holdbtn").addEventListener("click", function() {
  var btn = this, m = document.getElementById("holdmsg");
  if (!holding) {
    holding = true; holdStart = performance.now(); btn.textContent = "Stop — I need to breathe";
    holdIv = setInterval(function(){ document.getElementById("holdtime").textContent = ((performance.now() - holdStart) / 1000).toFixed(1) + " s"; }, 100);
  } else {
    holding = false; clearInterval(holdIv); btn.textContent = "Start hold";
    var secs = Math.round((performance.now() - holdStart) / 100) / 10;
    m.textContent = "Held " + secs + " s.";
    saveTest("breath_hold", { seconds: secs }, "holdmsg");
  }
});
fetch("/api/measurements?limit=12").then(function(r){return r.json();}).then(function(j) {
  var opts = j.measurements.map(function(m){ return "<option value='" + m.id + "'>" + String(m.taken_at).slice(0, 16).replace("T", " ") + " · HR " + Number(m.mean_hr_bpm).toFixed(0) + " · RMSSD " + Number(m.rmssd_ms).toFixed(0) + "</option>"; }).join("");
  document.getElementById("ortholying").innerHTML = opts; document.getElementById("orthostanding").innerHTML = opts;
});
document.getElementById("orthogo").addEventListener("click", function() {
  var a = document.getElementById("ortholying").value, b = document.getElementById("orthostanding").value, m = document.getElementById("orthomsg");
  if (!a || !b || a === b) { m.textContent = "Pick two different measurements."; return; }
  Promise.all([fetch("/api/measurements/" + a).then(function(r){return r.json();}), fetch("/api/measurements/" + b).then(function(r){return r.json();})]).then(function(rs) {
    var L = rs[0].measurement, S = rs[1].measurement;
    var dHr = Math.round((Number(S.mean_hr_bpm) - Number(L.mean_hr_bpm)) * 10) / 10;
    var dRmssd = Math.round((Number(S.rmssd_ms) - Number(L.rmssd_ms)) * 10) / 10;
    m.textContent = "Standing vs lying: HR " + (dHr >= 0 ? "+" : "") + dHr + " bpm · RMSSD " + (dRmssd >= 0 ? "+" : "") + dRmssd + " ms. A modest HR rise on standing is expected; a very large rise with symptoms is worth mentioning to a clinician.";
    saveTest("orthostatic", { hr_delta_bpm: dHr, rmssd_delta_ms: dRmssd, lying_id: Number(a), standing_id: Number(b) }, "orthomsg");
  });
});
function parseRr(id) {
  var nums = (document.getElementById(id).value.match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number).filter(function(x){ return x > 0; });
  if (nums.length && nums.every(function(x){ return x < 10; })) nums = nums.map(function(x){ return x * 1000; });
  return nums;
}
document.getElementById("epgo").addEventListener("click", function() {
  var m = document.getElementById("epmsg");
  var base = parseRr("epbase"), post = parseRr("eppost");
  if (base.length < 10 || post.length < 10) { m.innerHTML = "<span class='err'>Both readings need at least 10 RR intervals.</span>"; return; }
  var save = function(rr, source) { return fetch("/api/measurements", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ rr_ms: rr, source: source }) }).then(function(r){ return r.json(); }); };
  Promise.all([save(base, "selftest-baseline"), save(post, "selftest-post")]).then(function(rs) {
    if (!rs[0].ok || !rs[1].ok) { m.innerHTML = "<span class='err'>A reading failed to compute.</span>"; return; }
    var dRmssd = Math.round((rs[1].metrics.rmssdMs - rs[0].metrics.rmssdMs) * 10) / 10;
    var dHr = Math.round((rs[1].metrics.meanHrBpm - rs[0].metrics.meanHrBpm) * 10) / 10;
    m.textContent = "Episode effect: RMSSD " + (dRmssd >= 0 ? "+" : "") + dRmssd + " ms · HR " + (dHr >= 0 ? "+" : "") + dHr + " bpm after one minute of slow breathing.";
    saveTest("hrv_episode", { rmssd_delta_ms: dRmssd, hr_delta_bpm: dHr, baseline_id: rs[0].id, post_id: rs[1].id }, "epmsg");
  });
});
loadResults();
</script>`,
    sha,
  );
}

export function themesPage(sha = ""): string {
  return layout(
    "more",
    "Themes",
    `<div class="card"><h2>Face gallery</h2>
     <p class="sub">The reference app bundles watch faces; on the web, OpenHRV themes the PWA instead. Pick a face — it applies instantly on this device and is remembered.</p>
     <div id="themes"></div>
     <p class="msg" id="tmsg"></p></div>
     <p><a href="/more"><button class="ghost">← Back to More</button></a></p>
<script>
var THEMES = [
  { name: "Forest", desc: "Deep green — the original OpenHRV face.", acc: "#4ade80", card: "#0d2b20", bg: "#071a13" },
  { name: "Ocean", desc: "Night-sea blue.", acc: "#38bdf8", card: "#0b2536", bg: "#061824" },
  { name: "Ember", desc: "Warm amber on charcoal-brown.", acc: "#fb923c", card: "#33180b", bg: "#1f0f06" },
  { name: "Mono", desc: "Slate and silver, minimal.", acc: "#e5e7eb", card: "#1f2937", bg: "#111827" }
];
document.getElementById("themes").innerHTML = THEMES.map(function(t, i) {
  return "<div class='stat'><span><b>" + t.name + "</b><br><span class='sub'>" + t.desc + "</span></span><span style='display:inline-block;width:26px;height:26px;border-radius:50%;background:" + t.acc + "'></span> <button class='ghost' data-i='" + i + "'>Apply</button></div>";
}).join("");
document.querySelectorAll("#themes button[data-i]").forEach(function(btn) {
  btn.addEventListener("click", function() {
    var t = THEMES[Number(btn.getAttribute("data-i"))];
    localStorage.setItem("openhrv-theme", JSON.stringify(t));
    document.documentElement.style.setProperty("--acc", t.acc);
    document.documentElement.style.setProperty("--card", t.card);
    document.documentElement.style.setProperty("--bg", t.bg);
    document.getElementById("tmsg").textContent = t.name + " applied on this device.";
    fetch("/api/settings/theme", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ theme: t.name }) }).catch(function(){});
  });
});
</script>`,
    sha,
  );
}

export function aboutPage(sha = ""): string {
  return layout(
    "more",
    "About",
    `<div class="card"><h2>About OpenHRV</h2>
     <p class="sub" style="font-size:14px;line-height:1.55;color:var(--txt)">OpenHRV is an open-source, clean-room reimplementation of a commercial HRV app's feature set, built from a feature specification plus published science (Task Force 1996 HRV standards; the Baevsky stress index). All code and text are original; OpenHRV is unaffiliated with Welltory.</p>
     <p class="sub" style="font-size:14px;line-height:1.55;color:var(--txt)">Privacy is the point of the rebuild: no Amplitude, Facebook or AppsFlyer trackers — the reference app ships all three. The only telemetry is first-party request logs in this Cloudflare account, and every health record lives in this instance's own database.</p>
     <h2>Platform translations</h2>
     <div class="stat"><span>Subscriptions / paywall</span><b>owner feature flags</b></div>
     <div class="stat"><span>Support chat (Intercom)</span><b>this page</b></div>
     <div class="stat"><span>Live Activities</span><b>dashboard + Web Push</b></div>
     <div class="stat"><span>Native push (APNs)</span><b>Web Push to the PWA</b></div>
     <div class="stat"><span>Watch sync (WCSession)</span><b>Worker API (companion)</b></div>
     <div class="stat"><span>Full register</span><b><a href="https://github.com/barkleesanders/openhrv/blob/main/SPEC.md" style="color:var(--acc)">SPEC.md</a></b></div></div>
     <div class="card"><h2>Feedback</h2>
     <p class="sub">Notes go to this instance's own event log — the owner reviews them; nothing leaves the account.</p>
     <textarea id="fb" rows="3" placeholder="What worked, what didn't, what's missing?"></textarea>
     <p><button id="fbsend">Send feedback</button></p><p class="msg" id="fbmsg"></p></div>
     <p><a href="/more"><button class="ghost">← Back to More</button></a></p>
<script>
document.getElementById("fbsend").addEventListener("click", function() {
  var text = document.getElementById("fb").value.trim(), m = document.getElementById("fbmsg");
  if (!text) { m.textContent = "Write something first."; return; }
  fetch("/api/feedback", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({ text: text }) })
    .then(function(r){ return r.json(); }).then(function(j) { m.textContent = j.ok ? "Thanks — saved to the event log." : (j.error || "failed"); document.getElementById("fb").value = ""; });
});
</script>`,
    sha,
  );
}
