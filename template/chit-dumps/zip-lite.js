import fs from 'fs';
import path from 'path';

function u16(n){ const b=Buffer.alloc(2); b.writeUInt16LE(n>>>0); return b; }
function u32(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i=0;i<256;i++){
    let c=i;
    for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    t[i]=c>>>0;
  }
  return t;
})();
function crc32(buf){
  let c=0xFFFFFFFF;
  for (let i=0;i<buf.length;i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF)>>>0;
}

export default async function archiver({ root, files, outZip }) {
  const fd = await fs.promises.open(outZip, 'w');
  let offset = 0;
  const central = [];
  try {
    for (const rel of files) {
      const full = path.join(root, rel);
      const data = await fs.promises.readFile(full);
      const name = Buffer.from(rel.replace(/\\/g,'/'), 'utf8');

      const crc = crc32(data);
      const compSize = data.length;
      const uncompSize = data.length;

      const local = Buffer.concat([
        u32(0x04034b50),
        u16(20), u16(0), u16(0),
        u16(0), u16(0),
        u32(crc),
        u32(compSize),
        u32(uncompSize),
        u16(name.length),
        u16(0),
        name
      ]);
      await fd.write(local, 0, local.length, offset); offset += local.length;
      await fd.write(data, 0, data.length, offset); offset += data.length;

      const cent = Buffer.concat([
        u32(0x02014b50),
        u16(20), u16(20),
        u16(0),
        u16(0),
        u16(0), u16(0),
        u32(crc),
        u32(compSize),
        u32(uncompSize),
        u16(name.length),
        u16(0), u16(0),
        u16(0), u16(0),
        u32(0),
        u32(0),
        name
      ]);
      central.push({ cent, lhOffset: offset - (local.length + data.length) });
    }

    const cdStart = offset;
    for (const item of central) {
      const cent = Buffer.from(item.cent);
      cent.writeUInt32LE(item.lhOffset>>>0, 42);
      await fd.write(cent, 0, cent.length, offset); offset += cent.length;
    }
    const cdSize = offset - cdStart;

    const end = Buffer.concat([
      u32(0x06054b50),
      u16(0), u16(0),
      u16(central.length),
      u16(central.length),
      u32(cdSize),
      u32(cdStart),
      u16(0)
    ]);
    await fd.write(end, 0, end.length, offset); offset += end.length;
  } finally {
    await fd.close();
  }
}
