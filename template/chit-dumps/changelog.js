// chit-dumps/changelog.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

function vcDir(repoRoot) {
  return path.join(repoRoot, "chit-dumps");
}

export function getChangelogPath(repoRoot) {
  return path.join(vcDir(repoRoot), ".changelog.json");
}

export function getRepoStatePath(repoRoot) {
  return path.join(vcDir(repoRoot), ".repo_state.json");
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function readChangelog(repoRoot) {
  const p = getChangelogPath(repoRoot);
  try {
    const raw = await fsp.readFile(p, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("bad root");
    if (!Array.isArray(data.entries)) data.entries = [];
    if (typeof data.schema !== "number") data.schema = 1;
    return data;
  } catch {
    return { schema: 1, entries: [] };
  }
}

export async function writeChangelog(repoRoot, data) {
  const p = getChangelogPath(repoRoot);
  const safe = {
    schema: 1,
    entries: Array.isArray(data?.entries) ? data.entries : [],
  };
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(safe, null, 2), "utf8");
}

export function normalizeEntry(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  return {
    at: typeof e.at === "string" ? e.at : new Date().toISOString(),
    action: typeof e.action === "string" ? e.action : "unknown",
    version: typeof e.version === "string" ? e.version : "",
    dumpName: typeof e.dumpName === "string" ? e.dumpName : "",
    file: typeof e.file === "string" ? e.file : "",
    sha256: typeof e.sha256 === "string" ? e.sha256 : "",
    toolchainVersion: typeof e.toolchainVersion === "string" ? e.toolchainVersion : "",
    note: typeof e.note === "string" ? e.note : "",
  };
}

export async function appendChangelogEntry(repoRoot, entry) {
  const data = await readChangelog(repoRoot);
  const e = normalizeEntry(entry);

  const last = data.entries[data.entries.length - 1];
  if (last && last.action === e.action && last.version === e.version && last.sha256 === e.sha256) return;

  data.entries.push(e);
  if (data.entries.length > 5000) data.entries = data.entries.slice(-5000);
  await writeChangelog(repoRoot, data);
}

export function readRepoStateSync(repoRoot) {
  const p = getRepoStatePath(repoRoot);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") throw new Error("bad");
    if (!obj.history || !Array.isArray(obj.history)) obj.history = [];
    if (!obj.active || typeof obj.active !== "object") obj.active = null;
    return obj;
  } catch {
    return { active: null, history: [] };
  }
}

export async function writeRepoState(repoRoot, state) {
  const p = getRepoStatePath(repoRoot);
  const safe = {
    active: state?.active || null,
    history: Array.isArray(state?.history) ? state.history : [],
  };
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(safe, null, 2), "utf8");
}

export function validateChangelogObject(obj) {
  if (!obj || typeof obj !== "object") throw new Error(".changelog.json invalid (not an object)");
  if (!Array.isArray(obj.entries)) throw new Error(".changelog.json invalid (missing entries array)");
  for (let i = 0; i < obj.entries.length; i++) {
    const e = obj.entries[i];
    if (!e || typeof e !== "object") throw new Error(`.changelog.json invalid entry at index ${i}`);
    if (typeof e.at !== "string") throw new Error(`.changelog.json invalid entry.at at index ${i}`);
    if (typeof e.action !== "string") throw new Error(`.changelog.json invalid entry.action at index ${i}`);
  }
  return true;
}

export async function validateChangelog(repoRoot, expectedActive = null) {
  const p = getChangelogPath(repoRoot);
  if (!fs.existsSync(p)) throw new Error("Missing .changelog.json");
  const raw = await fsp.readFile(p, "utf8");
  const obj = JSON.parse(raw);
  validateChangelogObject(obj);

  if (expectedActive?.version) {
    const found = [...obj.entries].reverse().find((e) => e && e.version === expectedActive.version && (e.action === "apply" || e.action === "undo"));
    if (!found) throw new Error(`Active version ${expectedActive.version} not found in .changelog.json`);
  }

  return obj;
}
