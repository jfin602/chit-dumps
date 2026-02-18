#!/usr/bin/env node
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { TOOLCHAIN_VERSION } from "./toolchain-version.js";
import { extractSingleFileZip } from "./zip-util.js";
import { readRepoStateSync, validateChangelog } from "./changelog.js";

const HEADER_V1 = "CHITDUMPv1\n";
const HEADER_V2 = "CHITDUMPv2\n";
const PAYLOAD_MARKER = "\n---PAYLOAD---\n";

const ROOT = process.cwd();
const VC_DIR = path.join(ROOT, "chit-dumps");
const VERSIONS_DIR = path.join(VC_DIR, "versions");
const CHITCONFIG_PATH = path.join(VC_DIR, ".chitconfig");

function unwrapExtracted(x) {
  if (!x) return Buffer.from("");
  if (Buffer.isBuffer(x)) return x;
  if (typeof x === "string") return Buffer.from(x, "utf8");
  if (typeof x === "object" && Buffer.isBuffer(x.data)) return x.data;
  return Buffer.from(String(x), "utf8");
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function readChitName() {
  const cfg = readJSON(CHITCONFIG_PATH) || {};
  const n = cfg.name;
  return (typeof n === "string" && n.trim()) ? n.trim() : "dump";
}

function parseSemver(v) {
  const m = String(v || "").match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function normalizeVersion(v) {
  const p = parseSemver(v);
  return p ? `v${p[0]}.${p[1]}.${p[2]}` : null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listVersionMatches(version) {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  const files = fs.readdirSync(VERSIONS_DIR);
  const vNo = String(version).replace(/^v/i, "");
  const re = new RegExp(`_v(v?${escapeRegExp(vNo)})\\.zip$`, "i");
  return files.filter((f) => re.test(f));
}

function findLatestForName(name) {
  if (!fs.existsSync(VERSIONS_DIR)) return null;
  const files = fs.readdirSync(VERSIONS_DIR);
  const safe = escapeRegExp(name);
  const re = new RegExp(`^${safe}_v(v?\\d+\\.\\d+\\.\\d+)\\.zip$`, "i");

  let best = null;
  let bestFile = null;

  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;
    const p = parseSemver(m[1]);
    if (!p) continue;
    if (!best || p[0] > best[0] || (p[0] === best[0] && p[1] > best[1]) || (p[0] === best[0] && p[1] === best[1] && p[2] > best[2])) {
      best = p;
      bestFile = f;
    }
  }

  return bestFile ? path.join(VERSIONS_DIR, bestFile) : null;
}

function isPathish(s) {
  return /[\\/]/.test(String(s));
}

function resolveDumpArg(arg) {
  if (!arg) {
    const state = readRepoStateSync(ROOT);
    const activeName = state?.active?.dumpName;
    const preferredName = activeName || readChitName();
    const latest = findLatestForName(preferredName);
    if (!latest) throw new Error(`No dump files found for "${preferredName}" in ${VERSIONS_DIR}`);
    return latest;
  }

  const s = String(arg).trim();

  if (isPathish(s)) {
    return path.isAbsolute(s) ? s : path.join(ROOT, s);
  }

  if (s.toLowerCase().endsWith(".zip")) {
    const candidate = path.join(VERSIONS_DIR, s);
    if (fs.existsSync(candidate)) return candidate;
    return path.join(ROOT, s);
  }

  const nv = normalizeVersion(s);
  if (nv) {
    const matches = listVersionMatches(nv);
    if (matches.length === 0) throw new Error(`No dump found for version ${nv} in ${VERSIONS_DIR}`);
    if (matches.length > 1) throw new Error(`Multiple dumps match ${nv}:\n  ${matches.join("\n  ")}\nSpecify a filename.`);
    return path.join(VERSIONS_DIR, matches[0]);
  }

  throw new Error(`Unrecognized argument: ${s}`);
}

function parseDumpText(dumpText) {
  // Be tolerant of BOM/leading whitespace that can appear from editors/transfers.
  let dt = String(dumpText ?? "");
  if (dt.charCodeAt(0) === 0xfeff) dt = dt.slice(1);
  dt = dt.replace(/^\s+/, "");

  const header = dt.startsWith(HEADER_V1) ? HEADER_V1 : (dt.startsWith(HEADER_V2) ? HEADER_V2 : null);
  if (!header) throw new Error("Invalid dump header");

  const body = dt.slice(header.length);
  const splitIndex = body.indexOf(PAYLOAD_MARKER);
  if (splitIndex === -1) throw new Error("Missing payload marker");

  const metaText = body.slice(0, splitIndex);
  const payloadText = body.slice(splitIndex + PAYLOAD_MARKER.length);

  if (!metaText.trim().startsWith("{")) throw new Error("Missing/invalid meta JSON");
  if (!payloadText || payloadText.length < 10) throw new Error("Missing/invalid payload");

  const meta = JSON.parse(metaText);
  if (!meta.version) throw new Error("Missing meta.version");
  if (!meta.toolchainVersion) throw new Error("Missing meta.toolchainVersion");
  if (!meta.dumpName) throw new Error("Missing meta.dumpName");

  Buffer.from(payloadText, "base64");
  return meta;
}

function parseArgs(argv) {
  const out = { force: false, arg: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (!out.arg) out.arg = a;
  }
  return out;
}

async function main() {
  const { force, arg } = parseArgs(process.argv);
  const file = resolveDumpArg(arg);
  if (!fs.existsSync(file)) throw new Error(`Dump not found: ${file}`);

  const zipBuf = await fsp.readFile(file);
  const dumpText = extractSingleFileZip(zipBuf, "dump.txt");
  const dumpStr = unwrapExtracted(dumpText).toString("utf8");
  const meta = parseDumpText(dumpStr);

  const wantName = readChitName();
  const nameMismatch = String(meta.dumpName) !== String(wantName);
  const toolMismatch = String(meta.toolchainVersion) !== String(TOOLCHAIN_VERSION);

  if ((nameMismatch || toolMismatch) && !force) {
    console.error(`[dump:validate] dump needs repair:`);
    if (nameMismatch) console.error(`  - dumpName mismatch: dump=${meta.dumpName} expected=${wantName}`);
    if (toolMismatch) console.error(`  - toolchain mismatch: dump=${meta.toolchainVersion} local=${TOOLCHAIN_VERSION}`);
    const hint = arg && !isPathish(arg) ? arg : path.relative(ROOT, file).replace(/\\/g, "/");
    console.error(`\nRun:`);
    console.error(`  npm run dump:repair -- ${hint}`);
    process.exit(2);
  }

  // audit consistency check
  const state = readRepoStateSync(ROOT);
  await validateChangelog(ROOT, state?.active || null);

  console.log(`[dump:validate] ok: ${meta.dumpName} ${meta.version} (${meta.toolchainVersion})`);
}

const argv1 = process.argv[1];
const IS_MAIN = !!argv1 && import.meta.url === pathToFileURL(argv1).href;
if (IS_MAIN) {
  main().catch((e) => {
    console.error(`[dump:validate] failed: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
