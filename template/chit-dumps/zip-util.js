import zlib from "zlib";
import { promisify } from "util";

const deflateRawAsync = promisify(zlib.deflateRaw);
const inflateRawAsync = promisify(zlib.inflateRaw);

// Minimal ZIP (PKZIP) utilities with zero dependencies.
// Supports reading/writing a ZIP containing exactly one file.

const SIG_LOCAL_FILE = 0x04034b50;
const SIG_CENTRAL_DIR = 0x02014b50;
const SIG_END_CENTRAL_DIR = 0x06054b50;

function u16(buf, off) {
  return buf.readUInt16LE(off);
}

function u32(buf, off) {
  return buf.readUInt32LE(off);
}

function writeU16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function writeU32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

// CRC32 implementation (table-driven)
let CRC32_TABLE = null;

function crc32Table() {
  if (CRC32_TABLE) return CRC32_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  CRC32_TABLE = table;
  return table;
}

export function crc32(buf) {
  const table = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isZipBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

/**
 * Create a ZIP buffer that contains EXACTLY one file.
 *
 * - No data descriptor
 * - No encryption
 * - UTF-8 filename flag set
 */
export function createSingleFileZip(filename, data, options = {}) {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("ZIP filename must be a non-empty string");
  }
  if (!Buffer.isBuffer(data)) {
    throw new Error("ZIP data must be a Buffer");
  }

  // Allow opting out of ZIP compression to reduce CPU spikes.
  // (ZIP size grows slightly, but avoids deflate cost.)
  const envNoZipCompress = String(process.env.ZIP_NO_COMPRESS || "") === "1";
  const compress = !envNoZipCompress && options.compress !== false;
  const nameBuf = Buffer.from(filename, "utf8");

  const crc = crc32(data);
  const uncompressedSize = data.length;
  const method = compress ? 8 : 0; // 8 = deflate, 0 = store

  const payload = compress ? zlib.deflateRawSync(data) : data;
  const compressedSize = payload.length;

  // Local file header
  // https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
  const localHeader = Buffer.concat([
    writeU32(SIG_LOCAL_FILE),
    writeU16(20), // version needed
    writeU16(0x0800), // general purpose bit flag (UTF-8)
    writeU16(method),
    writeU16(0), // mod time
    writeU16(0), // mod date
    writeU32(crc),
    writeU32(compressedSize),
    writeU32(uncompressedSize),
    writeU16(nameBuf.length),
    writeU16(0), // extra length
    nameBuf
  ]);

  const localOffset = 0;
  const fileRecord = Buffer.concat([localHeader, payload]);

  // Central directory header
  const centralHeader = Buffer.concat([
    writeU32(SIG_CENTRAL_DIR),
    writeU16(20), // version made by
    writeU16(20), // version needed
    writeU16(0x0800), // flags (UTF-8)
    writeU16(method),
    writeU16(0),
    writeU16(0),
    writeU32(crc),
    writeU32(compressedSize),
    writeU32(uncompressedSize),
    writeU16(nameBuf.length),
    writeU16(0), // extra
    writeU16(0), // comment
    writeU16(0), // disk start
    writeU16(0), // internal attrs
    writeU32(0), // external attrs
    writeU32(localOffset),
    nameBuf
  ]);

  const centralDirOffset = fileRecord.length;
  const centralDirSize = centralHeader.length;

  // End of central directory
  const end = Buffer.concat([
    writeU32(SIG_END_CENTRAL_DIR),
    writeU16(0), // disk number
    writeU16(0), // disk with central
    writeU16(1), // entries on this disk
    writeU16(1), // total entries
    writeU32(centralDirSize),
    writeU32(centralDirOffset),
    writeU16(0) // comment length
  ]);

  return Buffer.concat([fileRecord, centralHeader, end]);
}

/**
 * Async variant to avoid blocking the event loop during deflate.
 */
