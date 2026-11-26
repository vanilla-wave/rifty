/**
 * A written zip (`.xlsx` too) as compared by the node-streams carrier: every byte of the container,
 * except the closed `ZIP_MASKS` list. The file is parsed whole: each local header, its data and data
 * descriptor, each central directory header, the end record. Every field goes into the manifest, in
 * central directory order. Bytes no structure covers (a prefix, gaps, a tail after the end record)
 * go in verbatim, by offset, length and sha256. The covered lengths must sum to the file's length.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/** What the comparison hides, and why; nothing else is hidden. */
export const ZIP_MASKS = [
  {
    field: 'time, date (every local and central header)',
    why: 'the DOS time of the write',
  },
  {
    field: 'docProps/core.xml: ISO timestamps in its content',
    why: "an OOXML package's created/modified time",
  },
  {
    field: 'docProps/core.xml: crc, compressed and uncompressed size, compressed data',
    why: 'derived from that content, so from the time',
  },
  {
    field:
      "offsets (local header, central directory, gaps): counted without core.xml's compressed data",
    why: 'its length follows from the time',
  },
] as const;

const CORE = 'docProps/core.xml';
const maskTimes = (text: string): string =>
  text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>');
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const blob = (b: Uint8Array): string => `${b.byteLength}:${sha(b)}`;
const hex = (n: number): string => `0x${n.toString(16)}`;

/** The manifest lines of zip `bytes` written at `path`: `[key, value]`, keys sort in file order. */
export function zipEntries(path: string, bytes: Uint8Array): [string, string][] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => v.getUint16(at, true);
  const u32 = (at: number): number => v.getUint32(at, true);
  const covered: [number, number][] = [];
  const cover = (start: number, end: number): void => {
    if (end > bytes.byteLength) throw new Error(`structure at ${start} runs past the file`);
    covered.push([start, end]);
  };
  const out: [string, string][] = [];
  const idx = (n: number): string => String(n).padStart(4, '0');

  let eocd = bytes.byteLength - 22;
  while (eocd >= 0 && u32(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end of central directory record');
  const commentLength = u16(eocd + 20);
  cover(eocd, eocd + 22 + commentLength);
  const entries = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);
  // Offsets count without docProps/core.xml's compressed data: its length follows from the time.
  const masked: [number, number][] = [];
  for (let n = 0, at = cdOffset; n < entries && u32(at) === 0x02014b50; n++) {
    const nameLength = u16(at + 28);
    if (new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)) === CORE) {
      const offset = u32(at + 42);
      masked.push([offset + 30 + u16(offset + 26) + u16(offset + 28), u32(at + 20)]);
    }
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }
  const rel = (off: number): number =>
    masked.reduce(
      (o, [start, length]) => (start < off ? o - Math.min(length, off - start) : o),
      off,
    );
  out.push([
    `${path}!eocd`,
    `disk=${u16(eocd + 4)} cdDisk=${u16(eocd + 6)} entriesHere=${u16(eocd + 8)} entries=${entries} cdSize=${cdSize} cdOffset=${rel(cdOffset)} comment=${blob(bytes.subarray(eocd + 22, eocd + 22 + commentLength))}`,
  ]);

  let at = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (u32(at) !== 0x02014b50) throw new Error(`no central header at ${at}`);
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const [crc, csize, usize] = [u32(at + 16), u32(at + 20), u32(at + 24)];
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error('zip64 entry');
    const [nameLength, extraLength, commentLen] = [u16(at + 28), u16(at + 30), u16(at + 32)];
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const core = name === CORE;
    const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const end = at + 46 + nameLength + extraLength + commentLen;
    const offset = u32(at + 42);
    out.push([
      `${path}!cd#${idx(n)}`,
      `name=${JSON.stringify(name)} made=${hex(u16(at + 4))} need=${u16(at + 6)} flags=${hex(flags)} method=${method} time=<masked> crc=${core ? '<masked>' : hex(crc)} csize=${core ? '<masked>' : csize} usize=${core ? '<masked>' : usize} extra=${blob(extra)} comment=${blob(bytes.subarray(end - commentLen, end))} disk=${u16(at + 34)} iattr=${hex(u16(at + 36))} eattr=${hex(u32(at + 38))} offset=${rel(offset)}`,
    ]);
    cover(at, end);
    at = end;

    // The local header this entry names, its data and its data descriptor.
    if (u32(offset) !== 0x04034b50) throw new Error(`no local header at ${offset}`);
    const [lName, lExtra] = [u16(offset + 26), u16(offset + 28)];
    const lFlags = u16(offset + 6);
    const dataStart = offset + 30 + lName + lExtra;
    const data = bytes.subarray(dataStart, dataStart + csize);
    cover(offset, dataStart + csize);
    let descriptor = 'none';
    if (lFlags & 0x8) {
      const signed = u32(dataStart + csize) === 0x08074b50;
      const length = signed ? 16 : 12;
      const d = dataStart + csize + (signed ? 4 : 0);
      descriptor = `signed=${signed} crc=${core ? '<masked>' : hex(u32(d))} csize=${core ? '<masked>' : u32(d + 4)} usize=${core ? '<masked>' : u32(d + 8)}`;
      cover(dataStart + csize, dataStart + csize + length);
    }
    const content =
      method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : undefined;
    if (content === undefined) throw new Error(`${name}: method ${method} not read`);
    out.push([
      `${path}!local#${idx(n)}`,
      `name=${new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + lName)) === name ? '=cd' : JSON.stringify(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + lName)))} need=${u16(offset + 4)} flags=${hex(lFlags)} method=${u16(offset + 8)} time=<masked> crc=${core ? '<masked>' : hex(u32(offset + 14))} csize=${core ? '<masked>' : u32(offset + 18)} usize=${core ? '<masked>' : u32(offset + 22)} extra=${blob(bytes.subarray(offset + 30 + lName, dataStart))} data=${core ? '<masked>' : blob(data)} content=${core ? `masked-times:${sha(maskTimes(new TextDecoder().decode(content)))}` : blob(content)} descriptor=${descriptor}`,
    ]);
  }
  if (at !== cdOffset + cdSize)
    throw new Error(`central directory ends at ${at}, not ${cdOffset + cdSize}`);

  // Bytes no structure covers, verbatim; the covered and uncovered lengths sum to the file's.
  covered.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  let total = 0;
  for (const [start, end] of covered) {
    if (start < pos) throw new Error(`structures overlap at ${start}`);
    if (start > pos) {
      out.push([
        `${path}!gap@${String(rel(pos)).padStart(10, '0')}`,
        blob(bytes.subarray(pos, start)),
      ]);
      total += start - pos;
    }
    total += end - start;
    pos = end;
  }
  if (pos < bytes.byteLength) {
    out.push([`${path}!gap@${String(rel(pos)).padStart(10, '0')}`, blob(bytes.subarray(pos))]);
    total += bytes.byteLength - pos;
  }
  if (total !== bytes.byteLength)
    throw new Error(`accounted ${total} of ${bytes.byteLength} bytes`);
  return out;
}
