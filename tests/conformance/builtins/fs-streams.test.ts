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
import { promises as fsp, writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

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

  it("'w' with no writes truncates at open, not at end", async () => {
    writeFileSync('/trunc.txt', 'previous content');
    const ws = createWriteStream('/trunc.txt');
    await new Promise<void>((resolve) => ws.on('ready', () => resolve()));
    // Stream still open, nothing written — Node already truncated the file.
    expect(await fsp.readFile('/trunc.txt', 'utf8')).toBe('');
    ws.destroy();
  });
});
