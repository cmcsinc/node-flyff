/**
 * Minimal, self-contained DDS texture decoder + PNG encoder.
 *
 * Used by `convert-icons.ts` to turn the Flyff client's `.dds` item icons into
 * static PNGs under `admin/public/icons/`. Keeps the admin panel free of native
 * image deps (sharp/jimp) -- the icons are ≤128 px and a one-time conversion, so
 * a pure-JS path is instant and install-friction-free.
 *
 * Supports the formats the Flyff client actually uses:
 *  - Uncompressed RGB: 16/24/32 bpp with arbitrary channel masks
 *    (A1R5G5B5, R5G6B5, A4R4G4B4, X8R8G8B8, A8R8G8B8, A8B8G8R8, ...).
 *  - DXT1 / DXT3 / DXT5 block compression.
 *
 * @module scripts/dds
 */

import { deflateSync, crc32 } from 'node:zlib';

/** Decoded image -- raw 8-bit RGBA, row-major, top-to-bottom. */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
}

const DDS_MAGIC = 0x20534444; // 'DDS '
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}

/**
 * Decode an uncompressed pixel format using its channel masks. Handles any
 * 16/24/32-bpp layout the client throws at us by deriving shift/width per channel.
 */
function decodeUncompressed(
  buf: Buffer,
  dataOff: number,
  width: number,
  height: number,
  bitCount: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bpp = bitCount / 8;
  const expand = bitCount < 8; // 1/2/4 bpp pack multiple pixels per byte (not used by Flyff, guarded anyway)

  const channelOf = (mask: number): { shift: number; width: number } => {
    if (mask === 0) return { shift: 0, width: 0 };
    let shift = 0;
    while (((mask >> shift) & 1) === 0) shift++;
    let w = 0;
    while ((mask >> (shift + w)) & 1) w++;
    return { shift, width: w };
  };
  const r = channelOf(rMask);
  const g = channelOf(gMask);
  const b = channelOf(bMask);
  const a = channelOf(aMask);
  const hasAlpha =
    aMask !== 0 && (bitCount === 32 || (bitCount === 16 && (rMask & gMask & bMask) === 0));

  // Scale a channel's bit-field up to 0..255.
  const scale = (val: number, cw: number): number =>
    cw === 0 ? 0 : cw >= 8 ? val >> (cw - 8) : (val << (8 - cw)) | (val >> (2 * cw - 8));

  for (let i = 0; i < width * height; i++) {
    let pixel = 0;
    if (expand) {
      // General case for sub-byte packing (unused by Flyff).
      pixel = buf.readUInt8(dataOff + Math.floor((i * bitCount) / 8));
    } else {
      if (bpp === 1) pixel = buf.readUInt8(dataOff + i);
      else if (bpp === 2) pixel = buf.readUInt16LE(dataOff + i * 2);
      else if (bpp === 3) pixel = buf.readUIntLE(dataOff + i * 3, 3);
      else pixel = readU32(buf, dataOff + i * 4);
    }
    const p = i * 4;
    out[p] = scale((pixel & rMask) >> r.shift, r.width);
    out[p + 1] = scale((pixel & gMask) >> g.shift, g.width);
    out[p + 2] = scale((pixel & bMask) >> b.shift, b.width);
    // If no alpha channel was declared, treat the surface as fully opaque.
    out[p + 3] = hasAlpha ? scale((pixel & aMask) >> a.shift, a.width) : 255;
  }
  return out;
}

function decodeDXT1(buf: Buffer, dataOff: number, width: number, height: number): Uint8Array {
  return decodeDxt(buf, dataOff, width, height, 1);
}

function decodeDXT3(buf: Buffer, dataOff: number, width: number, height: number): Uint8Array {
  return decodeDxt(buf, dataOff, width, height, 3);
}

function decodeDXT5(buf: Buffer, dataOff: number, width: number, height: number): Uint8Array {
  return decodeDxt(buf, dataOff, width, height, 5);
}

