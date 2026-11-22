/**
 * Sandbox rows below the scenario level (ADR-0568; unit
 * `distribution/isolate-host-sandbox-core` Fault matrix and Acceptance 2–4).
 * Kill scenarios run in their own consumer process over the built package, so
 * its child pids are its workers. RED: `it.fails` until the sandbox lands.
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import { consumer } from './support.ts';

/** RED until the sandbox lands; flips to `it` with the implementation. */
const carrier = it.fails;

interface Sandbox {
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  list(path?: string): Promise<readonly { name: string; type: string; size: number }[]>;
  exec(path: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  snapshot(): Promise<Uint8Array>;
  destroy(): Promise<void>;
}
const createSandbox = (options?: Record<string, unknown>): Promise<Sandbox> =>
  (pkg as unknown as { createSandbox: (o?: unknown) => Promise<Sandbox> }).createSandbox(options);
const text = async (sb: Sandbox, path: string) => Buffer.from(await sb.readFile(path)).toString();

describe('surface (Acceptance 2–3)', () => {
  carrier('the package root exports createSandbox and runCode', () => {
    expect(Object.keys(pkg).sort()).toEqual(['createSandbox', 'runCode']);
  });

  carrier('exec and createSandbox refuse what they do not do, loudly', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('a.js', '1');
      for (const option of ['env', 'cwd', 'stdin'])
        await expect(sb.exec('a.js', { [option]: {} })).rejects.toMatchObject({
          message: expect.stringContaining(`Not implemented: isolate-host.sandbox-exec-${option}`),
        });
      for (const bad of [[1], 'a b'])
        await expect(sb.exec('a.js', { args: bad })).rejects.toMatchObject({
          code: 'ERR_INVALID_ARG_TYPE',
        });
      await expect(sb.exec(5 as unknown as string)).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_TYPE',
      });
      await expect(sb.exec('a.js', { timeoutMs: 0 })).rejects.toMatchObject({
        code: 'ERR_OUT_OF_RANGE',
      });
    } finally {
      await sb.destroy();
    }
    await expect(createSandbox({ template: { id: 't', version: '1' } })).rejects.toMatchObject({
      message: expect.stringContaining('Not implemented: isolate-host.sandbox-template'),
    });
    await expect(createSandbox({ snapshot: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({
      code: 'ERR_FS_SNAPSHOT_CORRUPT',
    });
  });
});

