// A small, dependency-free QR code maker (byte mode, error correction level M, versions 1 to 10, so up to 213 characters). It exists so a client's
// "leave us a review" card can carry a scannable code without adding a package. Pure functions only: text in, a grid of dark/light squares out.
// Checked by scripts/test-qr-code.mjs (structure, golden fingerprints that were decoded with a real QR reader, and planted-bug controls).

export type QrGrid = { size: number; version: number; modules: boolean[][] };

const maxVersion = 10;
// Level M: error-correction codewords per block, and number of blocks, for versions 1..10 (index 0 = version 1).
const eccPerBlock = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const blockCount = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
const rawCodewords = (version: number) => Math.floor(rawDataModules(version) / 8);
const dataCodewords = (version: number) => rawCodewords(version) - eccPerBlock[version - 1] * blockCount[version - 1];

export function qrCapacityBytes(version: number): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}
export const qrMaxBytes = qrCapacityBytes(maxVersion);

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

// ---- Reed-Solomon over GF(256), polynomial 0x11D
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function generator(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}
function remainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function buildCodewords(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  const capacityBits = dataCodewords(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCodewords(version); pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = blockCount[version - 1];
  const eccLen = eccPerBlock[version - 1];
  const raw = rawCodewords(version);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = generator(eccLen);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const length = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    dataBlocks.push(block);
    eccBlocks.push(remainder(block, divisor));
  }
  const result: number[] = [];
  const longest = shortLen - eccLen + 1;
  for (let i = 0; i < longest; i += 1) dataBlocks.forEach((block) => { if (i < block.length) result.push(block[i]); });
  for (let i = 0; i < eccLen; i += 1) eccBlocks.forEach((block) => result.push(block[i]));
  return result;
}

function drawFunctionPatterns(version: number, size: number, modules: boolean[][], isFunction: boolean[][]): void {
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true; };
  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const positions = alignmentPositions(version);
  positions.forEach((cy, i) => positions.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // reserve the format areas (real bits are drawn after the mask is chosen) and the always-dark module
  drawFormat(0, size, modules, isFunction);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
}

function drawFormat(mask: number, size: number, modules: boolean[][], isFunction: boolean[][]): void {
  const data = (0 << 3) | mask; // error-correction level M is 0b00
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true; };
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function drawCodewords(codewords: number[], size: number, modules: boolean[][], isFunction: boolean[][]): void {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i += 1;
        }
      }
    }
  }
}

function applyMask(mask: number, size: number, modules: boolean[][], isFunction: boolean[][]): void {
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let invert: boolean;
    switch (mask) {
      case 0: invert = (x + y) % 2 === 0; break;
      case 1: invert = y % 2 === 0; break;
      case 2: invert = x % 3 === 0; break;
      case 3: invert = (x + y) % 3 === 0; break;
      case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
      case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
      case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
    }
    if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x];
  }
}

function penalty(size: number, modules: boolean[][]): number {
  let result = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) { lines.push(modules[i]); lines.push(modules.map((row) => row[i])); }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else { if (run >= 5) result += 3 + (run - 5); run = 1; }
    }
    // finder-like 1:1:3:1:1 pattern with four light squares on a side
    const text = line.map((d) => (d ? "1" : "0")).join("");
    for (const pattern of ["10111010000", "00001011101"]) {
      let at = text.indexOf(pattern);
      while (at !== -1) { result += 40; at = text.indexOf(pattern, at + 1); }
    }
  }
  for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
    const c = modules[y][x];
    if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return result;
}

// Text in, grid out. Throws a plain error if the text is empty or too long for a printable code.
export function makeQr(text: string): QrGrid {
  const bytes = utf8(text);
  if (bytes.length === 0) throw new Error("Nothing to put in the code.");
  let version = 1;
  while (version <= maxVersion && bytes.length > qrCapacityBytes(version)) version += 1;
  if (version > maxVersion) throw new Error("That link is too long for a printed code.");
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
    drawFunctionPatterns(version, size, modules, isFunction);
    drawCodewords(codewords, size, modules, isFunction);
    applyMask(mask, size, modules, isFunction);
    drawFormat(mask, size, modules, isFunction);
    const score = penalty(size, modules);
    if (score < bestScore) { bestScore = score; best = modules; }
  }
  return { size, version, modules: best as boolean[][] };
}

// The outline of every dark square as one SVG path (with the required 4-square quiet border around the code). Used by the page to draw the code
// with normal React elements, so no raw HTML is ever injected.
export function qrPathData(grid: QrGrid, border = 4): { viewSize: number; path: string } {
  const parts: string[] = [];
  grid.modules.forEach((row, y) => row.forEach((on, x) => { if (on) parts.push(`M${x + border},${y + border}h1v1h-1z`); }));
  return { viewSize: grid.size + border * 2, path: parts.join("") };
}

// The same picture as a standalone SVG string (no scripts, no external references), for tests and downloads.
export function qrToSvg(grid: QrGrid, options: { border?: number; dark?: string; light?: string } = {}): string {
  const dark = /^#[0-9a-fA-F]{3,8}$/.test(options.dark ?? "") ? (options.dark as string) : "#000000";
  const light = /^#[0-9a-fA-F]{3,8}$/.test(options.light ?? "") ? (options.light as string) : "#ffffff";
  const { viewSize, path } = qrPathData(grid, options.border ?? 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img"><rect width="${viewSize}" height="${viewSize}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
