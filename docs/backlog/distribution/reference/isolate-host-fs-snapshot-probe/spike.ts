import { bridge as __b } from '../../../../../packages/isolate-guest/src/guest/web-shim.ts';
(globalThis as unknown as Record<string, Spike>).__keep = __b;
import {
  TextDecoder,
  encodeUtf8,
} from '../../../../../packages/isolate-guest/src/guest/text-codec.ts';
import { createHash } from '../../../../../packages/runtime-js/src/builtins/crypto.ts';
import { createMemoryFs } from '../../../../../packages/vfs/src/sync-mirror.ts';
// biome-ignore lint/suspicious/noExplicitAny: throwaway probe surface.
type Spike = any;
const dec = new TextDecoder('utf-8', { fatal: true });
type Fs = ReturnType<typeof createMemoryFs>['fsSync'];
let fs: Fs;
const fresh = (): Fs => createMemoryFs().fsSync;

function load(pack: Uint8Array): number {
  fs = fresh();
  const dv = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const len = dv.getUint32(0, true);
  const meta = JSON.parse(dec.decode(pack.subarray(4, 4 + len)));
  for (const d of meta.dirs) fs.mkdirSync(d, { recursive: true });
  let off = 4 + len;
  for (const [p, size] of meta.files) {
    fs.writeFileSync(p, pack.slice(off, off + size));
    off += size;
  }
  return meta.files.length;
}

interface E {
  path: string;
  dir: boolean;
  data?: Uint8Array;
  mtime: number;
  atime: number;
}
function walk(f: Fs, root = '/'): E[] {
  const out: E[] = [];
  const rec = (p: string) => {
    for (const d of f.readdirSync(p)) {
      const c = p === '/' ? `/${d.name}` : `${p}/${d.name}`;
      const st = f.statSync(c);
      if (d.isDirectory) {
        out.push({ path: c, dir: true, mtime: st.mtime!, atime: st.atime! });
        rec(c);
      } else
        out.push({
          path: c,
          dir: false,
          data: f.readFileBytesSync(c),
          mtime: st.mtime!,
          atime: st.atime!,
        });
    }
  };
  rec(root);
  return out;
}
function sha(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest() as Uint8Array);
}
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- BIN
const MAGIC = encodeUtf8('RIFTYFS1');
function exportBin(hash: 'sha' | 'crc' | 'none'): Uint8Array {
  const es = walk(fs);
  const paths = es.map((e) => encodeUtf8(e.path));
  let size = 8 + 4;
  es.forEach((e, i) => {
    size += 1 + 4 + paths[i].length + 16 + (e.dir ? 0 : 8 + e.data!.length);
  });
  size += 1 + 32;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(8, 1, true);
  let o = 12;
  es.forEach((e, i) => {
    out[o++] = e.dir ? 1 : 2;
    dv.setUint32(o, paths[i].length, true);
    o += 4;
    out.set(paths[i], o);
    o += paths[i].length;
    dv.setFloat64(o, e.mtime, true);
    dv.setFloat64(o + 8, e.atime, true);
    o += 16;
    if (!e.dir) {
      dv.setFloat64(o, e.data!.length, true);
      o += 8;
      out.set(e.data!, o);
      o += e.data!.length;
    }
  });
  out[o++] = 0;
  if (hash === 'sha') out.set(sha(out.subarray(0, o)), o);
  else if (hash === 'crc') dv.setUint32(o, crc32(out.subarray(0, o)), true);
  return out;
}
function importBin(b: Uint8Array, hash: 'sha' | 'crc' | 'none', view: boolean): number {
  const f = fresh();
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const body = b.length - 32;
  if (hash === 'sha') {
    const h = sha(b.subarray(0, body));
    for (let i = 0; i < 32; i++) if (h[i] !== b[body + i]) throw new Error('sum');
  } else if (hash === 'crc') {
    if (crc32(b.subarray(0, body)) !== dv.getUint32(body, true)) throw new Error('sum');
  }
  let o = 12;
  let n = 0;
  const seen = new Set<string>();
  const times: [string, number, number][] = [];
  for (;;) {
    const k = b[o++];
    if (k === 0) break;
    const pl = dv.getUint32(o, true);
    o += 4;
    const p = dec.decode(b.subarray(o, o + pl));
    o += pl;
    if (seen.has(p)) throw new Error('dup');
    seen.add(p);
    const mt = dv.getFloat64(o, true);
    const at = dv.getFloat64(o + 8, true);
    o += 16;
    if (k === 1) f.mkdirSync(p, { recursive: false });
    else {
      const s = dv.getFloat64(o, true);
      o += 8;
      f.writeFileSync(p, view ? b.subarray(o, o + s) : b.slice(o, o + s));
      o += s;
      n++;
    }
    times.push([p, at, mt]);
  }
  for (let i = times.length - 1; i >= 0; i--) f.utimes(times[i][0], times[i][1], times[i][2]);
  fs = f;
  return n;
}

