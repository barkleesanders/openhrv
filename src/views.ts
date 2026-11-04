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
       <div class="stat"><span>Source</span><b>${String(d.latest.source)}</b></div></div>`
    : `<div class="card"><h2>No measurements yet</h2><p class="sub">Take your first HRV measurement to light up this dashboard.</p><p><a href="/measure"><button>Measure now</button></a></p></div>`;
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
    `<div class="row">
       <a href="/battery" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Battery · charge</div><div class="gauge" style="color:var(--acc)">${score(d.battery)}${d.battery === null ? "" : "<span style='font-size:16px'>%</span>"}</div><div class="sub">how charged you are · tap for detail</div></div></a>
       <a href="/stress" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Stress</div><div class="gauge" style="color:var(--bad)">${score(d.stress)}${d.stress === null ? "" : "<span style='font-size:16px'>%</span>"}</div><div class="sub">from stress index + HRV · tap for detail</div></div></a>
     </div>
     <div class="row">
       <a href="/pressure" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Pressure · load</div><div class="gauge" style="color:var(--warn)">${score(d.pressure)}</div><div class="sub">load estimate from stress index + LF/HF · tap for detail</div></div></a>
       <a href="/impact" style="flex:1;text-decoration:none;color:inherit"><div class="card"><div class="glabel">Factor impact</div><div class="gauge" style="font-size:20px;padding-top:10px">What moves you →</div><div class="sub">measured impact of tags, sleep &amp; habits</div></div></a>
     </div>${latest}${hist}`,
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
     <div class="card"><h2>Entries</h2><div id="list"><p class="sub">Loading…</p></div></div>
<script>
function load() {
  fetch("/api/journal").then(function(r){return r.json();}).then(function(j) {
    document.getElementById("list").innerHTML = j.entries.length ? j.entries.map(function(e) {
      return "<div class='stat'><span>" + String(e.created_at).slice(0,16).replace("T"," ") + "</span><b>" + e.mood + "/10</b></div><p style='margin:4px 0'>" + e.body.replace(/</g,"&lt;") + "</p>" + (e.tags || []).map(function(t){return "<span class='tag'>" + t + "</span>";}).join("");
    }).join("") : "<p class='sub'>No entries yet.</p>";
  });
}
document.getElementById("add").addEventListener("click", function() {
  var tags = document.getElementById("tags").value.split(",").map(function(s){return s.trim();}).filter(Boolean);
  fetch("/api/journal", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ body: document.getElementById("body").value, mood: 5, tags: tags }) })
    .then(function(r){return r.json();}).then(function(j){ document.getElementById("msg").textContent = j.ok ? "Saved." : (j.error || "failed"); load(); });
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
     <div class="card"><h2>Measurement history</h2><canvas id="chart" width="700" height="140"></canvas><div id="hist"></div></div>
     <div class="card"><h2>Import Apple Health</h2><p class="sub">Automated: Health Auto Export app → REST import. Also: iOS Shortcuts POST and export.xml upload — all set up in More → Settings &amp; connections, where your import token lives.</p><p><a href="/more#settings"><button class="ghost">Open import settings</button></a></p></div>
     <div class="card"><h2>Imported samples</h2><div id="samples"><p class="sub">Loading…</p></div></div>
<script>
fetch("/api/mydata").then(function(r){return r.json();}).then(function(j) {
  ["measurements","sleep","journal","breathing","tests"].forEach(function(k){ document.getElementById("c-" + k).textContent = j.counts[k]; });
  fetch("/api/samples?limit=12").then(function(r){return r.json();}).then(function(s) {
    document.getElementById("samples").innerHTML = s.samples.length ? s.samples.map(function(x) {
      return "<div class='stat'><span>" + String(x.start_at).slice(0,16).replace("T"," ") + " · " + x.type + "</span><b>" + (x.value === null ? "" : Number(x.value).toFixed(1) + " " + x.unit) + " · " + x.source + "</b></div>";
    }).join("") : "<p class='sub'>No imported samples yet.</p>";
  });
  var ms = j.measurements.slice().reverse();
  document.getElementById("hist").innerHTML = j.measurements.map(function(m){ return "<div class='stat'><span>" + String(m.taken_at).slice(0,16).replace("T"," ") + " · " + m.source + "</span><b>" + Number(m.mean_hr_bpm).toFixed(0) + " bpm · RMSSD " + Number(m.rmssd_ms).toFixed(0) + "</b></div>"; }).join("") || "<p class='sub'>Nothing yet.</p>";
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
     <div class="card"><h2>Self-tests</h2><p class="sub">Orthostatic test: measure lying down, then standing — OpenHRV compares the two. Full Self-Discovery set lands in wave D5.</p></div>
     <div class="card"><h2>Notifications</h2><p class="sub">Web Push for this PWA (morning readiness, reminders, low-Battery alert) lands in wave D6. Preferences will live here.</p>
     <p><button class="ghost" id="push">Enable notifications</button></p><p class="msg" id="pmsg"></p></div>
     <div class="card"><h2>About</h2><p class="sub">OpenHRV is an open-source, clean-room reimplementation built from a feature specification — original code and text, no trackers, data stored only in this Cloudflare account. Single-user instance locked to its owner via Cloudflare Access.</p></div>
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
     <h2>Your data</h2>
     <p><a href="/api/export/data.json"><button class="ghost">Download JSON export</button></a> <a href="/api/export/data.csv"><button class="ghost">Download measurements CSV</button></a></p>
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
document.getElementById("push").addEventListener("click", function() {
  var m = document.getElementById("pmsg");
  if (!("Notification" in window)) { m.textContent = "Notifications not supported in this browser."; return; }
  Notification.requestPermission().then(function(p){ m.textContent = "Permission: " + p + ". Push delivery activates in wave D6."; });
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
  if (!s || s.value === null) { document.getElementById("state").textContent = "No measurements yet — take one to compute this score."; return; }
  document.getElementById("gauge").textContent = Math.round(s.value) + ("${kind}" === "pressure" ? "" : "%");
  document.getElementById("state").textContent = s.state + " · updated " + String(s.at).slice(0,16).replace("T"," ");
  document.getElementById("drivers").innerHTML = s.contributors.map(function(ct) {
    return "<div class='stat'><span>" + ct.label + "</span><b>" + ct.detail + "</b></div>";
  }).join("");
  var vs = s.trend.map(function(p){return p.value;});
  if (vs.length > 1) {
    var c = document.getElementById("trend"), x = c.getContext("2d");
    x.strokeStyle = "#4ade80"; x.beginPath();
    vs.forEach(function(v, i){ var px = i / (vs.length - 1) * c.width, py = c.height - v / 100 * (c.height - 10) - 5; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  } else document.getElementById("tmsg").textContent = "Trend appears after a few measurements.";
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
  el.innerHTML = j.impacts.map(function(f, idx) {
    var head = "<h2 style='margin-top:14px'>" + f.factor.replace(/</g,"&lt;") + "</h2><p class='sub'>" + f.nWith + " days with · " + f.nWithout + " days without</p>";
    if (!f.enoughData) return head + "<p class='sub'>Not enough data yet — keep logging this factor and measuring.</p>";
    return head + "<div id='f" + idx + "'>" + metricRow("HRV · RMSSD", f.metrics.rmssd, false) + metricRow("Battery", f.metrics.battery, false) + metricRow("Stress", f.metrics.stress, true) + "</div>";
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
