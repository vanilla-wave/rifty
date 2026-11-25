/**
 * Probe prototype (NOT a design to copy) of ADR-0572 §2: one layered FS for the consumer's host
 * ops and the guest's run, its state described by node identity — never derived from path
 * existence. (`layered-v1.ts`: existence-derived; `layered-v2.ts`: every held node on the wire.)
 *
 * The upper is rifty's own `MemoryFsSync`; every call runs on it unchanged after the touch it
 * needs. A template directory enters it as a directory node with an origin (the template
 * directory it is) and, until first touched through, a lazy mark (children not yet materialized);
 * a template file as a node whose bytes ARE the template's bytes (the same reference) with an
 * origin. Origins and marks belong to their node: they move with it on `rename`, go with it on
 * `rm`. A node is UNTOUCHED FROM its origin O when its kind is O's, its times are O's, a file's
 * bytes are O's reference, and a directory's subtree saw no mutation since it was materialized or
 * rebuilt (`#changed` holds every directory above a mutation).
 *
 * The rule, once — the state on the wire, from `/` down:
 *   - a node untouched from its origin O is one row: `lazy(O)` for a directory (its whole subtree,
 *     not descended into), `ref(O)` for a file;
 *   - any other directory is explicit and opaque (its children are exactly the ones described
 *     under it, each by this rule); any other file carries its bytes; all with their times.
 * So reading never changes the state, an untouched template directory is one row wherever it is,
 * and rebuilding = recreating the same nodes (no deletion list, no merge).
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
/** A wire row for a node the blob does not carry: [path, 'lazy' | 'ref', template path, times]. */
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
const sameTimes = (a: Times, b: Times): boolean =>
  a.mtimeMs === b.mtimeMs &&
  a.atimeMs === b.atimeMs &&
  a.ctimeMs === b.ctimeMs &&
  a.birthtimeMs === b.birthtimeMs;
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
/** ADR-0567 §7's charge of one wire entry (a row or an explicit node), bytes apart. */
const charge = (p: string): number => 384 + 8 * p.length + 80 * depth(p);

export const counters = { lookups: 0, materialized: 0, described: 0 };

export class LayeredFs {
  readonly upper = new MemoryFsSync();
  /** Directory → its template directory (origin); `#lazy` ⊆ these: children not materialized. */
  readonly #dirOrigin = new Map<string, string>();
  readonly #lazy = new Set<string>();
  /** File → the template file whose bytes it holds (identity). */
  readonly #origin = new Map<string, { lower: string; bytes: Uint8Array }>();
  /** Directories with a mutation at or below them since materialized / rebuilt. */
  readonly #changed = new Set<string>();
  readonly lower: Lower;

  constructor(lower: Lower, root = true) {
    this.lower = lower;
    if (root) {
      this.#dirOrigin.set('/', '/');
      this.#lazy.add('/');
      const r = lower.get('/');
      if (r) this.upper.restoreStatSync('/', timesOf(r));
    }
  }

