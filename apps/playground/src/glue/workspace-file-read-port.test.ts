import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_MAX_CONTENT_BYTES } from './vfs-snapshot-port.ts';
import {
  type WorkspaceFileReadBridge,
  bridgeWorkspaceFileReads,
  serveWorkspaceFileReads,
} from './workspace-file-read-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const teardowns: Array<() => void> = [];
let bridge: WorkspaceFileReadBridge | null = null;

function serve(port: number, root = '/workspace'): void {
  teardowns.push(serveWorkspaceFileReads(port, root));
}

function client(port: number, timeoutMs?: number): WorkspaceFileReadBridge {
  bridge = bridgeWorkspaceFileReads(port, timeoutMs === undefined ? {} : { timeoutMs });
  return bridge;
}

beforeEach(() => {
  resetSyncMirror();
});

afterEach(() => {
  bridge?.dispose();
  bridge = null;
  for (const t of teardowns.splice(0)) t();
});

describe('workspace file read bridge', () => {
  it('returns exact owner bytes for small text files', async () => {
    syncMirror().mkdirSync('/workspace/src', { recursive: true });
    syncMirror().writeFileSync('/workspace/src/main.ts', enc.encode('console.log(1)\n'));
    serve(9201);

    const bytes = await client(9201).readFileBytes('/workspace/src/main.ts');
    expect(dec.decode(bytes)).toBe('console.log(1)\n');
  });

  it('returns full owner bytes above the snapshot cap', async () => {
    const big = new Uint8Array(SNAPSHOT_MAX_CONTENT_BYTES + 17);
    big.fill(7);
    syncMirror().mkdirSync('/workspace/assets', { recursive: true });
    syncMirror().writeFileSync('/workspace/assets/large.bin', big);
    serve(9202);

    const bytes = await client(9202).readFileBytes('/workspace/assets/large.bin');
    expect(bytes.byteLength).toBe(big.byteLength);
    expect(bytes.at(-1)).toBe(7);
  });

  it('returns binary bytes without decoding or null placeholders', async () => {
    const pngish = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    syncMirror().mkdirSync('/workspace/public', { recursive: true });
    syncMirror().writeFileSync('/workspace/public/logo.png', pngish);
    serve(9203);

    const bytes = await client(9203).readFileBytes('/workspace/public/logo.png');
    expect([...bytes]).toEqual([...pngish]);
  });

  it('refuses paths outside the workspace root', async () => {
    syncMirror().mkdirSync('/workspace', { recursive: true });
    serve(9204);

    await expect(client(9204).readFileBytes('/workspace/../etc/passwd')).rejects.toThrow(
      /workspace root/,
    );
  });

  it('rejects with a timeout when no owner is listening', async () => {
    await expect(client(9205, 50).readFileBytes('/workspace/src/main.ts')).rejects.toThrow(
      /timeout/i,
    );
  });

  it('dispose rejects in-flight reads and refuses subsequent reads', async () => {
    const c = client(9206, 5000);
    const inFlight = c.readFileBytes('/workspace/src/main.ts');
    c.dispose();
    await expect(inFlight).rejects.toThrow(/disposed/);
    await expect(c.readFileBytes('/workspace/src/main.ts')).rejects.toThrow(/disposed/);
    bridge = null;
  });
});
