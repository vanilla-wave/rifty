/**
 * Probe prototype (NOT a design to copy) of ADR-0572 §2, second construction (review N2): one
 * layered FS for the consumer's host ops and the guest's run, whose state is described by node
 * identity — never derived from path existence or times.
 *
 * The upper is rifty's own `MemoryFsSync`. A template directory enters it lazily: an empty
 * directory node + a marker "these children are template directory L" (its children are
 * materialized on first touch of a path through it). A template file enters it as a node whose
 * bytes ARE the template's bytes (the same reference) + an origin record. Every call then runs on
 * the `MemoryFsSync` unchanged. Origins and markers follow their node on `rename` and go with it
 * on `rm`.
 *
 * The state on the wire is the upper itself, every node it holds, pre-order:
 *   - a directory with a marker → `lazy(L)` (its whole template subtree, untouched);
 *   - any other directory → explicit (its children are exactly the ones listed);
 *   - a file whose bytes are still its origin's reference → `ref(L)`; any other file → its bytes;
 *   all with their times.
 * There is no deletion list and no merge with the template: an explicit directory is opaque, so
 * whatever is not listed under it does not exist. Applying = rebuilding the same upper.
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
export interface Lower {
  get(path: string): LowerEntry | undefined;
  children(path: string): readonly string[];
}
/** Rows: [kind 1 dir | 2 file, path, offset, size, mtime, atime, ctime, birthtime], parents first. */
export type Row = readonly [number, string, number, number, number, number, number, number];
/** A wire row for what the blob does not carry: [path, 'lazy' | 'ref', template path, times]. */
export type RefRow = readonly [string, 'lazy' | 'ref', string, Times];

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
const depth = (p: string): number => (p === '/' ? 0 : p.split('/').length - 1);

export const counters = { lookups: 0, materialized: 0, accounted: 0 };

export class LayeredFs {
  readonly upper = new MemoryFsSync();
  /** Directory node → the template directory its children come from, not yet materialized. */
  readonly #lazy = new Map<string, string>();
  /** File node → the template file whose bytes it still holds (identity, not equality). */
  readonly #origin = new Map<string, { lower: string; bytes: Uint8Array }>();
  /** ADR-0567 §7's budget over the state on the wire, kept per operation (never a walk). */
  #budget = 0;
  readonly lower: Lower;

  constructor(lower: Lower, root = true) {
    this.lower = lower;
    if (root) {
      this.#lazy.set('/', '/');
      const r = lower.get('/');
      if (r) this.upper.restoreStatSync('/', timesOf(r));
    }
  }

