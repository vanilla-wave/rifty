/** Superseded by layered.ts (kept for gen.mjs: the generator finds N2 here).
 * Probe prototype (NOT a design to copy): one layered FS for both the consumer's host ops and
 * the guest's run. The upper is rifty's own `MemoryFsSync`; template entries are materialized
 * into it lazily — a directory's children on first touch, files as references into the
 * template's one buffer, the template's times — and every operation then runs on the upper
 * unchanged, so semantics and errors are MemoryFsSync's by construction. The difference is
 * derived, never accumulated: entries that are not pristine materializations, plus template
 * paths that were materialized and are gone.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';

export interface Times {
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
}
export interface LowerEntry extends Times {
  readonly dir: boolean;
  readonly bytes?: Uint8Array;
}
/** The template: an immutable index over one buffer. */
export interface Lower {
  get(path: string): LowerEntry | undefined;
  children(path: string): readonly string[];
}
/** Rows: [kind 1 dir | 2 file, path, offset, size, mtime, atime, ctime, birthtime], parents first. */
export type Row = readonly [number, string, number, number, number, number, number, number];

export function templateLayer(pack: Uint8Array, rows: readonly Row[]): Lower {
  const entries = new Map<string, LowerEntry>();
  const kids = new Map<string, string[]>();
  const add = (p: string, e: LowerEntry): void => {
    entries.set(p, e);
    if (e.dir) kids.set(p, []);
    if (p !== '/')
      kids.get(parentOf(p))?.push(p.slice(parentOf(p).length + (parentOf(p) === '/' ? 0 : 1)));
  };
  if (!rows.some((r) => r[1] === '/'))
    add('/', { dir: true, mtimeMs: 0, atimeMs: 0, ctimeMs: 0, birthtimeMs: 0 });
  for (const [k, p, off, size, mtimeMs, atimeMs, ctimeMs, birthtimeMs] of rows)
    add(p, {
      dir: k === 1,
      ...(k === 2 ? { bytes: pack.subarray(off, off + size) } : {}),
      mtimeMs,
      atimeMs,
      ctimeMs,
      birthtimeMs,
    });
  for (const list of kids.values()) list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { get: (p) => entries.get(p), children: (p) => kids.get(p) ?? [] };
}

export const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
const join = (d: string, n: string): string => (d === '/' ? `/${n}` : `${d}/${n}`);
const under = (p: string, root: string): boolean =>
  p === root || p.startsWith(root === '/' ? '/' : `${root}/`);
const timesOf = (e: Times): Times => ({
  mtimeMs: e.mtimeMs,
  atimeMs: e.atimeMs,
  ctimeMs: e.ctimeMs,
  birthtimeMs: e.birthtimeMs,
});
const norm = (p: string): string => {
  const parts: string[] = [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') parts.pop();
    else parts.push(s);
  }
  return `/${parts.join('/')}`;
};

export const counters = { lookups: 0, materialized: 0 };

export class LayeredFs {
  readonly upper = new MemoryFsSync();
  /** Upper directory → its template directory, children not yet materialized. */
  readonly #lazy = new Map<string, string>([['/', '/']]);
  /** Upper path → the template entry it was materialized from. */
  readonly #pristine = new Map<string, { lower: string; bytes?: Uint8Array; times: Times }>();
  readonly lower: Lower;

  constructor(lower: Lower) {
    this.lower = lower;
  }

