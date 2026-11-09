#!/usr/bin/env node
/**
 * public-guard — personal-data + secret guard for PUBLIC repos.
 *
 * Scans tracked files for content that must never be pushed publicly:
 * genetic results, dates of birth, military documents, health-record
 * artifacts, Drive file links, and common secret shapes. Personal name
 * literals are read from a machine-local denylist that is NEVER
 * committed: ~/.config/public-guard/denylist.txt (one literal per line,
 * # comments). An optional repo-local .public-guard-denylist can hold
 * non-sensitive project terms.
 *
 * Usage:
 *   node scripts/public-guard.mjs            scan all tracked files
 *   node scripts/public-guard.mjs --files a b  scan specific files
 *   (pre-push hook) reads pushed refs on stdin and scans HEAD's tree
 *
 * Escape hatch per line: append the marker  public-guard:allow
 * Exit 0 = clean, 1 = findings (printed), 2 = usage error.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RULES = [
  { id: "apoe-diplotype", re: /ε[1-4]\s*\/\s*ε[1-4]/, why: "APOE diplotype (genetic result)" },
  { id: "snp-genotype-pair", re: /rs\d{3,}\"?\s*[:=]\s*\"?[ACGT]{2}\b/, why: "SNP id paired with a genotype call" },
  { id: "dob-field", re: /("dob"|\bdob\b|date of birth)\s*[:=]\s*"?\d{4}-\d{2}-\d{2}/i, why: "date of birth value" },
  { id: "military-doc", re: /DD-?21[45]\b|Certificate of Release or Discharge/i, why: "military separation document reference" },
  { id: "health-artifact", re: /imported_health_records|Genome-Master|genome_[A-Za-z_]+\.txt|health_records\.zip/i, why: "health-record / genome artifact reference" },
  { id: "drive-file-link", re: /drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{20,}|drive\.google\.com\/open\?id=[A-Za-z0-9_-]{20,}/, why: "Google Drive file link (id can expose private files)" },
  { id: "aws-key", re: /AKIA[0-9A-Z]{16}/, why: "AWS access key id" },
  { id: "gh-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/, why: "GitHub token" },
  { id: "sk-key", re: /\bsk-[A-Za-z0-9-]{20,}/, why: "API secret key" },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: "private key block" },
  { id: "generic-secret", re: /"(api[_-]?key|client[_-]?secret|access[_-]?token|password)"\s*[:=]\s*"[^"<]{12,}"/i, why: "secret-looking assignment (value redacted in report)" },
];

const SKIP_FILES = new Set(["scripts/public-guard.mjs", "package-lock.json"]);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp3|mp4|mov)$/i;

function loadDenylist() {
  const literals = [];
  const candidates = [
    join(homedir(), ".config", "public-guard", "denylist.txt"),
    join(process.cwd(), ".public-guard-denylist"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const v = line.trim();
        if (v && !v.startsWith("#")) literals.push(v);
      }
    }
  }
  return literals;
}

function scanFile(path, literals) {
  let buf;
  try { buf = readFileSync(path); } catch { return []; }
  if (buf.includes(0)) return []; // binary
  const text = buf.toString("utf8");
  const hits = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes("public-guard:allow")) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push({ path, line: i + 1, rule: rule.id, why: rule.why });
    }
    for (const lit of literals) {
      if (line.includes(lit)) hits.push({ path, line: i + 1, rule: "denylist", why: "machine-local denylist literal" });
    }
  });
  return hits;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

const args = process.argv.slice(2);
let files;
if (args[0] === "--files") files = args.slice(1);
else files = trackedFiles();
files = files.filter((f) => !SKIP_FILES.has(f) && !SKIP_EXT.test(f));

const literals = loadDenylist();
const all = files.flatMap((f) => scanFile(f, literals));
if (all.length) {
  console.error(`public-guard: BLOCKED — ${all.length} finding(s):`);
  for (const h of all) console.error(`  ${h.path}:${h.line}  [${h.rule}] ${h.why}`);
  console.error("Remove the content, or mark a true false positive with: public-guard:allow");
  process.exit(1);
}
console.log(`public-guard: clean (${files.length} files scanned, ${literals.length} denylist literals loaded)`);