  /** Budget of one node as the wire carries it. */
  #cost(p: string): number {
    counters.accounted++;
    const st = this.upper.statSync(p);
    const own = st.isFile && this.#origin.get(p)?.bytes === this.upper.readFileBytesSync(p);
    return 384 + 8 * p.length + 80 * depth(p) + (st.isFile && !own ? (st.size ?? 0) : 0);
  }
  /** Budget of the materialized subtree at `p` (the op's own footprint, never the template). */
  #costTree(p: string): number {
    if (!this.upper.existsSync(p)) return 0;
    let n = this.#cost(p);
    if (this.upper.statSync(p).isDirectory)
      for (const d of this.upper.readdirSync(p)) n += this.#costTree(join(p, d.name));
    return n;
  }
  budget(): number {
    return this.#budget;
  }

  #materialize(dir: string): void {
    const low = this.#lazy.get(dir);
    if (low === undefined) return;
    this.#lazy.delete(dir);
    const st = this.upper.statSync(dir);
    const own = {
      mtimeMs: st.mtime as number,
      atimeMs: st.atime as number,
      ctimeMs: st.metadata?.ctime as number,
      birthtimeMs: st.metadata?.birthtime as number,
    };
    for (const name of this.lower.children(low)) {
      counters.lookups++;
      const up = join(dir, name);
      const lp = join(low, name);
      const e = this.lower.get(lp) as LowerEntry;
      if (e.dir) {
        this.upper.mkdirSync(up, {});
        this.#lazy.set(up, lp);
      } else {
        this.upper.writeFileSync(up, e.bytes as Uint8Array);
        this.#origin.set(up, { lower: lp, bytes: e.bytes as Uint8Array });
      }
      this.upper.restoreStatSync(up, timesOf(e));
      this.#budget += this.#cost(up);
      counters.materialized++;
    }
    // Materializing is not a change: the directory keeps its own times, whatever they are.
    this.upper.restoreStatSync(dir, own);
  }
  /** Every existing ancestor of `p` materialized. */
  #touch(p: string): void {
    // Nothing left lazy: nothing to materialize (the common case once a run has touched its paths).
    if (this.#lazy.size === 0) return;
    this.#materialize('/');
    // A marker exists only on an existing directory, so a lookup per ancestor is enough.
    let at = p.indexOf('/', 1);
    while (at !== -1) {
      const cur = p.slice(0, at);
      if (this.#lazy.has(cur)) this.#materialize(cur);
      at = p.indexOf('/', at + 1);
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
  /** Markers and origins under `from` follow a rename to `to`, or go (`to` null). */
  #rekey(from: string, to: string | null): void {
    for (const m of [this.#lazy, this.#origin] as Map<string, unknown>[]) {
      for (const [k, v] of [...m]) {
        if (!under(k, from)) continue;
        m.delete(k);
        if (to !== null) m.set(to + k.slice(from.length), v);
      }
    }
  }
  /** A mutation at `p` (its subtree): budget out before, run, budget in after. */
  #mutate(paths: readonly string[], fn: () => void): void {
    const before = paths.reduce((n, p) => n + this.#costTree(p), 0);
    fn();
    const after = paths.reduce((n, p) => n + this.#costTree(p), 0);
    this.#budget += after - before;
  }
  #at<T>(p: string, fn: () => T): T {
    this.#touch(norm(p));
    return fn();
  }

  // ---- FsSync ----
  existsSync = (p: string): boolean => this.#at(p, () => this.upper.existsSync(p));
  statSync = (p: string) => this.#at(p, () => this.upper.statSync(p));
  statSyncOrNull = (p: string) => this.#at(p, () => this.upper.statSyncOrNull(p));
  readFileBytesSync = (p: string): Uint8Array => this.#at(p, () => this.upper.readFileBytesSync(p));
  readdirSync = (p: string) => {
    this.#touchSelf(norm(p));
    return this.upper.readdirSync(p);
  };
  writeFileSync = (p: string, d: Uint8Array): void => {
    const n = norm(p);
    this.#touch(n);
    this.#mutate([n], () => this.upper.writeFileSync(p, d));
  };
  mkdirSync = (p: string, o: { recursive?: boolean }): void => {
    const n = norm(p);
    this.#touch(n);
    // The highest directory a recursive mkdir creates is the subtree this call adds.
    let top = n;
    while (o.recursive && top !== '/' && !this.upper.existsSync(parentOf(top))) top = parentOf(top);
    this.#mutate([top], () => this.upper.mkdirSync(p, o));
  };
  rmSync = (p: string, o: { recursive?: boolean; force?: boolean }): void => {
    const n = norm(p);
    this.#touch(n);
    // A non-recursive rm of a template directory must see its children (ENOTEMPTY); a recursive one
    // removes the node and its marker, materializing nothing.
    if (!o.recursive) this.#materialize(n);
    this.#mutate([n], () => {
      this.upper.rmSync(p, o);
      if (!this.upper.existsSync(n)) this.#rekey(n, null);
    });
  };
  utimes = (p: string, a: number, m: number): void => this.#at(p, () => this.upper.utimes(p, a, m));
  restoreStatSync = (p: string, t: Times): void =>
    this.#at(p, () => this.upper.restoreStatSync(p, t));
  copyFileSync = (s: string, d: string): void => {
    this.#touch(norm(s));
    this.#touch(norm(d));
    this.#mutate([norm(d)], () => this.upper.copyFileSync(s, d));
  };
  cpSync = (s: string, d: string, o?: { recursive?: boolean }): void => {
    // A recursive copy merges into an existing destination tree: it must hold its real children.
    this.#touchTree(norm(s));
    this.#touchTree(norm(d));
    this.#mutate([norm(d)], () => this.upper.cpSync(s, d, o));
  };
  renameSync = (s: string, d: string): void => {
    const sn = norm(s);
    const dn = norm(d);
    this.#touch(sn);
    this.#touch(dn);
    // Replacing a directory needs its real children (ENOTEMPTY); a file needs nothing more.
    if (this.upper.existsSync(dn) && this.upper.statSync(dn).isDirectory) this.#materialize(dn);
    // Markers and origins move with the node inside the measured step, so the budget after sees
    // the moved subtree as the same template-backed nodes at new paths.
    this.#mutate([sn, dn], () => {
      this.upper.renameSync(s, d);
      if (sn !== dn && !under(dn, sn) && !this.upper.existsSync(sn)) {
        this.#rekey(dn, null);
        this.#rekey(sn, dn);
      }
    });
  };

  /** The state on the wire: explicit nodes (blob) + lazy/ref rows. O(the nodes held). */
  toWire(): { entries: MemoryFsSync; refs: RefRow[] } {
    const entries = new MemoryFsSync();
    const refs: RefRow[] = [];
    const tOf = (p: string): Times => {
      const st = this.upper.statSync(p);
      return {
        mtimeMs: st.mtime as number,
        atimeMs: st.atime as number,
        ctimeMs: st.metadata?.ctime as number,
        birthtimeMs: st.metadata?.birthtime as number,
      };
    };
    const walk = (dir: string): void => {
      for (const d of this.upper.readdirSync(dir)) {
        const p = join(dir, d.name);
        const t = tOf(p);
        if (d.isDirectory) {
          const lz = this.#lazy.get(p);
          if (lz !== undefined) refs.push([p, 'lazy', lz, t]);
          else {
            entries.mkdirSync(p, {});
            walk(p);
            entries.restoreStatSync(p, t);
          }
        } else {
          const o = this.#origin.get(p);
          const bytes = this.upper.readFileBytesSync(p);
          if (o !== undefined && o.bytes === bytes) refs.push([p, 'ref', o.lower, t]);
          else {
            entries.writeFileSync(p, bytes);
            entries.restoreStatSync(p, t);
          }
        }
      }
    };
    const rootLazy = this.#lazy.get('/');
    if (rootLazy !== undefined) refs.push(['/', 'lazy', rootLazy, tOf('/')]);
    else walk('/');
    entries.restoreStatSync('/', tOf('/'));
    return { entries, refs };
  }

  /** Rebuild the same upper from the wire (the consumer validates the rows first). */
  static fromWire(lower: Lower, entries: MemoryFsSync, refs: readonly RefRow[]): LayeredFs {
    const L = new LayeredFs(lower, false);
    const byPath = new Map(refs.map((r) => [r[0], r] as const));
    const root = byPath.get('/');
    if (root !== undefined) {
      L.#lazy.set('/', root[2]);
      L.upper.restoreStatSync('/', root[3]);
      return L;
    }
    // Pre-order over the blob's explicit nodes and the rows, by path.
    const kids = new Map<string, string[]>();
    for (const r of refs) {
      const par = parentOf(r[0]);
      const list = kids.get(par) ?? [];
      list.push(r[0]);
      kids.set(par, list);
    }
    const build = (dir: string): void => {
      const names = new Set<string>();
      for (const d of entries.readdirSync(dir)) names.add(join(dir, d.name));
      for (const q of kids.get(dir) ?? []) names.add(q);
      for (const p of [...names].sort()) {
        const row = byPath.get(p);
        if (row !== undefined) {
          const e = lower.get(row[2]);
          if (row[1] === 'lazy') {
            L.upper.mkdirSync(p, {});
            L.#lazy.set(p, row[2]);
          } else {
            L.upper.writeFileSync(p, e?.bytes as Uint8Array);
            L.#origin.set(p, { lower: row[2], bytes: e?.bytes as Uint8Array });
          }
          L.upper.restoreStatSync(p, row[3]);
        } else {
          const st = entries.statSync(p);
          const t = {
            mtimeMs: st.mtime as number,
            atimeMs: st.atime as number,
            ctimeMs: st.metadata?.ctime as number,
            birthtimeMs: st.metadata?.birthtime as number,
          };
          if (st.isDirectory) {
            L.upper.mkdirSync(p, {});
            build(p);
          } else L.upper.writeFileSync(p, entries.readFileBytesSync(p));
          L.upper.restoreStatSync(p, t);
        }
      }
    };
    build('/');
    const st = entries.statSync('/');
    L.upper.restoreStatSync('/', {
      mtimeMs: st.mtime as number,
      atimeMs: st.atime as number,
      ctimeMs: st.metadata?.ctime as number,
      birthtimeMs: st.metadata?.birthtime as number,
    });
    L.#budget = L.#costTree('/');
    return L;
  }
}
