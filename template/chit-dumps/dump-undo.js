#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import { readRepoStateSync, appendChangelogEntry } from "./changelog.js";

const ROOT = process.cwd();
const VC_DIR = path.join(ROOT, "chit-dumps");
const VERSIONS_DIR = path.join(VC_DIR, "versions");

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

async function main() {
  const state = readRepoStateSync(ROOT);
  const hist = Array.isArray(state.history) ? state.history : [];

  if (hist.length < 2) {
    throw new Error("No previous applied dump to undo to (history has <2 entries)");
  }

  const prev = hist[hist.length - 2];
  const prevFile = prev?.file;
  if (!prevFile) throw new Error("History entry missing file");

  const abs = path.join(VERSIONS_DIR, prevFile);
  mustExist(abs);

  console.warn("[dump:undo] WARNING: undo is permanent (it rewrites repo files).")
  console.log(`[dump:undo] reverting to ${prev.dumpName || ""} ${prev.version || ""} (${prevFile})`);

  const node = process.execPath;
  const applyScript = path.join(VC_DIR, "dump-apply.js");

  const r = spawnSync(node, [applyScript, abs, "--force"], { stdio: "inherit" });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }

  await appendChangelogEntry(ROOT, {
    action: "undo",
    version: String(prev.version || ""),
    dumpName: String(prev.dumpName || ""),
    file: String(prevFile || ""),
    sha256: String(prev.sha256 || ""),
    toolchainVersion: String(prev.toolchainVersion || ""),
    note: "undo via applying previous history entry",
  });
}

const argv1 = process.argv[1];
const IS_MAIN = !!argv1 && import.meta.url === pathToFileURL(argv1).href;
if (IS_MAIN) {
  main().catch((e) => {
    console.error(`[dump:undo] failed: ${String(e?.message || e)}`);
    process.exit(1);
  });
}
