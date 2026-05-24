/**
 * Conformance tests for `fs.watch` and `fs.watchFile` (polling-based).
 *
 * In Node these can be inotify/FSEvents-backed; in the browser we don't have
 * those, so our implementation polls the sync mirror's mtime+size at a
 * configurable interval. The watcher interface contract — `change` events
 * carry an event name + filename, watchers are closeable — matches Node.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetSyncMirror,
  syncMirror,
} from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import fs from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => {
  resetSyncMirror();
});

function nextTick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('fs.watch', () => {
  it('fires `change` when a watched file is rewritten', async () => {
    fs.writeFileSync('/a.txt', 'one');
    const events: Array<{ event: string; filename: string | null }> = [];
    const watcher = fs.watch('/a.txt', { interval: 5 }, (event, filename) => {
      events.push({ event, filename });
    });
    await nextTick();
    fs.writeFileSync('/a.txt', 'two');
    await nextTick(60);
    watcher.close();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.event).toBe('change');
    expect(events[0]?.filename).toBe('a.txt');
  });

  it('fires `rename` when a watched file is deleted', async () => {
    fs.writeFileSync('/gone.txt', 'x');
    const events: Array<{ event: string }> = [];
    const watcher = fs.watch('/gone.txt', { interval: 5 }, (event) => events.push({ event }));
    await nextTick();
    fs.unlinkSync('/gone.txt');
    await nextTick(60);
    watcher.close();
    expect(events.some((e) => e.event === 'rename')).toBe(true);
  });

  it('emits `change` on EventEmitter interface as well', async () => {
    fs.writeFileSync('/b.txt', 'one');
    const seen: string[] = [];
    const watcher = fs.watch('/b.txt', { interval: 5 });
    watcher.on('change', (event: string) => seen.push(event));
    await nextTick();
    fs.writeFileSync('/b.txt', 'two');
    await nextTick(60);
    watcher.close();
    expect(seen).toContain('change');
  });

  it('stops firing after close()', async () => {
    fs.writeFileSync('/c.txt', 'one');
    const events: string[] = [];
    const watcher = fs.watch('/c.txt', { interval: 5 }, (event) => events.push(event));
    await nextTick();
    watcher.close();
    fs.writeFileSync('/c.txt', 'two');
    await nextTick(60);
    expect(events).toEqual([]);
  });

  it('watches a directory and reports filename of changed child', async () => {
    fs.mkdirSync('/dir', { recursive: true });
    const events: Array<{ event: string; filename: string | null }> = [];
    const watcher = fs.watch('/dir', { interval: 5 }, (event, filename) => {
      events.push({ event, filename });
    });
    await nextTick();
    fs.writeFileSync('/dir/x.txt', 'hi');
    await nextTick(60);
    watcher.close();
    expect(events.some((e) => e.filename === 'x.txt' && e.event === 'rename')).toBe(true);
  });
});

describe('fs.watchFile', () => {
  it('polls and fires with current+previous Stats on change', async () => {
    fs.writeFileSync('/poll.txt', 'one');
    const calls: Array<{ curr: { size: number }; prev: { size: number } }> = [];
    fs.watchFile('/poll.txt', { interval: 5 }, (curr, prev) => {
      calls.push({ curr: { size: curr.size }, prev: { size: prev.size } });
    });
    await nextTick();
    fs.writeFileSync('/poll.txt', 'much longer content');
    await nextTick(60);
    fs.unwatchFile('/poll.txt');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.curr.size).toBeGreaterThan(calls[0]?.prev.size ?? 0);
  });

  it('unwatchFile stops polling', async () => {
    fs.writeFileSync('/u.txt', 'one');
    const calls: number[] = [];
    const listener = () => calls.push(1);
    fs.watchFile('/u.txt', { interval: 5 }, listener);
    fs.unwatchFile('/u.txt', listener);
    fs.writeFileSync('/u.txt', 'two');
    await nextTick(60);
    expect(calls).toEqual([]);
  });

  it('does nothing observable when contents do not change between polls', async () => {
    fs.writeFileSync('/idle.txt', 'same');
    syncMirror(); // ensure mirror is live
    const calls: number[] = [];
    fs.watchFile('/idle.txt', { interval: 5 }, () => calls.push(1));
    await nextTick(40);
    fs.unwatchFile('/idle.txt');
    expect(calls).toEqual([]);
  });
});
