// chit-dumps/collect-files.js
import fs from "fs";
import path from "path";

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Hard excludes — NEVER part of a dump
 * (toolchain + its versions/state are always excluded)
 */
const HARD_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "chit-dumps", // excludes toolchain + chit-dumps/versions
]);

const HARD_EXCLUDE_FILES = new Set([
  "dump.txt",
]);

export function collectFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (HARD_EXCLUDE_DIRS.has(name)) continue;
      if (HARD_EXCLUDE_FILES.has(name)) continue;

      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) walk(fullPath);
      else if (stat.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        files.push(rel);
      }
    }
  }

  walk(rootDir);
  files.sort();
  return files;
}

export async function collectFilesAsync(rootDir, options = {}) {
  const yieldEvery = Math.max(1, Number(options.yieldEvery || process.env.DUMP_YIELD_EVERY || 250));
  const files = [];
  let visited = 0;

  async function walk(dir) {
    const names = await fs.promises.readdir(dir);
    for (const name of names) {
      if (HARD_EXCLUDE_DIRS.has(name)) continue;
      if (HARD_EXCLUDE_FILES.has(name)) continue;

      const fullPath = path.join(dir, name);
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) await walk(fullPath);
      else if (stat.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        files.push(rel);
      }

      visited++;
      if (visited % yieldEvery === 0) await yieldToLoop();
    }
  }

  await walk(rootDir);
  files.sort();
  return files;
}

export default collectFiles;