export async function createSingleFileZipAsync(filename, data, options = {}) {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("ZIP filename must be a non-empty string");
  }
  if (!Buffer.isBuffer(data)) {
    throw new Error("ZIP data must be a Buffer");
  }

  const envNoZipCompress = String(process.env.ZIP_NO_COMPRESS || "") === "1";
  const compress = !envNoZipCompress && options.compress !== false;
  const nameBuf = Buffer.from(filename, "utf8");

  const crc = crc32(data);
  const uncompressedSize = data.length;
  const method = compress ? 8 : 0;

  const payload = compress ? await deflateRawAsync(data) : data;
  const compressedSize = payload.length;

  const localHeader = Buffer.concat([
    writeU32(SIG_LOCAL_FILE),
    writeU16(20),
    writeU16(0x0800),
    writeU16(method),
    writeU16(0),
    writeU16(0),
    writeU32(crc),
    writeU32(compressedSize),
    writeU32(uncompressedSize),
    writeU16(nameBuf.length),
    writeU16(0),
    nameBuf
  ]);

  const localOffset = 0;
  const fileRecord = Buffer.concat([localHeader, payload]);

  const centralHeader = Buffer.concat([
    writeU32(SIG_CENTRAL_DIR),
    writeU16(20),
    writeU16(20),
    writeU16(0x0800),
    writeU16(method),
    writeU16(0),
    writeU16(0),
    writeU32(crc),
    writeU32(compressedSize),
    writeU32(uncompressedSize),
    writeU16(nameBuf.length),
    writeU16(0),
    writeU16(0),
    writeU16(0),
    writeU16(0),
    writeU32(0),
    writeU32(localOffset),
    nameBuf
  ]);

  const centralDirOffset = fileRecord.length;
  const centralDirSize = centralHeader.length;

  const end = Buffer.concat([
    writeU32(SIG_END_CENTRAL_DIR),
    writeU16(0),
    writeU16(0),
    writeU16(1),
    writeU16(1),
    writeU32(centralDirSize),
    writeU32(centralDirOffset),
    writeU16(0)
  ]);

  return Buffer.concat([fileRecord, centralHeader, end]);
}

/**
 * Extract the single file from a ZIP.
 * Enforces EXACTLY ONE entry named `dump.txt`.
 */
export function extractSingleFileZip(zipBuffer, requiredName = "dump.txt") {
  if (!isZipBuffer(zipBuffer)) {
    throw new Error("Not a ZIP buffer");
  }

  // Parse first local header
  let off = 0;
  const sig = u32(zipBuffer, off);
  if (sig !== SIG_LOCAL_FILE) throw new Error("ZIP missing local file header");
  off += 4;

  const versionNeeded = u16(zipBuffer, off);
  off += 2;
  void versionNeeded;

  const flags = u16(zipBuffer, off);
  off += 2;
  const method = u16(zipBuffer, off);
  off += 2;
  off += 2; // mod time
  off += 2; // mod date
  const crc = u32(zipBuffer, off);
  off += 4;
  const compSize = u32(zipBuffer, off);
  off += 4;
  const uncompSize = u32(zipBuffer, off);
  off += 4;
  const nameLen = u16(zipBuffer, off);
  off += 2;
  const extraLen = u16(zipBuffer, off);
  off += 2;

  // We don't support data descriptors. If bit 3 is set, sizes/crc may be 0 here.
  if (flags & 0x0008) {
    throw new Error("ZIP uses data descriptor (unsupported)");
  }

  const name = zipBuffer.slice(off, off + nameLen).toString("utf8");
  off += nameLen;
  off += extraLen;

  if (name !== requiredName) {
    throw new Error(`ZIP entry must be ${requiredName}`);
  }

  const dataStart = off;
  const dataEnd = dataStart + compSize;
  if (dataEnd > zipBuffer.length) {
    throw new Error("ZIP entry data out of bounds");
  }

  let fileData = zipBuffer.slice(dataStart, dataEnd);
  off = dataEnd;

  // Ensure there is not a second local header before central directory
  // (multipart zips forbidden)
  for (let scan = off; scan + 4 <= zipBuffer.length; scan++) {
    const s = zipBuffer.readUInt32LE(scan);
    if (s === SIG_LOCAL_FILE) {
      throw new Error("ZIP contains multiple entries (forbidden)");
    }
    if (s === SIG_CENTRAL_DIR || s === SIG_END_CENTRAL_DIR) {
      break;
    }
  }

  if (method === 0) {
    // stored
    if (fileData.length !== uncompSize) {
      throw new Error("ZIP stored size mismatch");
    }
  } else if (method === 8) {
    // deflate
    fileData = zlib.inflateRawSync(fileData);
    if (fileData.length !== uncompSize) {
      throw new Error("ZIP inflate size mismatch");
    }
  } else {
    throw new Error(`Unsupported ZIP compression method: ${method}`);
  }

  const computed = crc32(fileData);
  if ((computed >>> 0) !== (crc >>> 0)) {
    throw new Error("ZIP CRC32 mismatch");
  }

  return { name, data: fileData };
}