describe('snapshot at a point of rest (Acceptance 4)', () => {
  carrier(
    'snapshot() behind a run holds its end; a run behind snapshot() does not change it',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('w.js', "require('fs').writeFileSync('n', String(process.argv[2]))");
        const [, snap] = await Promise.all([
          sb.exec('w.js', { args: ['1'] }),
          sb.snapshot(),
          sb.exec('w.js', { args: ['2'] }),
        ]);
        const restored = await createSandbox({ snapshot: snap });
        try {
          expect(await text(restored, 'n')).toBe('1');
          expect(await text(sb, 'n')).toBe('2');
        } finally {
          await restored.destroy();
        }
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('state that cannot be kept (Fault matrix)', () => {
  carrier(
    'an end state too large to capture in its isolate is refused, named; state of before',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('keep', 'k');
        await sb.writeFile(
          'fill.js',
          "require('fs').writeFileSync('big', Buffer.alloc(40 << 20, 1)); console.log('wrote')",
        );
        const r = await sb.exec('fill.js', { memoryLimitMb: 64 });
        expect(r).toEqual({
          stdout: 'wrote\n',
          stderr: '',
          exitCode: 0,
          stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_CAPTURE',
        });
        expect((await sb.list()).map((e) => e.name)).toEqual(['fill.js', 'keep']);
      } finally {
        await sb.destroy();
      }
    },
  );

  carrier('a state its run cannot restore is refused before any guest code', async () => {
    const sb = await createSandbox();
    try {
      // 60 MiB of state cannot enter a 64 MiB isolate (step 0: 51 MiB of files fit at most).
      await sb.writeFile('big1', new Uint8Array(30 << 20).fill(1));
      await sb.writeFile('big2', new Uint8Array(30 << 20).fill(2));
      await sb.writeFile('a.js', "console.log('ran')");
      expect(await sb.exec('a.js', { memoryLimitMb: 64 })).toEqual({
        stdout: '',
        stderr: '',
        exitCode: null,
        stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_RESTORE',
      });
      expect(await sb.exec('a.js')).toEqual({ stdout: 'ran\n', stderr: '', exitCode: 0 });
    } finally {
      await sb.destroy();
    }
  });

  carrier(
    'a guest that breaks the intrinsics its capture uses gets a result, not a rejection',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('keep', 'k');
        await sb.writeFile(
          'poison.js',
          `require('fs').writeFileSync('p', 'x');
console.log('poisoned');
for (const C of [Uint8Array, DataView, Map, Set, String, Array]) for (const k of Object.getOwnPropertyNames(C.prototype)) { try { C.prototype[k] = function () { throw new Error('poisoned') } } catch {} }
console.log('poisoned');`,
        );
        const r = await sb.exec('poison.js');
        expect(r.stdout).toBe('poisoned\n');
        // Its own state only: refused (state of before) or kept — never a rejection.
        const names = (await sb.list()).map((e) => e.name);
        expect(names).toContain('keep');
        expect(await sb.exec('poison.js')).toMatchObject({ stdout: 'poisoned\n' });
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('a worker lost twice (Fault matrix)', () => {
  carrier('rejects WORKER_LOST and leaves the state of before', async () => {
    const { value } = await consumer(`
      const sb = await createSandbox();
      await sb.writeFile('log', 'start\\n');
      await sb.writeFile('slow.js', "require('fs').appendFileSync('log', 'run\\\\n'); setTimeout(() => {}, 4000)");
      const running = settle(sb.exec('slow.js', { timeoutMs: 30000 }));
      const first = await waitFor(() => children()[0], 5000);
      await sleep(800);
      kill(first);
      const second = await waitFor(() => children().find((p) => p !== first), 5000);
      await sleep(800);
      kill(second);
      const result = await running;
      out({ result, log: Buffer.from(await sb.readFile('log')).toString() });`);
    expect(value).toEqual({
      result: {
        rejected: expect.stringMatching(/exited unexpectedly/),
        code: 'ERR_ISOLATE_HOST_WORKER_LOST',
      },
      log: 'start\n',
    });
  });
});

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-hostile-state-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A package copy whose worker answers every call with a `state` frame (kind 6) of `size` bytes, then exit 0. */
function hostileStatePackage(size: number): string {
  const dir = join(work, `pkg-${size}`);
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { writeSync } from 'node:fs';
     const f = (kind, call, b) => { const h = new Uint8Array(9); const v = new DataView(h.buffer);
       v.setUint32(0, b.length); h[4] = kind; v.setUint32(5, call); writeSync(3, h); if (b.length) writeSync(3, b); };
     let pending = '';
     process.stdin.setEncoding('utf8').on('data', (d) => {
       pending += d;
       for (let nl; (nl = pending.indexOf('\\n')) >= 0; ) {
         const req = JSON.parse(pending.slice(0, nl)); pending = pending.slice(nl + 1);
         if (req.type !== 'run') continue;
         f(6, req.call, new Uint8Array(${size})); f(2, req.call, Uint8Array.of(0));
       }
     });
     process.stdin.on('end', () => process.exit(0));
     setInterval(() => {}, 1000);`,
  );
  return pathToFileURL(join(dir, 'dist', 'index.js')).href;
}

describe('a hostile worker and state frames (Fault matrix)', () => {
  carrier(
    'a state frame for a runCode call, or past maxFsBytes, is a protocol violation',
    async () => {
      const { value } = await consumer(
        `const run = await settle(runCode('1'));
       const sb = await createSandbox({ maxFsBytes: 1024 });
       await sb.writeFile('a', 'kept');
       const exec = await settle(sb.exec('a'));
       out({ run, exec, kept: Buffer.from(await sb.readFile('a')).toString() });`,
        { entry: hostileStatePackage(2048) },
      );
      const violation = {
        rejected: expect.stringMatching(/^isolate-host child protocol violation: /),
      };
      expect(value).toMatchObject({ run: violation, exec: violation, kept: 'kept' });
    },
  );
});
