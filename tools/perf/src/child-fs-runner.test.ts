import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('child fs benchmark CLI admission', () => {
  it('parses the exact public form and rejects args before port/launch side effects', async () => {
    const { admitChildFsRun, parseChildFsArgs } = await import('./child-fs-runner.mjs');
    expect(
      parseChildFsArgs(['--', '--runs', '3', '--out', 'perf/child-fs.json', '--port', '5391']),
    ).toEqual({ runs: 3, out: 'perf/child-fs.json', port: 5391, ownerLoad: 'idle' });

    const invalidCases: readonly (readonly string[])[] = [
      [],
      ['--out', 'x.json'],
      ['--runs', '0', '--out', 'x.json'],
      ['--runs', '-1', '--out', 'x.json'],
      ['--runs', '1.5', '--out', 'x.json'],
      ['--runs', 'wat', '--out', 'x.json'],
      ['--runs', '1'],
      ['--runs', '1', '--out', ''],
      ['--runs', '1', '--runs', '2', '--out', 'x.json'],
      ['--runs', '1', '--out', 'a.json', '--out', 'b.json'],
      ['--runs', '1', '--out', 'x.json', '--port', '5391', '--port', '5392'],
      ['--runs', '1', '--out', 'x.json', '--port', '-1'],
      ['--runs', '1', '--out', 'x.json', '--port', '0'],
      ['--runs', '1', '--out', 'x.json', '--port', '1.5'],
      ['--runs', '1', '--out', 'x.json', '--port', '65536'],
      ['--runs', '1', '--out', 'x.json', '--unknown', 'x'],
    ];
    for (const argv of invalidCases) {
      const assertPortFree = vi.fn(async () => {});
      const launch = vi.fn(async () => 'launched');
      await expect(admitChildFsRun(argv, { assertPortFree, launch })).rejects.toThrow();
      expect(assertPortFree, JSON.stringify(argv)).not.toHaveBeenCalled();
      expect(launch, JSON.stringify(argv)).not.toHaveBeenCalled();
    }
  });

  it('probes a real free/occupied port and launches only after free admission', async () => {
    const { admitChildFsRun, assertChildFsPortFree } = await import('./child-fs-runner.mjs');
    const free = createServer();
    await new Promise<void>((resolve, reject) => {
      free.once('error', reject);
      free.listen(0, '127.0.0.1', resolve);
    });
    const address = free.address();
    if (address === null || typeof address === 'string')
      throw new Error('test listener has no port');
    const port = address.port;
    await expect(assertChildFsPortFree(port)).rejects.toThrow(/occupied|already/u);
    await new Promise<void>((resolve, reject) =>
      free.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    await expect(assertChildFsPortFree(port)).resolves.toBeUndefined();

    const order: string[] = [];
    const result = await admitChildFsRun(
      ['--runs', '1', '--out', 'x.json', '--port', String(port)],
      {
        assertPortFree: async (value: number) => {
          expect(value).toBe(port);
          order.push('port');
        },
        launch: async (options: unknown) => {
          order.push('launch');
          return options;
        },
      },
    );
    expect(order).toEqual(['port', 'launch']);
    expect(result).toMatchObject({ runs: 1, out: 'x.json', port });

    const launch = vi.fn(async () => 'must-not-launch');
    await expect(
      admitChildFsRun(['--runs', '1', '--out', 'x.json', '--port', String(port)], {
        assertPortFree: async () => {
          throw new Error('occupied');
        },
        launch,
      }),
    ).rejects.toThrow(/occupied/u);
    expect(launch).not.toHaveBeenCalled();
  });

  it('rejects an occupied localhost address family used by the Vite benchmark', async () => {
    const { assertChildFsPortFree } = await import('./child-fs-runner.mjs');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, 'localhost', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('localhost test listener has no TCP port');
      }
      await expect(assertChildFsPortFree(address.port)).rejects.toThrow(/occupied|already/u);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});

describe('child fs benchmark artifact publication', () => {
  it('default I/O writes exact bytes through a sibling temp and leaves only the final path', async () => {
    const { publishChildFsArtifact } = await import('./child-fs-runner.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'rifty-child-fs-artifact-'));
    try {
      const out = join(dir, 'child-fs.json');
      publishChildFsArtifact(out, '{"exact":true}\n');
      expect(readFileSync(out, 'utf8')).toBe('{"exact":true}\n');
      expect(readdirSync(dir)).toEqual(['child-fs.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injected write/rename failures are loud, clean temp, and never touch success path', async () => {
    const { publishChildFsArtifact } = await import('./child-fs-runner.mjs');
    for (const failure of ['write', 'rename'] as const) {
      const calls: string[] = [];
      const files = new Map<string, string>([['/result/child-fs.json', 'previous-good\n']]);
      const io = {
        mkdir: vi.fn(() => calls.push('mkdir')),
        writeFile: vi.fn((path: string, contents: string) => {
          calls.push(`write:${path}`);
          if (failure === 'write') throw new Error('ENOSPC');
          files.set(path, contents);
        }),
        rename: vi.fn((from: string, to: string) => {
          calls.push(`rename:${from}->${to}`);
          if (failure === 'rename') throw new Error('EPERM');
          const contents = files.get(from);
          if (contents === undefined) throw new Error('ENOENT');
          files.set(to, contents);
          files.delete(from);
        }),
        unlink: vi.fn((path: string) => {
          calls.push(`unlink:${path}`);
          files.delete(path);
        }),
      };
      expect(() => publishChildFsArtifact('/result/child-fs.json', '{}\n', io)).toThrow(
        failure === 'write' ? /ENOSPC/u : /EPERM/u,
      );
      expect(calls).toContain('unlink:/result/.child-fs.json.tmp');
      expect(calls.some((call) => call === 'write:/result/child-fs.json')).toBe(false);
      expect(calls).not.toContain('unlink:/result/child-fs.json');
      expect(files.get('/result/child-fs.json')).toBe('previous-good\n');
    }
  });

  it('injected success is exactly mkdir → write sibling temp → atomic rename', async () => {
    const { publishChildFsArtifact } = await import('./child-fs-runner.mjs');
    const calls: string[] = [];
    publishChildFsArtifact('/result/child-fs.json', '{"ok":true}\n', {
      mkdir: vi.fn(() => calls.push('mkdir:/result')),
      writeFile: vi.fn((path: string) => calls.push(`write:${path}`)),
      rename: vi.fn((from: string, to: string) => calls.push(`rename:${from}->${to}`)),
      unlink: vi.fn((path: string) => calls.push(`unlink:${path}`)),
    });
    expect(calls).toEqual([
      'mkdir:/result',
      'write:/result/.child-fs.json.tmp',
      'rename:/result/.child-fs.json.tmp->/result/child-fs.json',
    ]);
  });
});
