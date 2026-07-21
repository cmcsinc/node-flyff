// Flyff v15 .res archive reader (format from game/source/_Common/file.cpp + file.h).
// Header: [key:BYTE][bEnc:BYTE][dirSize:int][dirSize bytes encrypted].
// Each header byte decrypted via Decryption(key,b): b=(~b^key)&0xFF; nibble-swap.
// Decrypted dir: [version:7B][count:short] then count× [nameLen:short][name][size:int][time:int32][offset:int].
// File DATA: at offset, size bytes, each byte decrypted with the same key. No compression.
import { openSync, readSync, closeSync } from 'node:fs';

function decryptByte(key, b) {
  const x = (~b ^ key) & 0xFF;
  return ((x << 4) | (x >>> 4)) & 0xFF;
}

function decryptBuf(key, buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = decryptByte(key, buf[i]);
  return out;
}

export function readResIndex(path) {
  const fd = openSync(path, 'r');
  const h = Buffer.alloc(6);
  readSync(fd, h, 0, 6, 0);
  const key = h.readUInt8(0);
  const bEnc = h.readUInt8(1);
  const dirSize = h.readInt32LE(2);
  const enc = Buffer.alloc(dirSize);
  readSync(fd, enc, 0, dirSize, 6);
  closeSync(fd);
  const d = decryptBuf(key, enc);
  let p = 0;
  const version = d.toString('latin1', p, p + 7).replace(/\0+$/, ''); p += 7;
  const count = d.readInt16LE(p); p += 2;
  const files = [];
  for (let i = 0; i < count; i++) {
    const nameLen = d.readInt16LE(p); p += 2;
    const name = d.toString('latin1', p, p + nameLen); p += nameLen;
    const size = d.readInt32LE(p); p += 4;
    d.readInt32LE(p); p += 4; // time
    const offset = d.readInt32LE(p); p += 4;
    files.push({ name, size, offset });
  }
  return { key, bEnc, version, files };
}

export function readResFile(path, entry, key) {
  const fd = openSync(path, 'r');
  const enc = Buffer.alloc(entry.size);
  readSync(fd, enc, 0, entry.size, entry.offset);
  closeSync(fd);
  return decryptBuf(key, enc);
}

// CLI: node res-reader.mjs <data.res> [findSubstring]
const [, , resPath, find = 'propMover.txt'] = process.argv;
if (resPath) {
  const { key, version, files } = readResIndex(resPath);
  console.log(`version=${version} key=${key} files=${files.length}`);
  const hit = files.filter(f => f.name.toLowerCase().includes(find.toLowerCase()));
  if (hit.length === 0) {
    console.log(`no entry matching "${find}". sample names:`);
    for (const f of files.slice(0, 20)) console.log('  ', f.name);
  }
  for (const f of hit) {
    const data = readResFile(resPath, f, key);
    process.stdout.write(data);
  }
}
