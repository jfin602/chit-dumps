#!/usr/bin/env node
/**
 * prepare script
 *
 * Runs on "npm prepare" / prepublish. Ensures the bundled template is clean and
 * version-aligned for publishing.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PKG_PATH = path.join(ROOT, 'package.json');
const TEMPLATE = path.join(ROOT, 'template', 'chit-dumps');
const TOOLCHAIN_VERSION_PATH = path.join(TEMPLATE, 'toolchain-version.js');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeText(p, s) {
  fs.writeFileSync(p, s);
}

function ensureExists(p, label) {
  if (!fs.existsSync(p)) throw new Error(`Missing ${label}: ${p}`);
}

async function rmIfExists(p) {
  if (fs.existsSync(p)) await fsp.rm(p, { recursive: true, force: true });
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function setToolchainVersion(version) {
  const expected = `export const TOOLCHAIN_VERSION = "v${version}";\n`;
  if (!fs.existsSync(TOOLCHAIN_VERSION_PATH)) {
    throw new Error(`Missing toolchain-version.js in template: ${TOOLCHAIN_VERSION_PATH}`);
  }
  const cur = fs.readFileSync(TOOLCHAIN_VERSION_PATH, 'utf8');
  if (cur !== expected) {
    writeText(TOOLCHAIN_VERSION_PATH, expected);
    console.log(`[prepare] Updated template toolchain-version.js -> v${version}`);
  }
}

async function main() {
  ensureExists(PKG_PATH, 'package.json');
  ensureExists(TEMPLATE, 'template/chit-dumps');

  const pkg = readJSON(PKG_PATH);
  const version = String(pkg.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json version must be X.Y.Z, got: ${version}`);
  }

  // Clean template state files
  await rmIfExists(path.join(TEMPLATE, '.repo_state.json'));
  await rmIfExists(path.join(TEMPLATE, '.changelog.json'));

  // Ensure empty versions directory exists (do not ship dumps)
  await rmIfExists(path.join(TEMPLATE, 'versions'));
  await ensureDir(path.join(TEMPLATE, 'versions'));

  // Ensure toolchain version matches package version
  setToolchainVersion(version);

  console.log('[prepare] OK');
}

main().catch((e) => {
  console.error('[prepare] failed:', String(e?.message || e));
  process.exit(1);
});
