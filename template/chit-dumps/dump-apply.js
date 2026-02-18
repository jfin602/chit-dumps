#!/usr/bin/env node
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import zlib from "zlib";
import { TOOLCHAIN_VERSION } from "./toolchain-version.js";
import { extractSingleFileZip } from "./zip-util.js";
import { appendChangelogEntry, sha256Hex, readRepoStateSync, writeRepoState } from "./changelog.js";

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

function uniqueDumpNamesInVersions() {
  if (!fs.existsSync(VERSIONS_DIR)) return [];
  const files = fs.readdirSync(VERSIONS_DIR);
  const names = new Set();
  for (const f of files) {
    const m = f.match(/^(.+)_v(v?\d+\.\d+\.\d+)\.zip$/i);
    if (m) names.add(m[1]);
  }
  return [...names];
}

function isPathish(s) {
  return /[\\/]/.test(String(s));
}

function warnUnneededPrefix(arg) {
  const normalized = String(arg).replace(/\\/g, "/");
  if (normalized.startsWith("chit-dumps/versions/") || normalized.startsWith("./chit-dumps/versions/")) {
    const justFile = normalized.split("/").slice(-1)[0];
    console.warn(`[dump:apply] note: you don't need to type chit-dumps/versions/. Example: npm run dump:apply -- ${justFile}`);
  }
}