  #timesAt(p: string): Times {
    const st = this.upper.statSync(p);
    return {
      mtimeMs: st.mtime as number,
      atimeMs: st.atime as number,
      ctimeMs: st.metadata?.ctime as number,
      birthtimeMs: st.metadata?.birthtime as number,
    };
  }

  #materialize(dir: string): void {
    if (!this.#lazy.has(dir)) return;
    this.#lazy.delete(dir);
    const low = this.#dirOrigin.get(dir) as string;
    const own = this.#timesAt(dir);
    for (const name of this.lower.children(low)) {
      counters.lookups++;
      const up = join(dir, name);
      const lp = join(low, name);
      const e = this.lower.get(lp) as LowerEntry;
      if (e.dir) {
        this.upper.mkdirSync(up, {});
        this.#dirOrigin.set(up, lp);
        this.#lazy.add(up);
      } else {
        this.upper.writeFileSync(up, e.bytes as Uint8Array);
        this.#origin.set(up, { lower: lp, bytes: e.bytes as Uint8Array });
      }
      this.upper.restoreStatSync(up, timesOf(e));
      counters.materialized++;
    }
    // Materializing is not a change: the directory keeps its own times.
    this.upper.restoreStatSync(dir, own);
  }
  /** Every existing ancestor of `p` materialized (a mark exists only on an existing directory). */
  #touch(p: string): void {
    if (this.#lazy.size === 0) return;
    this.#materialize('/');
    let at = p.indexOf('/', 1);
    while (at !== -1) {
      const cur = p.slice(0, at);
      if (this.#lazy.has(cur)) this.#materialize(cur);
      at = p.indexOf('/', at + 1);
    }
  }
  #touchTree(p: string): void {
    this.#touch(p);
    this.#materialize(p);
    if (!this.upper.existsSync(p) || !this.upper.statSync(p).isDirectory) return;
    for (const d of this.upper.readdirSync(p)) if (d.isDirectory) this.#touchTree(join(p, d.name));
  }
  /** A mutation at `p`: every directory from `/` down to `p` changed. */
  #dirty(p: string): void {
    this.#changed.add('/');
    let at = p.indexOf('/', 1);
    while (at !== -1) {
      this.#changed.add(p.slice(0, at));
      at = p.indexOf('/', at + 1);
    }
    this.#changed.add(p);
  }
  /** The upper's paths at and below `p` (a lazy directory is a leaf): the op's own footprint. */
  #subtree(p: string): string[] {
    if (!this.upper.existsSync(p)) return [];
    const out = [p];
    if (this.upper.statSync(p).isDirectory && !this.#lazy.has(p))
      for (const d of this.upper.readdirSync(p)) out.push(...this.#subtree(join(p, d.name)));
    return out;
  }
  /**
   * Origins, marks and change records of `paths` (collected under `from` before the call) follow a
   * rename to `to`, or go (`to` null). O(those paths), never a scan of every record.
   */
  #rekey(from: string, to: string | null, paths: readonly string[]): void {
    for (const k of paths) {
      const n = to === null ? null : to + k.slice(from.length);
      for (const m of [this.#dirOrigin, this.#origin] as Map<string, unknown>[]) {
        if (!m.has(k)) continue;
        const v = m.get(k);
        m.delete(k);
        if (n !== null) m.set(n, v);
      }
      for (const set of [this.#lazy, this.#changed]) {
        if (!set.has(k)) continue;
        set.delete(k);
        if (n !== null) set.add(n);
      }
    }
  }
  #at<T>(p: string, fn: () => T): T {
    this.#touch(norm(p));
    return fn();
  }
  #atSelf<T>(p: string, fn: () => T): T {
    const n = norm(p);
    this.#touch(n);
    this.#materialize(n);
    return fn();
  }
  /**
   * The destination paths a recursive copy of `s` to `d` writes: `d` + each path of the source
   * tree. `visit(destinationPath, isDirectory)` for each, the source walked (never the destination).
   */
  #copied(s: string, d: string, visit: (to: string, dir: boolean) => void): void {
    if (!this.upper.existsSync(s)) return;
    const dir = this.upper.statSync(s).isDirectory;
    visit(d, dir);
    if (dir)
      for (const e of this.upper.readdirSync(s))
        this.#copied(join(s, e.name), join(d, e.name), visit);
  }

  // ---- FsSync: reads change nothing; each mutation marks its path ----
  existsSync = (p: string): boolean => this.#at(p, () => this.upper.existsSync(p));
  // A directory's own stat depends on its children (`nlink`): a lazy one is materialized first.
  statSync = (p: string) => this.#atSelf(p, () => this.upper.statSync(p));
  statSyncOrNull = (p: string) => this.#atSelf(p, () => this.upper.statSyncOrNull(p));
  readFileBytesSync = (p: string): Uint8Array => this.#at(p, () => this.upper.readFileBytesSync(p));
  readdirSync = (p: string) => {
    const n = norm(p);
    this.#touch(n);
    this.#materialize(n);
    return this.upper.readdirSync(p);
  };
  writeFileSync = (p: string, d: Uint8Array): void => {
    const n = norm(p);
    this.#touch(n);
    this.upper.writeFileSync(p, d);
    this.#dirty(n);
  };
  mkdirSync = (p: string, o: { recursive?: boolean }): void => {
    const n = norm(p);
    this.#touch(n);
    this.upper.mkdirSync(p, o);
    this.#dirty(n);
  };
  rmSync = (p: string, o: { recursive?: boolean; force?: boolean }): void => {
    const n = norm(p);
    this.#touch(n);
    // A non-recursive rm of a template directory must see its children (ENOTEMPTY).
    if (!o.recursive) this.#materialize(n);
    const gone = this.#subtree(n);
    this.upper.rmSync(p, o);
    if (gone.length > 0 && !this.upper.existsSync(n)) {
      this.#rekey(n, null, gone);
      this.#dirty(parentOf(n));
    }
  };
  utimes = (p: string, a: number, m: number): void => {
    const n = norm(p);
    this.#touch(n);
    this.upper.utimes(p, a, m);
    this.#dirty(n);
  };
  restoreStatSync = (p: string, t: Times): void => {
    const n = norm(p);
    this.#touch(n);
    this.upper.restoreStatSync(p, t);
    this.#dirty(n);
  };
  copyFileSync = (s: string, d: string): void => {
    this.#touch(norm(s));
    this.#touch(norm(d));
    this.upper.copyFileSync(s, d);
    this.#dirty(norm(d));
  };
  cpSync = (s: string, d: string, o?: { recursive?: boolean }): void => {
    // A recursive copy merges into the destination: the directories it writes into must hold their
    // real children — only those, found by walking the source; then every path it wrote is a mutation.
    const sn = norm(s);
    const dn = norm(d);
    this.#touchTree(sn);
    this.#touch(dn);
    this.#copied(sn, dn, (to, dir) => {
      if (dir) this.#materialize(to);
    });
    this.upper.cpSync(s, d, o);
    this.#copied(sn, dn, (to) => this.#dirty(to));
  };
  renameSync = (s: string, d: string): void => {
    const sn = norm(s);
    const dn = norm(d);
    this.#touch(sn);
    this.#touch(dn);
    // Replacing a directory needs its real children (ENOTEMPTY).
    if (this.upper.existsSync(dn) && this.upper.statSync(dn).isDirectory) this.#materialize(dn);
    const replaced = sn === dn ? [] : this.#subtree(dn);
    const moved = sn === dn ? [] : this.#subtree(sn);
    this.upper.renameSync(s, d);
    if (sn !== dn && !under(dn, sn) && !this.upper.existsSync(sn)) {
      this.#rekey(dn, null, replaced);
      this.#rekey(sn, dn, moved);
      this.#dirty(parentOf(sn));
      this.#dirty(parentOf(dn));
    }
  };

  /**
   * Times-independent audit of the change marks (probe G). A directory with an origin and no
   * change mark is emitted as one `lazy` row by its times alone, so: above every node whose
   * content is not its origin's (a file without its origin's bytes reference, a directory without
   * an origin) and at every directory whose child names / kinds differ from its origin's, no
   * directory may have an origin without a change mark. Holds whatever the backend does to times.
   */
  audit(): string[] {
    const bad: string[] = [];
    const covered = (p: string): boolean => {
      for (let q = parentOf(p); ; q = parentOf(q)) {
        if (this.#dirOrigin.has(q) && !this.#changed.has(q)) return false;
        if (q === '/') return true;
      }
    };
    const walk = (dir: string): void => {
      if (this.#lazy.has(dir)) return;
      const o = this.#dirOrigin.get(dir);
      const kids = this.upper.readdirSync(dir);
      if (o !== undefined) {
        const names = kids.map((d) => `${d.name}:${d.isDirectory ? 'd' : 'f'}`).join('|');
        const tpl = this.lower
          .children(o)
          .map((n) => `${n}:${this.lower.get(join(o, n))?.dir ? 'd' : 'f'}`)
          .join('|');
        if (names !== tpl && (!this.#changed.has(dir) || !covered(dir)))
          bad.push(`${dir} (children)`);
      }
      for (const d of kids) {
        const p = join(dir, d.name);
        if (d.isDirectory) {
          if (!this.#dirOrigin.has(p) && !covered(p)) bad.push(p);
          walk(p);
        } else {
          const og = this.#origin.get(p);
          if ((og === undefined || og.bytes !== this.upper.readFileBytesSync(p)) && !covered(p))
            bad.push(p);
        }
      }
    };
    walk('/');
    return bad;
  }

  // ---- the rule ----
  #untouchedDir(p: string): string | undefined {
    const o = this.#dirOrigin.get(p);
    if (o === undefined || this.#changed.has(p)) return undefined;
    const e = this.lower.get(o);
    return e?.dir && sameTimes(this.#timesAt(p), e) ? o : undefined;
  }
  #untouchedFile(p: string): string | undefined {
    const o = this.#origin.get(p);
    if (o === undefined || this.upper.readFileBytesSync(p) !== o.bytes) return undefined;
    const e = this.lower.get(o.lower);
    return e && sameTimes(this.#timesAt(p), e) ? o.lower : undefined;
  }
  /** Walk the rule; `emit` gets each wire item. O(the state): only changed directories are entered. */
  #describe(
    emit: (p: string, kind: 'dir' | 'file' | 'lazy' | 'ref', origin: string | null) => void,
  ): void {
    const node = (p: string): void => {
      counters.described++;
      const st = this.upper.statSync(p);
      if (st.isDirectory) {
        const o = this.#untouchedDir(p);
        if (o !== undefined) {
          emit(p, 'lazy', o);
          return;
        }
        if (p !== '/') emit(p, 'dir', null);
        this.#materialize(p);
        for (const d of this.upper.readdirSync(p)) node(join(p, d.name));
        return;
      }
      const o = this.#untouchedFile(p);
      emit(p, o !== undefined ? 'ref' : 'file', o ?? null);
    };
    node('/');
  }
  /** The state cap's count (ADR-0567 §7 units) over the state on the wire. */
  budget(): number {
    let n = 0;
    this.#describe((p, kind) => {
      n += charge(p) + (kind === 'file' ? this.upper.readFileBytesSync(p).byteLength : 0);
    });
    return n;
  }
  toWire(): { entries: MemoryFsSync; refs: RefRow[] } {
    const entries = new MemoryFsSync();
    const refs: RefRow[] = [];
    const dirs: string[] = [];
    this.#describe((p, kind, origin) => {
      const t = this.#timesAt(p);
      if (kind === 'lazy' || kind === 'ref') refs.push([p, kind, origin as string, t]);
      else if (kind === 'dir') {
        entries.mkdirSync(p, {});
        dirs.push(p);
      } else {
        entries.writeFileSync(p, this.upper.readFileBytesSync(p));
        entries.restoreStatSync(p, t);
      }
    });
    // Directories' times after their children are written.
    for (const p of dirs.reverse()) entries.restoreStatSync(p, this.#timesAt(p));
    if (!refs.some((r) => r[0] === '/')) entries.restoreStatSync('/', this.#timesAt('/'));
    return { entries, refs };
  }

  /** Rebuild the same nodes from the wire (the consumer validates the rows first). */
  static fromWire(lower: Lower, entries: MemoryFsSync, refs: readonly RefRow[]): LayeredFs {
    const L = new LayeredFs(lower, false);
    const byPath = new Map(refs.map((r) => [r[0], r] as const));
    const root = byPath.get('/');
    if (root !== undefined) {
      L.#dirOrigin.set('/', root[2]);
      L.#lazy.add('/');
      L.upper.restoreStatSync('/', root[3]);
      return L;
    }
    const kids = new Map<string, string[]>();
    for (const r of refs) {
      const list = kids.get(parentOf(r[0])) ?? [];
      list.push(r[0]);
      kids.set(parentOf(r[0]), list);
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
            L.#dirOrigin.set(p, row[2]);
            L.#lazy.add(p);
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
    return L;
  }
}
