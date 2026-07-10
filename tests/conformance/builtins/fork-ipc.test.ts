import { afterEach, describe, expect, it } from 'vitest';
import { fork } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

describe('child_process.fork — IPC', () => {
  it("keeps serialization:'advanced' loud until Node advanced parity lands", () => {
    expect(() => fork('/advanced.js', [], { serialization: 'advanced' })).toThrow(
      /advanced IPC serializer is not implemented/,
    );
  });

  it('parent receives messages the child sends via process.send', async () => {
    writeFileSync(
      '/c.js',
      `__process.send('first');
       __process.send({ kind: 'hello', n: 7 });`,
    );
    const child = fork('/c.js');
    const messages: unknown[] = [];
    child.on('message', (m) => messages.push(m));
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    expect(messages).toEqual(['first', { kind: 'hello', n: 7 }]);
  });

  it('child receives messages the parent sends via child.send', async () => {
    writeFileSync('/echo.js', `__process.onMessage((m) => __process.send('echo:' + m));`);
    const child = fork('/echo.js');
    const replies: unknown[] = [];
    child.on('message', (m) => replies.push(m));
    // Let the child install its listener (the script body runs after a
    // microtask boundary inside `spawn`).
    await Promise.resolve();
    await Promise.resolve();
    expect(child.send('one')).toBe(true);
    expect(child.send('two')).toBe(true);
    await new Promise((r) => setTimeout(r, 25));
    expect(replies).toEqual(['echo:one', 'echo:two']);
  });

  it('uses Node default JSON serialization in both directions', async () => {
    writeFileSync(
      '/json-ipc.js',
      `__process.send({ side: 'child', keep: 1, drop() {} });
       __process.onMessage((m) => __process.send({ side: 'parent', keys: Object.keys(m).sort() }));`,
    );
    const child = fork('/json-ipc.js');
    const messages: unknown[] = [];
    child.on('message', (m) => messages.push(m));
    await Promise.resolve();
    await Promise.resolve();

    expect(child.send({ keep: 1, drop() {} })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(messages).toEqual([
      { side: 'child', keep: 1 },
      { side: 'parent', keys: ['keep'] },
    ]);
  });

  it('a circular child.send throws without disconnecting the next valid send', async () => {
    writeFileSync('/after-invalid.js', '__process.onMessage((m) => __process.send(m));');
    const child = fork('/after-invalid.js');
    const replies: unknown[] = [];
    child.on('message', (m) => replies.push(m));
    await Promise.resolve();
    await Promise.resolve();
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => child.send(circular)).toThrow(/circular/i);
    expect(child.send({ after: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(replies).toEqual([{ after: true }]);
  });
});
