/**
 * Probe-only guest additions (NOT a design): bundled after the real guest entry
 * (`packages/isolate-guest/src/guest/entry.ts`) by `layer.mjs`, resolved from
 * that directory. Two ways a fresh isolate can see a template:
 *
 * - `materialize(pack, index)`: every template entry written into the realm's
 *   MemoryFs, file bytes as views into ONE copied buffer (the cheapest
 *   in-heap materialization: no per-file copy); `captureDiff()` walks the tree
 *   and snapshots only entries that are not the template's own views.
 * - `remote()`: the whole FS (template + diff) owned by the worker; every
 *   FsSync call is one sync host call (`__probeFs`), the isolate holds no files.
 * - `overlay()`: the realm's FS becomes upper (the MemoryFs the entry restores
 *   the diff into) over a lower layer read lazily through three sync host
 *   functions (`__probeTpl`): stat / read / readdir. Writes go to the upper;
 *   enough of FsSync for the probe's workloads (require + writeFileSync), not
 *   a complete overlay (no whiteouts, no rename across layers).
 */
import './entry.ts';
import { VfsError, syncMirror } from '@riftydev/vfs';
import { MemoryFsSync, setSyncMirror } from '@riftydev/vfs/internal';
import { snapshotFs } from '../snapshot.ts';

type Lower = {
  stat(p: string): readonly number[] | null; // [isDir, size, mtime, atime, ctime, birthtime]
  read(p: string): Uint8Array;
  readdir(p: string): readonly (readonly [string, number])[];
};
const g = globalThis as unknown as Record<string, unknown>;
const lower = g.__probeTpl as Lower | undefined;
// biome-ignore lint/performance/noDelete: probe
delete g.__probeTpl;
type Call = (op: string, a?: unknown, b?: unknown, c?: unknown) => unknown;
const hostFs = g.__probeFs as Call | undefined;
// biome-ignore lint/performance/noDelete: probe
delete g.__probeFs;
const upper = syncMirror() as MemoryFsSync;
const counters = { stat: 0, read: 0, readBytes: 0, readdir: 0 };

const norm = (p: string): string => {
  const parts: string[] = [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') parts.pop();
    else parts.push(s);
  }
  return `/${parts.join('/')}`;
};
const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';

type Stat = ReturnType<MemoryFsSync['statSync']>;
function lowerStat(p: string): Stat | null {
  if (!lower) return null;
  counters.stat++;
  const s = lower.stat(p);
  if (s === null) return null;
  const [dir, size, mtime, atime, ctime, birthtime] = s as number[];
  return {
    isFile: dir === 0,
    isDirectory: dir === 1,
    size: dir === 1 ? 0 : size,
    mtime,
    atime,
    metadata: { ino: 0, ctime, birthtime },
    nlink: 1,
  } as Stat;
}
/** Make `dir` exist in the upper (copy-up of lower directories). */
function copyUpDir(dir: string): void {
  if (upper.existsSync(dir)) return;
  copyUpDir(parentOf(dir));
  upper.mkdirSync(dir, {});
}

class Overlay {
  existsSync(p: string): boolean {
    const n = norm(p);
    return upper.existsSync(n) || lowerStat(n) !== null;
  }
  statSyncOrNull(p: string): Stat | null {
    const n = norm(p);
    return upper.statSyncOrNull(n) ?? lowerStat(n);
  }
  statSync(p: string): Stat {
    const s = this.statSyncOrNull(p);
    if (s === null) throw new VfsError('ENOENT', p);
    return s;
  }
  readFileBytesSync(p: string): Uint8Array {
    const n = norm(p);
    if (upper.existsSync(n)) return upper.readFileBytesSync(n);
    const s = lowerStat(n);
    if (s === null) throw new VfsError('ENOENT', p);
    if (s.isDirectory) throw new VfsError('EISDIR', p);
    counters.read++;
    const bytes = (lower as Lower).read(n);
    counters.readBytes += bytes.byteLength;
    return bytes;
  }
  writeFileSync(p: string, data: Uint8Array): void {
    const n = norm(p);
    const parent = parentOf(n);
    if (!upper.existsSync(parent) && lowerStat(parent)?.isDirectory) copyUpDir(parent);
    upper.writeFileSync(n, data);
  }
  readdirSync(p: string) {
    const n = norm(p);
    const out = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }>();
    if (lower && lowerStat(n)?.isDirectory) {
      counters.readdir++;
      for (const [name, dir] of lower.readdir(n))
        out.set(name, { name, isFile: dir === 0, isDirectory: dir === 1 });
    }
    if (upper.existsSync(n)) for (const d of upper.readdirSync(n)) out.set(d.name, d);
    else if (out.size === 0) throw new VfsError('ENOENT', p);
    return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  mkdirSync(p: string, o: { recursive?: boolean }): void {
    const n = norm(p);
    if (lowerStat(n)?.isDirectory && !upper.existsSync(n)) {
      if (o.recursive) return copyUpDir(n);
      throw new VfsError('EEXIST', p);
    }
    if (!upper.existsSync(parentOf(n)) && lowerStat(parentOf(n))?.isDirectory)
      copyUpDir(parentOf(n));
    upper.mkdirSync(n, o);
  }
  rmSync(p: string, o: { recursive?: boolean; force?: boolean }): void {
    upper.rmSync(norm(p), o);
  }
  utimes(p: string, a: number, m: number): void {
    upper.utimes(norm(p), a, m);
  }
  copyFileSync(s: string, d: string): void {
    this.writeFileSync(d, new Uint8Array(this.readFileBytesSync(s)));
  }
  cpSync(s: string, d: string): void {
    this.copyFileSync(s, d);
  }
  renameSync(s: string, d: string): void {
    upper.renameSync(norm(s), norm(d));
  }
}