/** Shared DXT1/3/5 block decoder. `variant` selects the alpha handling. */
function decodeDxt(
  buf: Buffer,
  dataOff: number,
  width: number,
  height: number,
  variant: 1 | 3 | 5,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const colorBlockSize = 8;
  const alphaBlockSize = variant === 1 ? 0 : 8;
  const blockSize = alphaBlockSize + colorBlockSize;
  const colorTable = new Array<[number, number, number]>(4);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockOff = dataOff + (by * blocksX + bx) * blockSize;
      const alphaRow = new Array<number>(16).fill(255);

      if (variant === 3) {
        // Explicit 4-bit alpha per pixel (64 bits = 8 bytes).
        for (let a = 0; a < 8; a++) {
          const v = buf.readUInt16LE(blockOff + a * 2);
          alphaRow[a * 2] = (v & 0xf) * 17;
          alphaRow[a * 2 + 1] = ((v >> 4) & 0xf) * 17;
          alphaRow[a * 2 + 2] = ((v >> 8) & 0xf) * 17;
          alphaRow[a * 2 + 3] = ((v >> 12) & 0xf) * 17;
        }
      } else if (variant === 5) {
        // Interpolated alpha (two reference alphas + 2-bit indices).
        const a0 = buf.readUInt8(blockOff);
        const a1 = buf.readUInt8(blockOff + 1);
        const lookup = new Array<number>(8);
        lookup[0] = a0;
        lookup[1] = a1;
        if (a0 > a1) {
          for (let i = 1; i <= 6; i++) lookup[i + 1] = Math.round((a0 * (7 - i) + a1 * i) / 7);
          lookup[7] = 0;
        } else {
          for (let i = 1; i <= 4; i++) lookup[i + 1] = Math.round((a0 * (5 - i) + a1 * i) / 5);
          lookup[6] = 0;
          lookup[7] = 255;
        }
        const idxLo = readU32(buf, blockOff + 2);
        const idxHi = readU32(buf, blockOff + 6);
        // 48 bits of 2-bit indices, stored lo-then-hi as a 48-bit value.
        const combined = BigInt(idxLo) | (BigInt(idxHi) << BigInt(32));
        for (let i = 0; i < 16; i++) {
          const bits = Number((combined >> BigInt(i * 2)) & BigInt(3));
          alphaRow[i] = lookup[bits];
        }
      }

      const colorOff = blockOff + alphaBlockSize;
      const c0 = buf.readUInt16LE(colorOff);
      const c1 = buf.readUInt16LE(colorOff + 2);
      const [r0, g0, b0] = rgb565ToRgb(c0);
      const [r1, g1, b1] = rgb565ToRgb(c1);
      colorTable[0] = [r0, g0, b0];
      colorTable[1] = [r1, g1, b1];
      if (c0 > c1) {
        colorTable[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3];
        colorTable[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3];
      } else {
        colorTable[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2];
        colorTable[3] = [0, 0, 0]; // transparent black
      }

      const colorBits = readU32(buf, colorOff + 4);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const codeIdx = (colorBits >> ((py * 4 + px) * 2)) & 3;
          const [cr, cg, cb] = colorTable[codeIdx];
          const p = (y * width + x) * 4;
          out[p] = cr;
          out[p + 1] = cg;
          out[p + 2] = cb;
          // DXT1: code 3 with c0<=c1 is transparent; else opaque.
          out[p + 3] = variant === 1 && c0 <= c1 && codeIdx === 3 ? 0 : alphaRow[py * 4 + px];
        }
      }
    }
  }
  return out;
}

function rgb565ToRgb(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) << 3;
  const g = ((c >> 5) & 0x3f) << 2;
  const b = (c & 0x1f) << 3;
  return [r | (r >> 5), g | (g >> 6), b | (b >> 5)];
}

/**
 * Decode a DDS buffer into raw RGBA. Throws on unsupported/invalid formats so the
 * caller can log and continue with the next file.
 */
export function decodeDds(buf: Buffer): DecodedImage {
  if (buf.length < 128 || readU32(buf, 0) !== DDS_MAGIC) {
    throw new Error('Not a DDS file (bad magic)');
  }

  const flags = readU32(buf, 8);
  const height = readU32(buf, 12);
  const width = readU32(buf, 16);
  if (!(flags & DDSD_HEIGHT) || !(flags & DDSD_WIDTH) || width === 0 || height === 0) {
    throw new Error('DDS missing width/height');
  }

  // DDPIXELFORMAT lives at offset 0x54 within the DDSURFACEDESC2 (file offset 0x4C).
  const pfFlags = readU32(buf, 0x50);
  const pfFourCC = buf.toString('ascii', 0x54, 0x58);
  const bitCount = readU32(buf, 0x58);
  const rMask = readU32(buf, 0x5c);
  const gMask = readU32(buf, 0x60);
  const bMask = readU32(buf, 0x64);
  const aMask = readU32(buf, 0x68);

  // Pixel data starts after the 128-byte header (+ any 10-byte DXT10 extra, not used here).
  const dataOff = 128;

  if (pfFlags & DDPF_FOURCC) {
    const four = pfFourCC.replace(/\0+$/, '');
    if (four === 'DXT1') return { width, height, data: decodeDXT1(buf, dataOff, width, height) };
    if (four === 'DXT3') return { width, height, data: decodeDXT3(buf, dataOff, width, height) };
    if (four === 'DXT5') return { width, height, data: decodeDXT5(buf, dataOff, width, height) };
    throw new Error(`Unsupported DDS fourCC: '${four}'`);
  }

  if (pfFlags & (DDPF_RGB | DDPF_LUMINANCE)) {
    return {
      width,
      height,
      data: decodeUncompressed(
        buf,
        dataOff,
        width,
        height,
        bitCount,
        rMask,
        gMask,
        bMask,
        pfFlags & DDPF_ALPHAPIXELS ? aMask : 0,
      ),
    };
  }

  throw new Error(`Unsupported DDS pixel format (flags=0x${pfFlags.toString(16)})`);
}

/**
 * Punch out the client's D3D color key: opaque magenta (`0xffff00ff`) means
 * "transparent", not "pink". The client passes that key to
 * `D3DXCreateTextureFromFileInMemoryEx` for every icon
 * (`game/source/_Common/Item.cpp:113`, `lordskill.cpp:65`), so the alpha bit in
 * these A1R5G5B5 surfaces is set on *all* pixels and carries no information.
 * Without this the PNG keeps the magenta and the UI shows a purple background.
 *
 * Exact-match only, mirroring D3DX color-key semantics.
 */
export function applyColorKey(img: DecodedImage, key = { r: 255, g: 0, b: 255 }): DecodedImage {
  const { data } = img;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p] === key.r && data[p + 1] === key.g && data[p + 2] === key.b) {
      data[p] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 0;
    }
  }
  return img;
}

// --- PNG encoder ----------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode raw RGBA into a PNG. Lossless; the right call for crisp small icons.
 * Top-down scanlines, each prefixed with a filter byte of 0 (None).
 */
export function encodePng(img: DecodedImage): Buffer {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