function resolveDumpArg(arg) {
  // null => latest
  if (!arg) {
    // Prefer active dumpName if present
    const state = readRepoStateSync(ROOT);
    const activeName = state?.active?.dumpName;
    const preferredName = activeName || readChitName();

    let latest = findLatestForName(preferredName);
    if (latest) return { file: latest, resolvedFrom: `latest:${preferredName}` };

    // fallback: if only one dumpName exists, use it
    const names = uniqueDumpNamesInVersions();
    if (names.length === 1) {
      console.warn(`[dump:apply] warning: no dumps found for "${preferredName}"; using "${names[0]}" found in versions/`);
      latest = findLatestForName(names[0]);
      if (latest) return { file: latest, resolvedFrom: `latest:${names[0]}` };
    }

    throw new Error(`No dump files found for "${preferredName}" in ${VERSIONS_DIR}`);
  }

  const s = String(arg).trim();

  // Absolute or other-dir path
  if (isPathish(s)) {
    warnUnneededPrefix(s);
    const abs = path.isAbsolute(s) ? s : path.join(ROOT, s);
    return { file: abs, resolvedFrom: "path" };
  }

  // filename
  if (s.toLowerCase().endsWith(".zip")) {
    const candidate = path.join(VERSIONS_DIR, s);
    if (fs.existsSync(candidate)) return { file: candidate, resolvedFrom: "file" };
    // maybe they gave full file name from elsewhere
    return { file: path.join(ROOT, s), resolvedFrom: "file-rel" };
  }

  // version only
  const nv = normalizeVersion(s);
  if (nv) {
    const matches = listVersionMatches(nv);
    if (matches.length === 0) throw new Error(`No dump found for version ${nv} in ${VERSIONS_DIR}`);
    if (matches.length > 1) {
      throw new Error(`Multiple dumps match ${nv}:\n  ${matches.join("\n  ")}\nSpecify a filename, e.g. npm run dump:apply -- ${matches[0]}`);
    }
    return { file: path.join(VERSIONS_DIR, matches[0]), resolvedFrom: `version:${nv}` };
  }

  throw new Error(`Unrecognized argument: ${s}`);
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

function parseDumpText(dumpText) {
  // Be tolerant of BOM/leading whitespace that can appear from editors/transfers.
  let dt = String(dumpText ?? "");
  if (dt.charCodeAt(0) === 0xfeff) dt = dt.slice(1);
  dt = dt.replace(/^\s+/, "");

  const header = dt.startsWith(HEADER_V1)
    ? HEADER_V1
    : (dt.startsWith(HEADER_V2) ? HEADER_V2 : null);
  if (!header) throw new Error("Invalid dump header");

  const body = dt.slice(header.length);
  const splitIndex = body.indexOf(PAYLOAD_MARKER);
  if (splitIndex === -1) throw new Error("Missing payload marker");

  const metaText = body.slice(0, splitIndex);
  const payloadText = body.slice(splitIndex + PAYLOAD_MARKER.length);

  const meta = JSON.parse(metaText);
  if (!meta?.version) throw new Error("Missing meta.version");
  if (!meta?.toolchainVersion) throw new Error("Missing meta.toolchainVersion");
  if (!meta?.dumpName) throw new Error("Missing meta.dumpName");

  // payload should be base64 decodable
  Buffer.from(payloadText, "base64");

  return { meta, payloadText, header };
}

function needsRepair(meta) {
  const wantName = readChitName();
  const nameMismatch = String(meta.dumpName) !== String(wantName);
  const toolMismatch = String(meta.toolchainVersion) !== String(TOOLCHAIN_VERSION);
  return { nameMismatch, toolMismatch, wantName };
}

async function applyDumpToRepo(payloadObj) {
  // payloadObj: { dirs, exts, files }
  const dirs = Array.isArray(payloadObj?.dirs) ? payloadObj.dirs : [];
  const files = Array.isArray(payloadObj?.files) ? payloadObj.files : [];

  for (const entry of files) {
    const [dirId, base, _extId, content] = entry;
    const relDir = dirs[dirId] || ".";
    const relPath = path.join(relDir, base).replace(/\\/g, "/");

    // never write into chit-dumps
    if (relPath === "chit-dumps" || relPath.startsWith("chit-dumps/")) continue;

    const abs = path.join(ROOT, relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, String(content ?? ""), "utf8");
  }
}

async function main() {
  const { force, arg } = parseArgs(process.argv);
  const resolved = resolveDumpArg(arg);

  if (!fs.existsSync(resolved.file)) {
    throw new Error(`Dump not found: ${resolved.file}`);
  }

  const zipBuf = await fsp.readFile(resolved.file);
  const dumpText = extractSingleFileZip(zipBuf, "dump.txt");
  const dumpStr = unwrapExtracted(dumpText).toString("utf8");

  const { meta, payloadText } = parseDumpText(dumpStr);

  const repair = needsRepair(meta);
  if (repair.nameMismatch || repair.toolMismatch) {
    console.error(`[dump:apply] dump needs repair before apply:`);
    if (repair.nameMismatch) console.error(`  - dumpName mismatch: dump=${meta.dumpName} expected=${repair.wantName}`);
    if (repair.toolMismatch) console.error(`  - toolchain mismatch: dump=${meta.toolchainVersion} local=${TOOLCHAIN_VERSION}`);

    // force does NOT bypass repair
    const hintArg = arg && !isPathish(arg) ? arg : path.relative(ROOT, resolved.file).replace(/\\/g, "/");
    console.error(`\nRun:`);
    console.error(`  npm run dump:repair -- ${hintArg}`);
    process.exit(2);
  }

  // version regression checks can be bypassed by --force
  const state = readRepoStateSync(ROOT);
  const activeVer = state?.active?.version;
  if (!force && activeVer) {
    const a = parseSemver(activeVer);
    const b = parseSemver(meta.version);
    if (a && b) {
      const regresses = (b[0] < a[0]) || (b[0] === a[0] && b[1] < a[1]) || (b[0] === a[0] && b[1] === a[1] && b[2] < a[2]);
      if (regresses) throw new Error(`Refusing to apply older version ${meta.version} over active ${activeVer} (use --force to override)`);
    }
  }

  // parse payload
  const payloadBuf = Buffer.from(payloadText, "base64");
  const decoded = meta?.encoding?.gzip ? zlib.gunzipSync(payloadBuf) : payloadBuf;
  const payloadObj = JSON.parse(decoded.toString("utf8"));

  await applyDumpToRepo(payloadObj);

  const sha = sha256Hex(zipBuf);

  // update state
  const next = readRepoStateSync(ROOT);
  const hist = Array.isArray(next.history) ? next.history.slice(-49) : [];
  hist.push({
    version: meta.version,
    dumpName: meta.dumpName,
    file: path.basename(resolved.file),
    sha256: sha,
    action: "apply",
    appliedAt: new Date().toISOString(),
    toolchainVersion: meta.toolchainVersion,
  });

  next.active = {
    version: meta.version,
    dumpName: meta.dumpName,
    toolchainVersion: meta.toolchainVersion,
    appliedAt: new Date().toISOString(),
  };
  next.history = hist;

  await writeRepoState(ROOT, next);
  await appendChangelogEntry(ROOT, {
    action: "apply",
    version: meta.version,
    dumpName: meta.dumpName,
    file: path.basename(resolved.file),
    sha256: sha,
    toolchainVersion: meta.toolchainVersion,
    note: force ? "forced" : "",
  });

  console.log(`[dump:apply] applied ${meta.dumpName} ${meta.version}${force ? " (forced)" : ""}`);
}

const argv1 = process.argv[1];
const IS_MAIN = !!argv1 && import.meta.url === pathToFileURL(argv1).href;
if (IS_MAIN) {
  main().catch((e) => {
    console.error(`[dump:apply] failed: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