  #materialize(dir: string): void {
    const low = this.#lazy.get(dir);
    if (low === undefined) return;
    this.#lazy.delete(dir);
    const own = this.#pristine.get(dir);
    for (const name of this.lower.children(low)) {
      counters.lookups++;
      const up = join(dir, name);
      const lp = join(low, name);
      const e = this.lower.get(lp) as LowerEntry;
      if (e.dir) {
        this.upper.mkdirSync(up, {});
        this.#lazy.set(up, lp);
      } else this.upper.writeFileSync(up, e.bytes as Uint8Array);
      this.upper.restoreStatSync(up, timesOf(e));
      this.#pristine.set(up, {
        lower: lp,
        ...(e.bytes ? { bytes: e.bytes } : {}),
        times: timesOf(e),
      });
      counters.materialized++;
    }
    // Creating its children moved the directory's times: put back the template's.
    if (own !== undefined) this.upper.restoreStatSync(dir, own.times);
    else if (dir === '/' && this.lower.get('/'))
      this.upper.restoreStatSync('/', timesOf(this.lower.get('/') as LowerEntry));
  }
  /** Every existing ancestor of `p` materialized (its own children decided by the upper). */
  #touch(p: string): void {
    this.#materialize('/');
    let cur = '/';
    const parts = p.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      cur = join(cur, parts[i] as string);
      if (this.#lazy.has(cur)) this.#materialize(cur);
      else if (!this.upper.existsSync(cur)) return;
    }
  }
  #touchSelf(p: string): void {
    this.#touch(p);
    this.#materialize(p);
  }
  #touchTree(p: string): void {
    this.#touchSelf(p);
    if (!this.upper.existsSync(p) || !this.upper.statSync(p).isDirectory) return;
    for (const d of this.upper.readdirSync(p)) if (d.isDirectory) this.#touchTree(join(p, d.name));
  }
  /** Lazy markers under `from` follow a rename to `to`; under a removed path they go. */
  #rekey(from: string, to: string | null): void {
    for (const [k, v] of [...this.#lazy]) {
      if (!under(k, from)) continue;
      this.#lazy.delete(k);
      if (to !== null) this.#lazy.set(to + k.slice(from.length), v);
    }
  }

  // ---- FsSync, each call on the upper after the touch it needs ----
  /** `fn` on the upper once the path's ancestors are materialized. */
  #at<T>(p: string, fn: () => T): T {
    this.#touch(norm(p));
    return fn();
  }
  existsSync = (p: string): boolean => this.#at(p, () => this.upper.existsSync(p));
  statSync = (p: string) => this.#at(p, () => this.upper.statSync(p));
  statSyncOrNull = (p: string) => this.#at(p, () => this.upper.statSyncOrNull(p));
  readFileBytesSync = (p: string): Uint8Array => this.#at(p, () => this.upper.readFileBytesSync(p));
  writeFileSync = (p: string, d: Uint8Array): void =>
    this.#at(p, () => this.upper.writeFileSync(p, d));
  readdirSync = (p: string) => {
    this.#touchSelf(norm(p));
    return this.upper.readdirSync(p);
  };
  mkdirSync = (p: string, o: { recursive?: boolean }): void => {
    this.#touch(norm(p));
    this.upper.mkdirSync(p, o);
  };
  rmSync = (p: string, o: { recursive?: boolean; force?: boolean }): void => {
    const n = norm(p);
    this.#touchSelf(n);
    this.upper.rmSync(p, o);
    if (!this.upper.existsSync(n)) this.#rekey(n, null);
  };
  utimes = (p: string, a: number, m: number): void => this.#at(p, () => this.upper.utimes(p, a, m));
  restoreStatSync = (p: string, t: Times): void =>
    this.#at(p, () => this.upper.restoreStatSync(p, t));
  copyFileSync = (s: string, d: string): void => {
    this.#touch(norm(s));
    this.#touch(norm(d));
    this.upper.copyFileSync(s, d);
  };
  cpSync = (s: string, d: string, o?: { recursive?: boolean }): void => {
    this.#touchTree(norm(s));
    this.#touch(norm(d));
    this.upper.cpSync(s, d, o);
  };
  renameSync = (s: string, d: string): void => {
    const sn = norm(s);
    const dn = norm(d);
    this.#touch(sn);
    this.#touch(dn);
    if (this.upper.existsSync(dn)) this.#materialize(dn);
    this.upper.renameSync(s, d);
    if (sn !== dn && !under(dn, sn)) {
      this.#rekey(dn, null);
      this.#rekey(sn, dn);
    }
  };

  /**
   * The difference, derived: entries that are not pristine materializations (with their parent
   * directories), and template paths that were materialized and are gone (topmost only).
   */
  difference(): { entries: MemoryFsSync; deleted: string[] } {
    // A moved lazy directory carries template entries under a new path: materialize it to emit them.
    for (const [k, v] of [...this.#lazy]) if (k !== v) this.#touchTree(k);
    const out = new MemoryFsSync();
    const ensure = (dir: string): void => {
      if (out.existsSync(dir)) return;
      ensure(parentOf(dir));
      out.mkdirSync(dir, {});
    };
    const fixTimes: string[] = [];
    const walk = (dir: string): void => {
      for (const d of this.upper.readdirSync(dir)) {
        const p = join(dir, d.name);
        const st = this.upper.statSync(p);
        const pr = this.#pristine.get(p);
        const times = {
          mtimeMs: st.mtime as number,
          atimeMs: st.atime as number,
          ctimeMs: st.metadata?.ctime as number,
          birthtimeMs: st.metadata?.birthtime as number,
        };
        const sameTimes =
          pr !== undefined &&
          pr.times.mtimeMs === times.mtimeMs &&
          pr.times.atimeMs === times.atimeMs &&
          pr.times.ctimeMs === times.ctimeMs &&
          pr.times.birthtimeMs === times.birthtimeMs;
        const pristine =
          pr !== undefined &&
          pr.lower === p &&
          sameTimes &&
          (d.isDirectory ? pr.bytes === undefined : this.upper.readFileBytesSync(p) === pr.bytes);
        if (d.isDirectory) {
          if (!pristine) {
            ensure(p);
            fixTimes.push(p);
          }
          if (!this.#lazy.has(p)) walk(p);
        } else if (!pristine) {
          ensure(dir);
          out.writeFileSync(p, this.upper.readFileBytesSync(p));
          out.restoreStatSync(p, times);
        }
      }
    };
    walk('/');
    for (const p of [...fixTimes, ...[...listDirs(out)].filter((q) => q !== '/')]) {
      const st = this.upper.statSync(p);
      out.restoreStatSync(p, {
        mtimeMs: st.mtime as number,
        atimeMs: st.atime as number,
        ctimeMs: st.metadata?.ctime as number,
        birthtimeMs: st.metadata?.birthtime as number,
      });
    }
    const gone: string[] = [];
    for (const [p, pr] of this.#pristine)
      if (pr.lower === p && !this.upper.existsSync(p)) gone.push(p);
    gone.sort();
    const deleted: string[] = [];
    for (const p of gone) if (!deleted.some((q) => under(p, q))) deleted.push(p);
    return { entries: out, deleted };
  }

  /** Apply a difference over a fresh template view: deletions, then entries (pre-order). */
  apply(entries: MemoryFsSync, deleted: readonly string[]): void {
    for (const p of deleted) this.rmSync(p, { recursive: true, force: true });
    const walk = (dir: string): void => {
      for (const d of entries.readdirSync(dir)) {
        const p = join(dir, d.name);
        const st = entries.statSync(p);
        const t = {
          mtimeMs: st.mtime as number,
          atimeMs: st.atime as number,
          ctimeMs: st.metadata?.ctime as number,
          birthtimeMs: st.metadata?.birthtime as number,
        };
        if (d.isDirectory) {
          if (!this.existsSync(p)) this.mkdirSync(p, {});
          walk(p);
          this.restoreStatSync(p, t);
        } else {
          this.writeFileSync(p, entries.readFileBytesSync(p));
          this.restoreStatSync(p, t);
        }
      }
    };
    walk('/');
  }
}

function* listDirs(fs: MemoryFsSync, dir = '/'): Generator<string> {
  yield dir;
  for (const d of fs.readdirSync(dir)) if (d.isDirectory) yield* listDirs(fs, join(dir, d.name));
}