/**
 * Async variant to avoid blocking during inflate.
 */
export async function extractSingleFileZipAsync(zipBuffer, requiredName = "dump.txt") {
  if (!isZipBuffer(zipBuffer)) {
    throw new Error("Not a ZIP buffer");
  }

  let off = 0;
  const sig = u32(zipBuffer, off);
  if (sig !== SIG_LOCAL_FILE) throw new Error("ZIP missing local file header");
  off += 4;

  const versionNeeded = u16(zipBuffer, off);
  off += 2;
  void versionNeeded;

  const flags = u16(zipBuffer, off);
  off += 2;
  const method = u16(zipBuffer, off);
  off += 2;
  off += 2;
  off += 2;
  const crc = u32(zipBuffer, off);
  off += 4;
  const compSize = u32(zipBuffer, off);
  off += 4;
  const uncompSize = u32(zipBuffer, off);
  off += 4;
  const nameLen = u16(zipBuffer, off);
  off += 2;
  const extraLen = u16(zipBuffer, off);
  off += 2;

  if (flags & 0x0008) {
    throw new Error("ZIP uses data descriptor (unsupported)");
  }

  const name = zipBuffer.slice(off, off + nameLen).toString("utf8");
  off += nameLen;
  off += extraLen;

  if (name !== requiredName) {
    throw new Error(`ZIP entry must be ${requiredName}`);
  }

  const dataStart = off;
  const dataEnd = dataStart + compSize;
  if (dataEnd > zipBuffer.length) {
    throw new Error("ZIP entry data out of bounds");
  }

  let fileData = zipBuffer.slice(dataStart, dataEnd);
  off = dataEnd;

  for (let scan = off; scan + 4 <= zipBuffer.length; scan++) {
    const s = zipBuffer.readUInt32LE(scan);
    if (s === SIG_LOCAL_FILE) {
      throw new Error("ZIP contains multiple entries (forbidden)");
    }
    if (s === SIG_CENTRAL_DIR || s === SIG_END_CENTRAL_DIR) {
      break;
    }
  }

  if (method === 0) {
    if (fileData.length !== uncompSize) {
      throw new Error("ZIP stored size mismatch");
    }
  } else if (method === 8) {
    fileData = await inflateRawAsync(fileData);
    if (fileData.length !== uncompSize) {
      throw new Error("ZIP inflate size mismatch");
    }
  } else {
    throw new Error(`Unsupported ZIP compression method: ${method}`);
  }

  const computed = crc32(fileData);
  if ((computed >>> 0) !== (crc >>> 0)) {
    throw new Error("ZIP CRC32 mismatch");
  }

  return { name, data: fileData };
}
