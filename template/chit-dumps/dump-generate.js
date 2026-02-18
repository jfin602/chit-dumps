#!/usr/bin/env node
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import { fileURLToPath, pathToFileURL } from "url";
import { TOOLCHAIN_VERSION } from "./toolchain-version.js";
import { collectFiles } from "./collect-files.js";
import { createSingleFileZip } from "./zip-util.js";
import { appendChangelogEntry, sha256Hex } from "./changelog.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const CONCURRENCY = 8;

/* ---------------- PATHS (LOCKED TO chit-dumps/) ---------------- */

const __filename = fileURLToPath(import.meta.url);
const HEADER = "CHITDUMPv1\n";
const PAYLOAD_MARKER = "\n---PAYLOAD---\n";

const ROOT = process.cwd();
const VC_DIR = path.join(ROOT, "chit-dumps");

// IMPORTANT: .chitconfig lives ONLY inside chit-dumps/
const CHITCONFIG_PATH = path.join(VC_DIR, ".chitconfig");

// Versions folder lives inside chit-dumps/
const VERSIONS_DIR = path.join(VC_DIR, "versions");

/* ---------------- HELPERS ---------------- */

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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

function formatSemver(a, b, c) {
  return `v${a}.${b}.${c}`;
}

function bumpPatch(v) {
  const p = parseSemver(v) || [0, 0, 0];
  return formatSemver(p[0], p[1], p[2] + 1);
}

function normalizeVersion(input) {
  const p = parseSemver(input);
  if (!p) return null;
  return formatSemver(p[0], p[1], p[2]); // always vX.Y.Z
}

function versionNoV(v) {
  return String(v || "").replace(/^v/i, "");
}

// Highest version from chit-dumps/versions/<name>_vX.Y.Z.zip (also tolerates legacy name_vvX.Y.Z.zip)
function getHighestVersion(name) {
  if (!fs.existsSync(VERSIONS_DIR)) return null;

  const files = fs.readdirSync(VERSIONS_DIR);
  const re = new RegExp(`^${name}_v(v?\\d+\\.\\d+\\.\\d+)\\.zip$`, "i");

  let best = null;

  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;

    const v = normalizeVersion(m[1]);
    if (!v) continue;

    const parts = parseSemver(v);
    if (!best) best = parts;
    else {
      const b = best;
      const p = parts;
      if (
        p[0] > b[0] ||
        (p[0] === b[0] && p[1] > b[1]) ||
        (p[0] === b[0] && p[1] === b[1] && p[2] > b[2])
      ) best = p;
    }
  }

  return best ? formatSemver(best[0], best[1], best[2]) : null;
}

function parseArgs(argv) {
  const out = { force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--gzip") out.gzip = true;
    else if (a === "--force") out.force = true;
    else if (a === "--version") out.version = argv[++i];
    else if (!out.version) out.version = a;
  }
  return out;
}

function isLikelyBinary(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/* ---------------- FILE PROCESSING ---------------- */

async function processFiles(files) {
  const dirDict = [];
  const extDict = [];
  const dirMap = new Map();
  const extMap = new Map();

  function getDirId(d) {
    if (!dirMap.has(d)) {
      dirMap.set(d, dirDict.length);
      dirDict.push(d);
    }
    return dirMap.get(d);
  }

  function getExtId(e) {
    if (!extMap.has(e)) {
      extMap.set(e, extDict.length);
      extDict.push(e);
    }
    return extMap.get(e);
  }

  const payloadFiles = [];
  let processed = 0;
  const total = files.length;

  for (let start = 0; start < files.length; start += CONCURRENCY) {
    const batch = files.slice(start, start + CONCURRENCY);

    await Promise.all(
      batch.map(async (rel) => {
        const abs = path.join(ROOT, rel);

        try {
          const stats = await fsp.stat(abs);
          if (!stats.isFile()) return;
          if (stats.size > MAX_FILE_SIZE) {
            console.warn(`Skipping large file: ${rel}`);
            return;
          }

          const buffer = await fsp.readFile(abs);
          if (isLikelyBinary(buffer)) {
            console.warn(`Skipping binary file: ${rel}`);
            return;
          }

          const content = buffer.toString("utf8").replace(/[ \t]+$/gm, "");

          const dir = path.dirname(rel).replace(/\\/g, "/");
          const base = path.basename(rel);
          const ext = path.extname(base);

          payloadFiles.push([getDirId(dir), base, getExtId(ext || ""), content]);
        } catch {
          console.warn(`Skipping unreadable file: ${rel}`);
        } finally {
          processed++;
        }
      })
    );

    const pct = Math.floor((processed / total) * 100);
    process.stdout.write(`\r[dump:generate] ${pct}%`);
  }

  process.stdout.write("\n");

  return { dirs: dirDict, exts: extDict, files: payloadFiles };
}

/* ---------------- MAIN ---------------- */

const argv1 = process.argv[1];
const IS_MAIN = !!argv1 && import.meta.url === pathToFileURL(argv1).href;

if (IS_MAIN) {
  (async () => {
    const args = parseArgs(process.argv);

    if (!fs.existsSync(CHITCONFIG_PATH) && !args.force) {
      throw new Error(`Missing .chitconfig in chit-dumps/: ${CHITCONFIG_PATH}`);
    }

    const name = readChitName();

    fs.mkdirSync(VERSIONS_DIR, { recursive: true });

    let version;
    if (args.version) {
      const nv = normalizeVersion(args.version);
      if (!nv && !args.force) {
        throw new Error("Invalid version format (vX.Y.Z or X.Y.Z required)");
      }
      version = nv || String(args.version);
    } else {
      const highest = getHighestVersion(name) || "v0.0.0";
      version = bumpPatch(highest);
    }

    if (!args.force && !/^v\d+\.\d+\.\d+$/.test(version)) {
      throw new Error("Invalid version format (vX.Y.Z required)");
    }

    const fileVersion = args.force ? String(version) : versionNoV(version);
    const outPath = path.join(VERSIONS_DIR, `${name}_v${fileVersion}.zip`);

    if (fs.existsSync(outPath) && !args.version && !args.force) {
      throw new Error("Refusing overwrite without --version or --force");
    }

    const files = collectFiles(ROOT);
    const payload = await processFiles(files);

    const meta = {
      dumpName: name,
      version: args.force ? String(version) : version,
      toolchainVersion: TOOLCHAIN_VERSION,
      createdAt: Date.now(),
      encoding: { dictionary: true, gzip: !!args.gzip },
    };

    let payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
    if (args.gzip) payloadBuf = zlib.gzipSync(payloadBuf);

    const dumpText = HEADER + JSON.stringify(meta) + PAYLOAD_MARKER + payloadBuf.toString("base64");
    const dumpBuf = Buffer.from(dumpText, "utf8");
    const zipBuffer = createSingleFileZip("dump.txt", dumpBuf);

    await fsp.writeFile(outPath, zipBuffer);

    await appendChangelogEntry(ROOT, {
      action: "generate",
      version: meta.version,
      dumpName: meta.dumpName,
      file: path.basename(outPath),
      sha256: sha256Hex(zipBuffer),
      toolchainVersion: meta.toolchainVersion,
    });

    console.log(`[dump:generate] wrote ${outPath}`);
  })().catch((e) => {
    console.error(`[dump:generate] failed: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
