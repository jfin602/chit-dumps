#!/usr/bin/env node
/**
 * chit-dumps CLI
 *
 * Primary command:
 *   chit-dumps init [--dir <path>] [--force]
 *
 * Copies the bundled template/chit-dumps folder into a target project root
 * and (optionally) patches the target package.json scripts.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PKG_PATH = path.join(__dirname, 'package.json');
const TEMPLATE_DIR = path.join(__dirname, 'template', 'chit-dumps');

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function usage(code = 0) {
  const v = readPkgVersion();
  const msg = `\nchit-dumps v${v}\n\nUsage:\n  chit-dumps init [--dir <projectRoot>] [--force]\n\nExamples:\n  chit-dumps init\n  chit-dumps init --dir /path/to/project\n  chit-dumps init --force\n`;
  (code === 0 ? console.log : console.error)(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { cmd: null, dir: process.cwd(), force: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!out.cmd && !a.startsWith('-')) {
      out.cmd = a;
      continue;
    }
    if (a === '--dir' || a === '-d') {
      out.dir = args[++i] || out.dir;
    } else if (a === '--force' || a === '-f') {
      out.force = true;
    } else if (a === '--help' || a === '-h') {
      usage(0);
    }
  }

  return out;
}

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 25; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function copyDir(src, dest, force) {
  if (!fs.existsSync(src)) {
    throw new Error(`Template missing: ${src}`);
  }

  if (fs.existsSync(dest)) {
    if (!force) {
      throw new Error(`Refusing to overwrite existing ${dest}. Use --force to overwrite.`);
    }
    await fsp.rm(dest, { recursive: true, force: true });
  }

  await ensureDir(path.dirname(dest));
  await fsp.cp(src, dest, { recursive: true });
}

function patchPackageJsonScripts(targetRoot) {
  const pkgPath = path.join(targetRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.warn('[chit-dumps:init] No package.json found; skipping script injection.');
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    console.warn('[chit-dumps:init] Could not parse package.json; skipping script injection.');
    return;
  }

  pkg.scripts = pkg.scripts || {};

  const desired = {
    'dump:generate': 'node ./chit-dumps/dump-generate.js',
    'dump:apply': 'node ./chit-dumps/dump-apply.js',
    'dump:validate': 'node ./chit-dumps/dump-validator.js',
    'dump:undo': 'node ./chit-dumps/dump-undo.js',
    'dump:repair': 'node ./chit-dumps/dump-repair.js',
    'dump:active': 'node ./chit-dumps/print-active.js'
  };

  for (const [k, v] of Object.entries(desired)) {
    pkg.scripts[k] = v;
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

async function cmdInit(dir, force) {
  const root = findRepoRoot(dir);
  if (!root) {
    throw new Error(`Could not find a package.json above: ${dir}`);
  }

  const dest = path.join(root, 'chit-dumps');
  await copyDir(TEMPLATE_DIR, dest, force);

  // Ensure versions folder exists
  await ensureDir(path.join(dest, 'versions'));

  // Inject scripts into target package.json
  patchPackageJsonScripts(root);

  console.log('[chit-dumps:init] Installed chit-dumps/ into: ' + root);
  console.log('[chit-dumps:init] Scripts added to package.json.');
  console.log('Next: npm run dump:generate');
}

async function main() {
  const { cmd, dir, force } = parseArgs(process.argv);

  if (!cmd) usage(1);

  if (cmd === 'init') {
    await cmdInit(dir, force);
    return;
  }

  if (cmd === 'help' || cmd === '--help') usage(0);

  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

main().catch((e) => {
  console.error('[chit-dumps] Error:', String(e?.message || e));
  process.exit(1);
});