/** Every call to the worker; a `{ e: code }` result is that VfsError. */
function rpc(op: string, path: string, b?: unknown, c?: unknown): unknown {
  counters.stat++;
  const r = (hostFs as Call)(op, path, b, c) as { e?: string } | unknown;
  if (r !== null && typeof r === 'object' && 'e' in (r as object))
    throw new VfsError((r as { e: string }).e as never, path);
  return r;
}
const toStat = (s: readonly number[] | null): Stat | null => {
  if (s === null) return null;
  const [dir, size, mtime, atime, ctime, birthtime, nlink] = s as number[];
  return {
    isFile: dir === 0,
    isDirectory: dir === 1,
    size,
    mtime,
    atime,
    metadata: { ino: 0, ctime, birthtime },
    nlink,
  } as Stat;
};
class RemoteFs {
  existsSync = (p: string): boolean => rpc('exists', norm(p)) as boolean;
  statSyncOrNull = (p: string): Stat | null => toStat(rpc('stat', norm(p)) as number[] | null);
  statSync = (p: string): Stat => {
    const s = this.statSyncOrNull(p);
    if (s === null) throw new VfsError('ENOENT', p);
    return s;
  };
  readFileBytesSync = (p: string): Uint8Array => {
    const b = rpc('read', norm(p)) as Uint8Array;
    counters.read++;
    counters.readBytes += b.byteLength;
    return b;
  };
  writeFileSync = (p: string, data: Uint8Array): void => void rpc('write', norm(p), data);
  readdirSync = (p: string) =>
    (rpc('readdir', norm(p)) as [string, number][]).map(([name, dir]) => ({
      name,
      isFile: dir === 0,
      isDirectory: dir === 1,
    }));
  mkdirSync = (p: string, o: { recursive?: boolean }): void =>
    void rpc('mkdir', norm(p), o.recursive === true);
  rmSync = (p: string, o: { recursive?: boolean; force?: boolean }): void =>
    void rpc('rm', norm(p), o.recursive === true, o.force === true);
  utimes = (p: string, a: number, m: number): void => void rpc('utimes', norm(p), a, m);
  copyFileSync = (s: string, d: string): void => void rpc('copy', norm(s), norm(d));
  cpSync = (s: string, d: string): void => void rpc('copy', norm(s), norm(d));
  renameSync = (s: string, d: string): void => void rpc('rename', norm(s), norm(d));
}

/** Template entries as views into one buffer: [kind 1 dir | 2 file, path, offset, size, m, a, c, b]. */
type IndexRow = readonly [number, string, number, number, number, number, number, number];
const templateViews = new WeakSet<Uint8Array>();
function materialize(pack: Uint8Array, index: string): number {
  const rows = JSON.parse(index) as IndexRow[];
  for (const [kind, path, off, size, m, a, c, b] of rows) {
    if (kind === 1) upper.mkdirSync(path, { recursive: true });
    else {
      const view = pack.subarray(off, off + size);
      templateViews.add(view);
      upper.writeFileSync(path, view);
    }
    upper.restoreStatSync(path, { mtimeMs: m, atimeMs: a, ctimeMs: c, birthtimeMs: b });
  }
  return rows.length;
}
/** The changed files only (entries whose bytes are not the template's own view), as ADR-0567 bytes. */
function captureDiff(maxBytes: number): Uint8Array {
  const diff = new MemoryFsSync();
  const walk = (dir: string): void => {
    for (const d of upper.readdirSync(dir)) {
      const p = `${dir === '/' ? '' : dir}/${d.name}`;
      if (d.isDirectory) walk(p);
      else {
        const bytes = upper.readFileBytesSync(p);
        if (templateViews.has(bytes)) continue;
        diff.mkdirSync(parentOf(p), { recursive: true });
        diff.writeFileSync(p, bytes);
      }
    }
  };
  walk('/');
  return snapshotFs(diff as never, { template: null, maxBytes });
}

Object.defineProperty(globalThis, '__probe', {
  value: Object.freeze({
    overlay: () => setSyncMirror(new Overlay() as never),
    remote: () => setSyncMirror(new RemoteFs() as never),
    materialize,
    captureDiff,
    counters: () => JSON.stringify(counters),
  }),
  configurable: true,
});
