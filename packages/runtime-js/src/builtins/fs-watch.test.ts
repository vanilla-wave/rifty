import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { Stats } from './fs-stats.ts';
import { resetSyncMirror, syncMirror } from './fs-sync-mirror.ts';
import { FSWatcher, unwatchFile, watch, watchFile } from './fs-watch.ts';
import { installTimerGlobals } from './timers.ts';

afterEach(() => resetKeepalive());

describe('FSWatcher ref/unref drive the keepalive refcount via the poll timer', () => {
  it('unref() opts the active watcher out of keepalive; ref() opts back in', () => {
    const original = {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    try {
      installTimerGlobals();
      const watcher = new FSWatcher();
      watcher._start(() => {}, 1000);

      // The poll setInterval is keepalive-counted (an active watcher holds the realm).
      expect(activeRefs()).toBe(1);

      // unref() must release it (Node parity) — not a no-op stub that lies.
      expect(watcher.unref()).toBe(watcher);
      expect(activeRefs()).toBe(0);

      expect(watcher.ref()).toBe(watcher);
      expect(activeRefs()).toBe(1);

      watcher.close();
      expect(activeRefs()).toBe(0);
    } finally {
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    }
  });
});

describe('fs.watch options honesty (review 2026-07-05)', () => {
  afterEach(() => resetSyncMirror());

  it('persistent:false unrefs the poll timer instead of silently ignoring the field', () => {
    const original = {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    try {
      installTimerGlobals();
      syncMirror().mkdirSync('/w', { recursive: true });
      const persistent = watch('/w', { interval: 1000 }, () => {});
      expect(activeRefs()).toBe(1);
      persistent.close();
      const transient = watch('/w', { interval: 1000, persistent: false }, () => {});
      expect(activeRefs()).toBe(0);
      transient.close();
    } finally {
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    }
  });

  it("encoding:'buffer' is a loud gap, not a silently-utf8 string", () => {
    // The gap fires only where Node would SUCCEED — so the target must exist.
    syncMirror().mkdirSync('/w', { recursive: true });
    expect(() => watch('/w', { encoding: 'buffer' }, () => {})).toThrow(/Not implemented/);
    expect(() => watch('/w', 'buffer', () => {})).toThrow(/Not implemented/);
  });

  it('a missing target is ENOENT/watch even with a rifty-unsupported encoding', () => {
    // Node: 'buffer' is a VALID encoding, so the missing target decides —
    // ENOENT, syscall 'watch' (probed v24). The NotImplementedError gap must
    // not shadow Node's error path (observable-order axis).
    const err = (() => {
      try {
        watch('/missing-dir', { encoding: 'buffer' }, () => {});
      } catch (e) {
        return e as NodeJS.ErrnoException;
      }
      throw new Error('expected throw');
    })();
    expect(err.code).toBe('ENOENT');
    expect(err.syscall).toBe('watch');
  });

  it('an invalid encoding VALUE is rejected before target existence (Node order)', () => {
    // Node: assertEncoding runs in option parsing — ERR_INVALID_ARG_VALUE for
    // 'bogus' even when the target is missing (probed v24).
    for (const target of ['/w-exists', '/w-missing']) {
      if (target === '/w-exists') syncMirror().mkdirSync(target, { recursive: true });
      const err = (() => {
        try {
          watch(target, { encoding: 'bogus' }, () => {});
        } catch (e) {
          return e as { code?: string; message?: string };
        }
        throw new Error('expected throw');
      })();
      expect(err.code).toBe('ERR_INVALID_ARG_VALUE');
      expect(err.message).toContain("invalid encoding. Received 'bogus'");
    }
  });

  it('rejects invalid watch overloads synchronously like Node', () => {
    syncMirror().mkdirSync('/w', { recursive: true });
    expect(() => watch('/w', 123 as never)).toThrow(/options.*string or object/);
    expect(() => watch('/w', {}, 'not-a-listener' as never)).toThrow(/listener.*function/);
    expect(() => watch('/w', 'utf8', 'not-a-listener' as never)).toThrow(/listener.*function/);
  });

  it('watch(path, null, listener) is accepted as default options (Node parity)', () => {
    syncMirror().mkdirSync('/w', { recursive: true });
    const watcher = watch('/w', null as never, () => {});
    expect(watcher).toBeInstanceOf(FSWatcher);
    watcher.close();
  });

  it('pre-aborted signal still lets callers observe close after construction', async () => {
    syncMirror().writeFileSync('/aborted.txt', new TextEncoder().encode('x'));
    const controller = new AbortController();
    controller.abort();
    const watcher = watch('/aborted.txt', { signal: controller.signal });
    const events: string[] = [];
    watcher.on('close', () => events.push('close'));
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(events).toEqual(['close']);
  });
});

describe('fs.watch recursive semantics (review 2026-07-05)', () => {
  beforeEach(() => {
    resetSyncMirror();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetSyncMirror();
  });

  const enc = new TextEncoder();

  function seed(): void {
    const fs = syncMirror();
    fs.mkdirSync('/workspace/src/components', { recursive: true });
    fs.writeFileSync('/workspace/top.txt', enc.encode('t'));
    fs.writeFileSync('/workspace/src/components/Button.tsx', enc.encode('b'));
  }

  it('recursive:true reports nested creation and modification with the RELATIVE subpath', () => {
    seed();
    const events: Array<[string, string | null]> = [];
    const watcher = watch('/workspace', { recursive: true, interval: 50 }, (ev, name) =>
      events.push([ev, name]),
    );
    syncMirror().writeFileSync('/workspace/src/components/New.tsx', enc.encode('n'));
    vi.advanceTimersByTime(60);
    expect(events).toContainEqual(['rename', 'src/components/New.tsx']);

    events.length = 0;
    syncMirror().writeFileSync('/workspace/src/components/Button.tsx', enc.encode('bb'));
    vi.advanceTimersByTime(60);
    expect(events).toContainEqual(['change', 'src/components/Button.tsx']);
    watcher.close();
  });

  it('default (non-recursive, Node parity) sees direct children only', () => {
    seed();
    const events: Array<[string, string | null]> = [];
    const watcher = watch('/workspace', { interval: 50 }, (ev, name) => events.push([ev, name]));
    syncMirror().writeFileSync('/workspace/src/components/New.tsx', enc.encode('n'));
    syncMirror().writeFileSync('/workspace/direct.txt', enc.encode('d'));
    vi.advanceTimersByTime(60);
    expect(events).toContainEqual(['rename', 'direct.txt']);
    expect(events.some(([, name]) => name?.includes('New.tsx'))).toBe(false);
    watcher.close();
  });

  it('recursive deletion of a nested file is reported', () => {
    seed();
    const events: Array<[string, string | null]> = [];
    const watcher = watch('/workspace', { recursive: true, interval: 50 }, (ev, name) =>
      events.push([ev, name]),
    );
    syncMirror().rmSync('/workspace/src/components/Button.tsx', {});
    vi.advanceTimersByTime(60);
    expect(events).toContainEqual(['rename', 'src/components/Button.tsx']);
    watcher.close();
  });
});

describe('fs.watchFile Stats truthfulness (review 2026-07-05)', () => {
  beforeEach(() => {
    resetSyncMirror();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetSyncMirror();
  });

  it('reports isDirectory()=true for a watched directory', () => {
    const fs = syncMirror();
    fs.mkdirSync('/some-dir', { recursive: true });
    const seen: Stats[] = [];
    watchFile('/some-dir', { interval: 50 }, (curr) => seen.push(curr));
    // Trigger a change so the listener fires: bump mtime via utimes.
    fs.utimes('/some-dir', 5_000, 5_000);
    vi.advanceTimersByTime(60);
    unwatchFile('/some-dir');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.isDirectory()).toBe(true);
    expect(seen[0]?.isFile()).toBe(false);
  });

  it('rejects an explicit undefined options slot like Node', () => {
    const fs = syncMirror();
    fs.writeFileSync('/undef.txt', new TextEncoder().encode('one'));
    expect(() => watchFile('/undef.txt', undefined, () => {})).toThrow(/listener.*function/);
  });

  it('rejects unsupported bigint stats instead of returning number stats', () => {
    expect(() => watchFile('/some-dir', { interval: 50, bigint: true }, () => {})).toThrow(
      /Not implemented: fs\.watchFile\.bigint/,
    );
  });

  it('rejects non-number interval instead of letting setInterval coerce it', () => {
    expect(() => watchFile('/some-dir', { interval: '1' as never }, () => {})).toThrow(
      /interval.*number/,
    );
  });

  it('rejects out-of-range intervals with ERR_OUT_OF_RANGE and accepts 0 (Node uint32 rule)', () => {
    // Node validates interval as uint32 (probed v24): NaN/fractional/Infinity
    // → "must be an integer", negative → the range message; 0 is VALID. The
    // interval check outranks the bigint gap (probed: bigint+bad interval →
    // ERR_OUT_OF_RANGE). Parity: fs/watchfile-overloads.
    const codeOf = (interval: number): string | undefined => {
      try {
        watchFile('/some-dir', { interval }, () => {});
        unwatchFile('/some-dir');
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return undefined;
    };
    for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 4294967296]) {
      expect(codeOf(bad)).toBe('ERR_OUT_OF_RANGE');
    }
    expect(codeOf(0)).toBeUndefined();
    expect(() => watchFile('/x', { interval: 1.5 }, () => {})).toThrow(/must be an integer/);
    expect(() => watchFile('/x', { interval: -1 }, () => {})).toThrow(
      /must be >= 0 && <= 4294967295/,
    );
    expect(() => watchFile('/x', { interval: -1, bigint: true } as never, () => {})).toThrow(
      /out of range/,
    );
  });

  it('hands the listener the SAME Stats shape statSync returns, not a bespoke twin', () => {
    const fs = syncMirror();
    fs.writeFileSync('/real-stats.txt', new TextEncoder().encode('abc'));
    const seen: Stats[] = [];
    watchFile('/real-stats.txt', { interval: 50 }, (curr) => seen.push(curr));
    fs.utimes('/real-stats.txt', 7_000, 7_000);
    vi.advanceTimersByTime(60);
    unwatchFile('/real-stats.txt');
    const curr = seen[0];
    expect(curr).toBeInstanceOf(Stats);
    expect(curr?.mtime).toBeInstanceOf(Date);
    expect(curr?.mtimeMs).toBe(7_000);
    expect(curr?.size).toBe(3);
    expect(curr?.isFile()).toBe(true);
    expect(curr?.isSymbolicLink()).toBe(false);
  });
});

