#!/usr/bin/env node
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { pathToFileURL } from "url";
import { TOOLCHAIN_VERSION } from "./toolchain-version.js";
import { extractSingleFileZip, createSingleFileZip } from "./zip-util.js";
import { appendChangelogEntry, sha256Hex, readRepoStateSync } from "./changelog.js";

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

function parseArgs(argv) {
  const out = { inPlace: false, outPath: null, arg: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in-place") out.inPlace = true;
    else if (a === "--out") out.outPath = argv[++i];
    else if (!out.arg) out.arg = a;
  }
  return out;
}

function parseDump(dumpStr) {
  // Be tolerant of BOM/leading whitespace that can appear from editors/transfers.
  let ds = String(dumpStr ?? "");
  if (ds.charCodeAt(0) === 0xfeff) ds = ds.slice(1);
  ds = ds.replace(/^\s+/, "");

  const header = ds.startsWith(HEADER_V1) ? HEADER_V1 : (ds.startsWith(HEADER_V2) ? HEADER_V2 : null);
  if (!header) throw new Error("Invalid dump header");
  const body = ds.slice(header.length);
  const idx = body.indexOf(PAYLOAD_MARKER);
  if (idx === -1) throw new Error("Missing payload marker");
  const meta = JSON.parse(body.slice(0, idx));
  const payloadB64 = body.slice(idx + PAYLOAD_MARKER.length);
  return { header, meta, payloadB64 };
}

function defaultOutPath(inputAbs) {
  const dir = path.dirname(inputAbs);
  const base = path.basename(inputAbs);
  if (base.toLowerCase().endsWith(".zip")) return path.join(dir, base.replace(/\.zip$/i, ".repaired.zip"));
  return path.join(dir, base + ".repaired.zip");
}

async function main() {
  const args = parseArgs(process.argv);
  const inputFile = resolveDumpArg(args.arg);

  if (!fs.existsSync(inputFile)) throw new Error(`Dump not found: ${inputFile}`);

  const zipBuf = await fsp.readFile(inputFile);
  const dumpText = extractSingleFileZip(zipBuf, "dump.txt");
  const dumpStr = unwrapExtracted(dumpText).toString("utf8");

  const { header, meta, payloadB64 } = parseDump(dumpStr);

  // decode payload (preserve gzip)
  let payloadBuf = Buffer.from(payloadB64, "base64");
  const gzip = !!meta?.encoding?.gzip;
  if (gzip) payloadBuf = zlib.gunzipSync(payloadBuf);

  // validate payload JSON
  JSON.parse(payloadBuf.toString("utf8"));

  const old = { dumpName: meta.dumpName, toolchainVersion: meta.toolchainVersion };

  meta.dumpName = readChitName();
  meta.toolchainVersion = TOOLCHAIN_VERSION;
  meta.repairedAt = Date.now();
  meta.repairedFrom = old;

  let outPayload = payloadBuf;
  if (gzip) outPayload = zlib.gzipSync(outPayload);

  const outDumpText = header + JSON.stringify(meta) + PAYLOAD_MARKER + outPayload.toString("base64");
  const outZip = createSingleFileZip("dump.txt", Buffer.from(outDumpText, "utf8"));

  const outAbs = args.outPath
    ? (path.isAbsolute(args.outPath) ? args.outPath : path.join(ROOT, args.outPath))
    : (args.inPlace ? inputFile : defaultOutPath(inputFile));

  await fsp.mkdir(path.dirname(outAbs), { recursive: true });
  await fsp.writeFile(outAbs, outZip);

  await appendChangelogEntry(ROOT, {
    action: "repair",
    version: String(meta.version || ""),
    dumpName: String(meta.dumpName || ""),
    file: path.basename(outAbs),
    sha256: sha256Hex(outZip),
    toolchainVersion: String(meta.toolchainVersion || ""),
    note: `Repaired meta (dumpName/toolchain) from ${old.dumpName || ""} / ${old.toolchainVersion || ""}`,
  });

  console.log(`[dump:repair] ok`);
  console.log(`  in : ${inputFile}`);
  console.log(`  out: ${outAbs}`);
  console.log(`  dumpName: ${meta.dumpName}`);
  console.log(`  version: ${meta.version}`);
  console.log(`  toolchainVersion: ${meta.toolchainVersion}`);
}

const argv1 = process.argv[1];
const IS_MAIN = !!argv1 && import.meta.url === pathToFileURL(argv1).href;
if (IS_MAIN) {
  main().catch((e) => {
    console.error(`[dump:repair] failed: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
