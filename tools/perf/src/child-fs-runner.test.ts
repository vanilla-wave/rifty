import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

describe('child fs benchmark CLI', () => {
  it('accepts one exact positive run count, output path, and port', async () => {
    const { parseChildFsArgs } = await import('./child-fs-runner.mjs');
    expect(
      parseChildFsArgs(['--runs', '3', '--out', 'perf/child-fs.json', '--port', '5391']),
    ).toEqual({
      runs: 3,
      out: 'perf/child-fs.json',
      port: 5391,
      ownerLoad: 'idle',
    });
  });

  it('rejects malformed arguments before launch', async () => {
    const { parseChildFsArgs } = await import('./child-fs-runner.mjs');
    const cases: readonly (readonly string[])[] = [
      [],
      ['--runs', '0', '--out', 'x.json'],
      ['--runs', '-1', '--out', 'x.json'],
      ['--runs', '1.5', '--out', 'x.json'],
      ['--runs', 'wat', '--out', 'x.json'],
      ['--runs', '1'],
      ['--runs', '1', '--out', ''],
      ['--runs', '1', '--out', 'x.json', '--port', '0'],
      ['--runs', '1', '--out', 'x.json', '--unknown', 'x'],
    ];
    for (const argv of cases) expect(() => parseChildFsArgs(argv), JSON.stringify(argv)).toThrow();
  });

  it('refuses an occupied strict port instead of measuring a foreign server', async () => {
    const { assertChildFsPortFree } = await import('./child-fs-runner.mjs');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('test server has no TCP port');
      await expect(assertChildFsPortFree(address.port)).rejects.toThrow(/occupied|already/u);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});

describe('child fs benchmark artifact publication', () => {
  it('writes a sibling temp and renames it; never writes the success path directly', async () => {
    const { publishChildFsArtifact } = await import('./child-fs-runner.mjs');
    const calls: string[] = [];
    const io = {
      mkdir: vi.fn(() => calls.push('mkdir')),
      writeFile: vi.fn((path: string) => calls.push(`write:${path}`)),
      rename: vi.fn((from: string, to: string) => calls.push(`rename:${from}->${to}`)),
      unlink: vi.fn((path: string) => calls.push(`unlink:${path}`)),
    };
    publishChildFsArtifact('/result/child-fs.json', '{"ok":true}\n', io);
    expect(calls).toEqual([
      'mkdir',
      'write:/result/.child-fs.json.tmp',
      'rename:/result/.child-fs.json.tmp->/result/child-fs.json',
    ]);
  });

  it('write/rename failure is loud, cleans the temp, and never touches the success path', async () => {
    const { publishChildFsArtifact } = await import('./child-fs-runner.mjs');
    for (const failure of ['write', 'rename'] as const) {
      const calls: string[] = [];
      const io = {
        mkdir: vi.fn(() => calls.push('mkdir')),
        writeFile: vi.fn((path: string) => {
          calls.push(`write:${path}`);
          if (failure === 'write') throw new Error('ENOSPC');
        }),
        rename: vi.fn((from: string, to: string) => {
          calls.push(`rename:${from}->${to}`);
          if (failure === 'rename') throw new Error('EPERM');
        }),
        unlink: vi.fn((path: string) => calls.push(`unlink:${path}`)),
      };
      expect(() => publishChildFsArtifact('/result/child-fs.json', '{}\n', io)).toThrow(
        failure === 'write' ? /ENOSPC/u : /EPERM/u,
      );
      expect(calls).toContain('unlink:/result/.child-fs.json.tmp');
      expect(calls.some((call) => call === 'write:/result/child-fs.json')).toBe(false);
    }
  });
});