// Existence/kind transitions (review 2026-07-05 handoff #4). The clock is
// PINNED to epoch 0 so created entries get mtime=0/size=0 — the OPFS
// zero-stat shape that made a size/mtime-only comparison blind. Node truth:
// parity case fs/watchfile-transitions.
describe('fs.watchFile / fs.watch existence and kind transitions', () => {
  beforeEach(() => {
    resetSyncMirror();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetSyncMirror();
  });

  it('missing target invokes the listener ONCE with all-zero curr and prev (Node ENOENT contract)', () => {
    const calls: Array<[Stats, Stats]> = [];
    watchFile('/ghost.txt', { interval: 50 }, (curr, prev) => calls.push([curr, prev]));
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(1);
    const [curr, prev] = calls[0] as [Stats, Stats];
    expect(curr.size).toBe(0);
    expect(curr.mtimeMs).toBe(0);
    expect(curr.mtime).toBeInstanceOf(Date);
    expect(curr.isFile()).toBe(false);
    expect(prev.size).toBe(0);
    // Still missing on later polls: no repeat calls.
    vi.advanceTimersByTime(200);
    expect(calls.length).toBe(1);
    unwatchFile('/ghost.txt');
  });

  it('missing→created fires even when the new file has size 0 and mtime 0', () => {
    const calls: Array<[Stats, Stats]> = [];
    watchFile('/late.txt', { interval: 50 }, (curr, prev) => calls.push([curr, prev]));
    vi.advanceTimersByTime(60); // the one-shot zeroed "missing" call
    calls.length = 0;
    syncMirror().writeFileSync('/late.txt', new Uint8Array());
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(1);
    expect((calls[0] as [Stats, Stats])[0].isFile()).toBe(true);
    unwatchFile('/late.txt');
  });

  it('file→directory swap with identical size and mtime is visible', () => {
    syncMirror().writeFileSync('/swap', new Uint8Array());
    const calls: Array<[Stats, Stats]> = [];
    watchFile('/swap', { interval: 50 }, (curr, prev) => calls.push([curr, prev]));
    syncMirror().rmSync('/swap', {});
    syncMirror().mkdirSync('/swap', {});
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(1);
    expect((calls[0] as [Stats, Stats])[0].isDirectory()).toBe(true);
    expect((calls[0] as [Stats, Stats])[1].isFile()).toBe(true);
    unwatchFile('/swap');
  });

  it('fs.watch reports a child file→directory swap as rename even with equal size/mtime', () => {
    const fs = syncMirror();
    fs.mkdirSync('/w', { recursive: true });
    fs.writeFileSync('/w/entry', new Uint8Array());
    const events: Array<[string, string | null]> = [];
    const watcher = watch('/w', { interval: 50 }, (ev, name) => events.push([ev, name]));
    fs.rmSync('/w/entry', {});
    fs.mkdirSync('/w/entry', {});
    vi.advanceTimersByTime(60);
    expect(events).toContainEqual(['rename', 'entry']);
    watcher.close();
  });
});
