import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { resetSyncMirror, syncMirror } from './fs-sync-mirror.ts';
import { FSWatcher, type StatsLike, unwatchFile, watch, watchFile } from './fs-watch.ts';
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
    expect(() => watch('/w', { encoding: 'buffer' }, () => {})).toThrow(/Not implemented/);
    expect(() => watch('/w', 'buffer', () => {})).toThrow(/Not implemented/);
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
    const seen: StatsLike[] = [];
    watchFile('/some-dir', { interval: 50 }, (curr) => seen.push(curr));
    // Trigger a change so the listener fires: bump mtime via utimes.
    fs.utimes('/some-dir', 5_000, 5_000);
    vi.advanceTimersByTime(60);
    unwatchFile('/some-dir');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.isDirectory()).toBe(true);
    expect(seen[0]?.isFile()).toBe(false);
  });
});