// ---- TAR (ustar + pax per entry for long paths / ms times)
const enc = encodeUtf8;
function octal(h: Uint8Array, off: number, len: number, v: number) {
  const s = v.toString(8).padStart(len - 1, '0');
  for (let i = 0; i < len - 1; i++) h[off + i] = s.charCodeAt(i);
  h[off + len - 1] = 0;
}
function header(name: Uint8Array, size: number, type: number, mtimeS: number): Uint8Array {
  const h = new Uint8Array(512);
  h.set(name.subarray(0, 100), 0);
  octal(h, 100, 8, type === 53 ? 0o755 : 0o644);
  octal(h, 108, 8, 0);
  octal(h, 116, 8, 0);
  octal(h, 124, 12, size);
  octal(h, 136, 12, mtimeS);
  h[156] = type;
  h.set(enc('ustar\u000000'), 257);
  for (let i = 148; i < 156; i++) h[i] = 32;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  octal(h, 148, 7, sum);
  h[155] = 32;
  return h;
}
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  let s = `${len}${body}`;
  while (enc(s).length !== len) {
    len = enc(s).length;
    s = `${len}${body}`;
  }
  return s;
}
const pad = (n: number) => (512 - (n % 512)) % 512;
function exportTar(times: boolean): Uint8Array {
  const es = walk(fs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const push = (c: Uint8Array) => {
    chunks.push(c);
    size += c.length;
  };
  for (const e of es) {
    const name = enc(e.path.slice(1) + (e.dir ? '/' : ''));
    if (name.length > 100 || times) {
      let pax = name.length > 100 ? paxRecord('path', e.path.slice(1)) : '';
      if (times)
        pax +=
          paxRecord('mtime', String(e.mtime / 1000)) + paxRecord('atime', String(e.atime / 1000));
      const pb = enc(pax);
      push(header(enc('PaxHeader'), pb.length, 120, 0));
      push(pb);
      push(new Uint8Array(pad(pb.length)));
    }
    const len = e.dir ? 0 : e.data!.length;
    push(header(name, len, e.dir ? 53 : 48, Math.floor(e.mtime / 1000)));
    if (!e.dir) {
      push(e.data!);
      push(new Uint8Array(pad(len)));
    }
  }
  push(new Uint8Array(1024));
  const out = new Uint8Array(size + 32);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  out.set(sha(out.subarray(0, size)), size);
  return out;
}
function field(h: Uint8Array, off: number, len: number): string {
  let e = off;
  while (e < off + len && h[e] !== 0) e++;
  return dec.decode(h.subarray(off, e));
}
function importTar(b: Uint8Array): number {
  const f = fresh();
  const body = b.length - 32;
  const h = sha(b.subarray(0, body));
  for (let i = 0; i < 32; i++) if (h[i] !== b[body + i]) throw new Error('sum');
  let o = 0;
  let n = 0;
  let pax: Record<string, string> = {};
  const seen = new Set<string>();
  const times: [string, number, number][] = [];
  while (o + 512 <= body) {
    const hd = b.subarray(o, o + 512);
    if (hd.every((x) => x === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : hd[i];
    if (sum !== Number.parseInt(field(hd, 148, 8), 8)) throw new Error('hsum');
    const size = Number.parseInt(field(hd, 124, 12), 8);
    const type = hd[156];
    o += 512;
    if (type === 120) {
      const t = dec.decode(b.subarray(o, o + size));
      pax = {};
      let i = 0;
      while (i < t.length) {
        const sp = t.indexOf(' ', i);
        const l = Number(t.slice(i, sp));
        const rec = t.slice(sp + 1, i + l - 1);
        const eq = rec.indexOf('=');
        pax[rec.slice(0, eq)] = rec.slice(eq + 1);
        i += l;
      }
      o += size + pad(size);
      continue;
    }
    let p = `/${pax.path ?? field(hd, 0, 100)}`;
    if (p.endsWith('/')) p = p.slice(0, -1);
    if (seen.has(p)) throw new Error('dup');
    seen.add(p);
    const mt = pax.mtime ? Number(pax.mtime) * 1000 : Number.parseInt(field(hd, 136, 12), 8) * 1000;
    const at = pax.atime ? Number(pax.atime) * 1000 : mt;
    if (type === 53) f.mkdirSync(p, { recursive: false });
    else {
      f.writeFileSync(p, b.slice(o, o + size));
      n++;
    }
    times.push([p, at, mt]);
    o += size + pad(size);
    pax = {};
  }
  for (let i = times.length - 1; i >= 0; i--) f.utimes(times[i][0], times[i][1], times[i][2]);
  fs = f;
  return n;
}

// ---- JSON + base64 (WorkspaceArchiveV1 shape)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(d: Uint8Array): string {
  const parts: string[] = [];
  const CH = 3 * 8192;
  for (let s = 0; s < d.length; s += CH) {
    const e = Math.min(d.length, s + CH);
    let out = '';
    for (let i = s; i < e; i += 3) {
      const a = d[i];
      const b1 = i + 1 < e ? d[i + 1] : 0;
      const c = i + 2 < e ? d[i + 2] : 0;
      out +=
        B64[a >> 2] +
        B64[((a & 3) << 4) | (b1 >> 4)] +
        (i + 1 < e ? B64[((b1 & 15) << 2) | (c >> 6)] : '=') +
        (i + 2 < e ? B64[c & 63] : '=');
    }
    parts.push(out);
  }
  return parts.join('');
}
const R = new Uint8Array(128);
for (let i = 0; i < 64; i++) R[B64.charCodeAt(i)] = i;
function unb64(s: string): Uint8Array {
  const padn = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - padn);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (R[s.charCodeAt(i)] << 18) |
      (R[s.charCodeAt(i + 1)] << 12) |
      (R[s.charCodeAt(i + 2)] << 6) |
      R[s.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
function exportJson(): Uint8Array {
  const es = walk(fs);
  const j = JSON.stringify({
    version: 1,
    root: '/',
    files: es
      .filter((e) => !e.dir)
      .map((e) => ({ path: e.path, encoding: 'base64', content: b64(e.data!), mtime: e.mtime })),
    directories: es.filter((e) => e.dir).map((e) => e.path),
  });
  return enc(j);
}
function importJson(b: Uint8Array): number {
  const f = fresh();
  const j = JSON.parse(dec.decode(b));
  for (const d of j.directories) f.mkdirSync(d, { recursive: true });
  for (const x of j.files) f.writeFileSync(x.path, unb64(x.content));
  fs = f;
  return j.files.length;
}
(globalThis as unknown as Record<string, Spike>).spike = {
  load,
  exportBin,
  importBin,
  exportTar,
  importTar,
  exportJson,
  importJson,
  digest: () => {
    const es = walk(fs);
    const h = createHash('sha256');
    for (const e of es) {
      h.update(encodeUtf8(e.path + (e.dir ? '/' : '') + e.mtime));
      if (e.data) h.update(e.data);
    }
    return h.digest('hex') as unknown as string;
  },
};
(globalThis as unknown as Record<string, Spike>).spike.begin = () => {
  fs = fresh();
};
(globalThis as unknown as Record<string, Spike>).spike.add = (
  meta: { dirs: string[]; files: [string, number][] },
  data: Uint8Array,
) => {
  for (const d of meta.dirs) fs.mkdirSync(d, { recursive: true });
  let o = 0;
  for (const [p, s] of meta.files) {
    fs.writeFileSync(p, data.slice(o, o + s));
    o += s;
  }
};
