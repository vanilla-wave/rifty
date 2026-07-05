/**
 * Streams smoke for M4 acceptance: createReadStream(...).pipe(createWriteStream(...))
 * copies a file via the in-memory VFS.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReadStream,
  createWriteStream,
} from '../../../packages/runtime-js/src/builtins/fs-streams.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import {
  appendFileSync,
  promises as fsp,
  writeFileSync,
} from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => {
  resetSyncMirror();
});

describe('fs streams', () => {
  it('pipe a file through Read → Write', async () => {
    await fsp.writeFile('/src.txt', 'streamed content');
    writeFileSync('/src.txt', 'streamed content');
    const finished = new Promise<void>((resolve, reject) => {
      const rs = createReadStream('/src.txt');
      const ws = createWriteStream('/dst.txt');
      rs.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', (err) => reject(err as Error));
      rs.on('error', (err) => reject(err as Error));
    });
    await finished;
    // After the pipe completes the destination is in the async VFS;
    // mirror it to sync layer so the readFileSync check works.
    const data = await fsp.readFile('/dst.txt', 'utf8');
    expect(data).toBe('streamed content');
  });

  it('createReadStream emits end', async () => {
    await fsp.writeFile('/t.txt', 'hi');
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream('/t.txt');
      rs.on('data', () => events.push('data'));
      rs.on('end', () => {
        events.push('end');
        resolve();
      });
      rs.on('error', reject);
    });
    expect(events).toContain('end');
  });

  it('write stream data is visible WITHOUT end() — long-lived logger contract', async () => {
    const ws = createWriteStream('/app.log', { flags: 'a' });
    const opened = new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    ws.write('session started\n');
    await opened;
    // No end(): the stream stays open (Winston-style logger). Give the
    // per-burst flush microtask a macrotask boundary to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(await fsp.readFile('/app.log', 'utf8')).toBe('session started\n');
    ws.write('second line\n');
    await new Promise((r) => setTimeout(r, 0));
    expect(await fsp.readFile('/app.log', 'utf8')).toBe('session started\nsecond line\n');
  });

  it('append streams append each flush to the current EOF, preserving external writers', async () => {
    writeFileSync('/shared.log', 'base\n');
    const ws = createWriteStream('/shared.log', { flags: 'a' });
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    await new Promise<void>((resolve) => ws.write('one\n', () => resolve()));
    appendFileSync('/shared.log', 'two\n');
    await new Promise<void>((resolve) => ws.end('three\n', () => resolve()));
    expect(await fsp.readFile('/shared.log', 'utf8')).toBe('base\none\ntwo\nthree\n');
  });

  it("'w' with no writes truncates at open, not at end", async () => {
    writeFileSync('/trunc.txt', 'previous content');
    const ws = createWriteStream('/trunc.txt');
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    // Stream still open, nothing written — Node already truncated the file.
    expect(await fsp.readFile('/trunc.txt', 'utf8')).toBe('');
    ws.destroy();
  });

  it('end(cb) fires the callback and writes NO stray bytes (was: NUL byte + swallowed cb)', async () => {
    const ws = createWriteStream('/e.log');
    ws.write('hello');
    await new Promise<void>((resolve) => {
      // Arity-1 callback — the old chunk-slot overlay minted `fn[0]→0` (NUL).
      ws.end((_err?: unknown) => resolve());
    });
    expect(Array.from(await fsp.readFile('/e.log'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('end(chunk, cb) writes the chunk then fires the callback', async () => {
    const ws = createWriteStream('/e2.log');
    await new Promise<void>((resolve) => ws.end('tail', () => resolve()));
    expect(await fsp.readFile('/e2.log', 'utf8')).toBe('tail');
  });

  it('write(chunk, cb) treats a function second arg as the callback, not an encoding', async () => {
    const ws = createWriteStream('/w.log');
    const err = await new Promise<unknown>((resolve) => ws.write('x', resolve));
    expect(err).toBeUndefined();
    await new Promise<void>((resolve) => ws.end(() => resolve()));
    expect(await fsp.readFile('/w.log', 'utf8')).toBe('x');
  });

  it('write after finished: callback carries ERR_STREAM_WRITE_AFTER_END without error event', async () => {
    const ws = createWriteStream('/we.log');
    await new Promise<void>((resolve) => ws.end('x', () => resolve()));
    let eventFired = false;
    ws.on('error', () => {
      eventFired = true;
    });
    const cbErr = await new Promise<unknown>((resolve) => ws.write('y', resolve));
    expect((cbErr as { code?: string }).code).toBe('ERR_STREAM_WRITE_AFTER_END');
    await new Promise((r) => setTimeout(r, 0));
    expect(eventFired).toBe(false);
  });

  it('write after same-tick end destroys before finish and preserves the opened end chunk', async () => {
    const ws = createWriteStream('/we-sync.log');
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    const events: string[] = [];
    ws.on('finish', () => events.push('finish'));
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.end('a', (err?: unknown) =>
      events.push(`endcb:${(err as { code?: string } | undefined)?.code}`),
    );
    const ret = ws.write('b', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code}`),
    );
    expect(ret).toBe(false);
    await closed;
    expect(events).toEqual([
      'writecb:ERR_STREAM_WRITE_AFTER_END',
      'endcb:ERR_STREAM_WRITE_AFTER_END',
      'error:ERR_STREAM_WRITE_AFTER_END',
    ]);
    expect(await fsp.readFile('/we-sync.log', 'utf8')).toBe('a');
  });

  it('opened write pending callback is destroyed before end callback on same-tick write-after-end', async () => {
    const ws = createWriteStream('/we-open-pending.log');
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    const events: string[] = [];
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    ws.write('a', (err?: unknown) =>
      events.push(`write1cb:${(err as { code?: string } | undefined)?.code}`),
    );
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    const ret = ws.write('b', (err?: unknown) =>
      events.push(`write2cb:${(err as { code?: string } | undefined)?.code}`),
    );
    expect(ret).toBe(false);
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual([
      'write2cb:ERR_STREAM_WRITE_AFTER_END',
      'write1cb:ERR_STREAM_DESTROYED',
      'endcb:ERR_STREAM_WRITE_AFTER_END',
      'error:ERR_STREAM_WRITE_AFTER_END',
      'close',
    ]);
    expect(await fsp.readFile('/we-open-pending.log', 'utf8')).toBe('a');
  });

  it('pre-open write after end reports callback before open, then emits error', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/we-preopen.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    const ret = ws.write('x', (err?: unknown) =>
      events.push(`cb:${(err as { code?: string } | undefined)?.code}`),
    );
    events.push(`ret:${ret}`);
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual([
      'ret:false',
      'cb:ERR_STREAM_WRITE_AFTER_END',
      'endcb:ERR_STREAM_WRITE_AFTER_END',
      'open',
      'ready',
      'error:ERR_STREAM_WRITE_AFTER_END',
      'close',
    ]);
    expect(await fsp.readFile('/we-preopen.log', 'utf8')).toBe('');
  });

  it('pre-open write-after-end error wins over a later open failure', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/missing-dir/we-preopen.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    const ret = ws.write('x', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code}`),
    );
    events.push(`ret:${ret}`);
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual([
      'ret:false',
      'writecb:ERR_STREAM_WRITE_AFTER_END',
      'endcb:ERR_STREAM_WRITE_AFTER_END',
      'error:ERR_STREAM_WRITE_AFTER_END',
      'close',
    ]);
  });

  it('pre-open queued write/end callbacks fire before finish/close', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/queued-success.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('finish', () => events.push('finish'));
    ws.on('close', () => events.push('close'));
    ws.write('x', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code ?? 'null'}`),
    );
    ws.end((err?: unknown) =>
      events.push(`endcb:${(err as { code?: string } | undefined)?.code ?? 'null'}`),
    );
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual(['open', 'ready', 'writecb:null', 'endcb:null', 'finish', 'close']);
    expect(await fsp.readFile('/queued-success.log', 'utf8')).toBe('x');
  });

  it('r+ through a file reports ENOTDIR open, not ENOENT', async () => {
    writeFileSync('/plain.txt', 'x');
    const ws = createWriteStream('/plain.txt/deep', { flags: 'r+' });
    const err = await new Promise<unknown>((resolve) => ws.on('error', resolve));
    expect(err).toMatchObject({ code: 'ENOTDIR', syscall: 'open', path: '/plain.txt/deep' });
  });

  it('write after destroy: callback-only ERR_STREAM_DESTROYED, no error event (Node parity)', async () => {
    const ws = createWriteStream('/wd.log');
    ws.destroy();
    let eventFired = false;
    ws.on('error', () => {
      eventFired = true;
    });
    const cbErr = await new Promise<unknown>((resolve) => ws.write('y', resolve));
    expect((cbErr as { code?: string }).code).toBe('ERR_STREAM_DESTROYED');
    await new Promise((r) => setTimeout(r, 0));
    expect(eventFired).toBe(false);
  });

  it('pre-open destroy drains queued write/end callbacks before open/close', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/destroy-preopen.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('close', () => events.push('close'));
    ws.write('a', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code}`),
    );
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    ws.destroy();
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual([
      'writecb:ERR_STREAM_DESTROYED',
      'endcb:ERR_STREAM_DESTROYED',
      'open',
      'ready',
      'close',
    ]);
    expect(await fsp.readFile('/destroy-preopen.log', 'utf8')).toBe('');
  });

  it('post-open destroy drains pending write callback and emits destroyed error', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/destroy-postopen.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    ws.write('a', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code}`),
    );
    ws.destroy();
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual([
      'open',
      'ready',
      'writecb:ERR_STREAM_DESTROYED',
      'error:ERR_STREAM_DESTROYED',
      'close',
    ]);
  });

  it('post-open destroy drains pending end callback without an error event', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/destroy-end-postopen.log');
    ws.on('open', () => events.push('open'));
    ws.on('ready', () => events.push('ready'));
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    ws.destroy();
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual(['open', 'ready', 'endcb:ERR_STREAM_DESTROYED', 'close']);
  });

  it('invalid chunk type throws synchronously (ERR_INVALID_ARG_TYPE)', () => {
    const ws = createWriteStream('/inv.log');
    expect(() => ws.write(123 as never)).toThrow(TypeError);
    ws.destroy();
  });

  it('createWriteStream signal is a loud unsupported option, never silently ignored', () => {
    const ac = new AbortController();
    expect(() => createWriteStream('/signal.log', { signal: ac.signal })).toThrow(
      /Not implemented/,
    );
  });

  it('write stream binds its target at open — a later cwd change must not retarget the file', async () => {
    const { setProcessCwd } = await import('../../../packages/runtime-js/src/builtins/process.ts');
    const { mkdirSync } = await import('../../../packages/runtime-js/src/builtins/fs.ts');
    mkdirSync('/a', { recursive: true });
    mkdirSync('/b', { recursive: true });
    setProcessCwd('/a');
    try {
      const ws = createWriteStream('rel.log');
      await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
      setProcessCwd('/b');
      await new Promise<void>((resolve) => ws.end('bound', () => resolve()));
      expect(await fsp.readFile('/a/rel.log', 'utf8')).toBe('bound');
      await expect(fsp.readFile('/b/rel.log', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      setProcessCwd('/');
    }
  });

  it('emitClose:false suppresses close on success and error alike (read stream)', async () => {
    await fsp.writeFile('/c.txt', 'x');
    const okEvents: string[] = [];
    await new Promise<void>((resolve) => {
      const rs = createReadStream('/c.txt', { emitClose: false });
      rs.on('close', () => okEvents.push('close'));
      rs.on('end', () => resolve());
      rs.on('data', () => {});
    });
    const errEvents: string[] = [];
    await new Promise<void>((resolve) => {
      const rs = createReadStream('/missing-c.txt', { emitClose: false });
      rs.on('close', () => errEvents.push('close'));
      rs.on('error', () => resolve());
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(okEvents).toEqual([]);
    expect(errEvents).toEqual([]);
  });

  it("read stream error emits 'close' after 'error' by default (Node parity)", async () => {
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      const rs = createReadStream('/missing-d.txt');
      rs.on('error', () => events.push('error'));
      rs.on('close', () => {
        events.push('close');
        resolve();
      });
    });
    expect(events).toEqual(['error', 'close']);
  });

  it('highWaterMark: 0 is accepted and yields an empty stream + immediate end (Node parity)', async () => {
    await fsp.writeFile('/h.txt', 'content');
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream('/h.txt', { highWaterMark: 0 });
      rs.on('data', () => events.push('data'));
      rs.on('end', () => {
        events.push('end');
        resolve();
      });
      rs.on('error', reject);
    });
    expect(events).toEqual(['end']);
  });

  it('highWaterMark: 0 still opens the target and reports ENOENT for a miss', async () => {
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      const rs = createReadStream('/missing-hwm0.txt', { highWaterMark: 0 });
      rs.on('error', (err: unknown) => {
        events.push(`error:${(err as { code?: string }).code}`);
      });
      rs.on('close', () => {
        events.push('close');
        resolve();
      });
    });
    expect(events).toEqual(['error:ENOENT', 'close']);
  });

  it('pre-open write/end callbacks receive the open error', async () => {
    const events: string[] = [];
    const ws = createWriteStream('/missing-dir/out.txt');
    ws.on('error', (err: unknown) => events.push(`error:${(err as { code?: string }).code}`));
    ws.on('close', () => events.push('close'));
    ws.write('x', (err?: unknown) =>
      events.push(`writecb:${(err as { code?: string } | undefined)?.code}`),
    );
    ws.end((err?: unknown) => events.push(`endcb:${(err as { code?: string } | undefined)?.code}`));
    await new Promise<void>((resolve) => ws.on('close', () => resolve()));
    expect(events).toEqual(['writecb:ENOENT', 'endcb:ENOENT', 'error:ENOENT', 'close']);
  });

  it('write stream highWaterMark participates in write() backpressure', async () => {
    const ws = createWriteStream('/hwm.log', { highWaterMark: 1 });
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    const drained = new Promise<void>((resolve) => ws.on('drain', () => resolve()));
    expect(ws.write('ab')).toBe(false);
    await drained;
    await new Promise<void>((resolve) => ws.end(() => resolve()));
    expect(await fsp.readFile('/hwm.log', 'utf8')).toBe('ab');
  });

  it('utf8 encoding never splits a multibyte char across chunk boundaries', async () => {
    await fsp.writeFile('/euro.txt', 'a€b');
    let out = '';
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream('/euro.txt', { encoding: 'utf8', highWaterMark: 1 });
      rs.on('data', (c: unknown) => {
        out += c as string;
      });
      rs.on('end', () => resolve());
      rs.on('error', reject);
    });
    expect(out).toBe('a€b');
  });

  it('base64 encoding aligns chunks to 3-byte groups', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    await fsp.writeFile('/b64.bin', payload);
    let out = '';
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream('/b64.bin', { encoding: 'base64', highWaterMark: 2 });
      rs.on('data', (c: unknown) => {
        out += c as string;
      });
      rs.on('end', () => resolve());
      rs.on('error', reject);
    });
    expect(out).toBe(Buffer.from(payload).toString('base64'));
  });
});
