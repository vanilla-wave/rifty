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
import { Pool, sharedPool } from '../src/pool.ts';
import { childPids, consumer } from './support.ts';

/** RED until the sandbox lands; flips to `it` with the implementation. */
const carrier = it;

interface Sandbox {
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
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
    const sb = await createSandbox({ maxFileBytes: 32 << 20 });
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
        expect(String(r.stdout).startsWith('poisoned\n')).toBe(true);
        // Its own state only: refused (state of before) or kept — never a rejection.
        const names = (await sb.list()).map((e) => e.name);
        expect(names).toContain('keep');
        expect(String((await sb.exec('poison.js')).stdout).startsWith('poisoned\n')).toBe(true);
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

/**
 * A package copy whose worker answers every call with `frames` `state` frames
 * (kind 6) of `size` bytes each (`fill`), then exit 0.
 */
function hostileStatePackage(name: string, size: number, frames: number, fill: number): string {
  const dir = join(work, `pkg-${name}`);
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
         for (let i = 0; i < ${frames}; i++) f(6, req.call, new Uint8Array(${size}).fill(${fill}));
         f(2, req.call, Uint8Array.of(0));
       }
     });
     process.stdin.on('end', () => process.exit(0));
     setInterval(() => {}, 1000);`,
  );
  return pathToFileURL(join(dir, 'dist', 'index.js')).href;
}

const VIOLATION = { rejected: expect.stringMatching(/^isolate-host child protocol violation: /) };
const HOSTILE_BODY = `const run = await settle(runCode('1'));
  const sb = await createSandbox({ maxFsBytes: 8192 });
  await sb.writeFile('a', 'kept');
  const exec = await settle(sb.exec('a'));
  out({ run, exec, kept: Buffer.from(await sb.readFile('a')).toString() });`;

describe('a hostile worker and state frames (Fault matrix)', () => {
  carrier(
    'a state frame for a runCode call, or past maxFsBytes, is a protocol violation',
    async () => {
      const { value } = await consumer(HOSTILE_BODY, {
        entry: hostileStatePackage('oversized', 16384, 1, 0),
      });
      expect(value).toMatchObject({ run: VIOLATION, exec: VIOLATION, kept: 'kept' });
    },
  );

  carrier('a sandbox run that ends without its state is a protocol violation', async () => {
    const { value } = await consumer(HOSTILE_BODY, {
      entry: hostileStatePackage('stateless', 0, 0, 0),
    });
    expect(value).toMatchObject({ exec: VIOLATION, kept: 'kept' });
  });

  carrier('two state frames for one call are a protocol violation', async () => {
    const { value } = await consumer(HOSTILE_BODY, {
      entry: hostileStatePackage('twice', 16, 2, 0),
    });
    expect(value).toMatchObject({ exec: VIOLATION, kept: 'kept' });
  });

  carrier('corrupt state bytes under the cap are refused by the codec, never adopted', async () => {
    const { value } = await consumer(HOSTILE_BODY, {
      entry: hostileStatePackage('corrupt', 64, 1, 7),
    });
    expect(value).toMatchObject({
      exec: { stdout: '', stderr: '', exitCode: 0, stateRefused: 'ERR_FS_SNAPSHOT_CORRUPT' },
      kept: 'kept',
    });
  });
});

/** Every value is plain data: plain objects, arrays, primitives, `Uint8Array`; no accessor. */
function assertPlain(value: unknown, at = 'value'): void {
  if (value === null || typeof value !== 'object') {
    expect(typeof value, at).not.toBe('function');
    return;
  }
  if (value instanceof Uint8Array) {
    expect(Object.getPrototypeOf(value), at).toBe(Uint8Array.prototype);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  expect(proto === Object.prototype || proto === Array.prototype, `${at} is plain`).toBe(true);
  for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    expect('value' in d, `${at}.${key} is a data property`).toBe(true);
    assertPlain(d.value, `${at}.${key}`);
  }
}

describe('plain data (Acceptance 2)', () => {
  carrier('every result is plain data or bytes', async () => {
    const sb = await createSandbox({ maxFsBytes: 1 << 20 });
    try {
      await sb.writeFile('a.js', "require('fs').writeFileSync('b', 'x'); console.log(1)");
      assertPlain(await sb.exec('a.js'), 'exec');
      assertPlain(await sb.list(), 'list');
      assertPlain(await sb.readFile('b'), 'readFile');
      assertPlain(await sb.snapshot(), 'snapshot');
      assertPlain(await sb.writeFile('c', 'y'), 'writeFile');
      await sb.writeFile('big.js', "require('fs').writeFileSync('h', Buffer.alloc(2 << 20))");
      assertPlain(await sb.exec('big.js'), 'refused exec');
    } finally {
      await sb.destroy();
    }
  });
});

describe('the isolate of a run ends with it (Fault matrix)', () => {
  // The guest holds 300 MiB, then waits: its worker past 400 MiB RSS is the event that it runs.
  const HOLD = 'globalThis.hold = new Uint8Array(300 << 20).fill(1); for (;;) {}';
  const body = (end: string) => `
    const sb = await createSandbox();
    await sb.writeFile('hold.js', ${JSON.stringify(HOLD)});
    const running = settle(sb.exec('hold.js', { memoryLimitMb: 512, timeoutMs: ${end === 'timeout' ? 2000 : 60000} }));
    const rss = (pid) => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 0);
    const pid = await waitFor(() => children().find((p) => rss(p) > 400 * 1024), 15000);
    ${end === 'destroy' ? 'const destroyed = sb.destroy();' : ''}
    const result = await running;
    // I5: once destroy() resolves, the isolate is gone — read at that moment, no wait.
    ${end === 'destroy' ? 'await destroyed; let atResolve; try { atResolve = rss(pid) < 300 * 1024 } catch { atResolve = true }' : 'const atResolve = true;'}
    // Disposed: its worker gives the 300 MiB back (or is gone).
    const freed = await waitFor(() => { try { return rss(pid) < 300 * 1024 ? true : undefined } catch { return true } }, 10000).catch(() => false);
    out({ result, freed: freed && atResolve });`;

  carrier('destroy during a run rejects it and disposes its isolate', async () => {
    const { value } = await consumer(body('destroy'));
    expect(value).toEqual({
      result: {
        rejected: 'isolate-host sandbox: destroyed',
        code: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED',
      },
      freed: true,
    });
  });

  carrier('a run past timeoutMs ends as timeout and its isolate is disposed', async () => {
    const { value } = await consumer(body('timeout'));
    expect(value).toEqual({
      result: { stdout: '', stderr: '', exitCode: null, termination: 'timeout' },
      freed: true,
    });
  });

  carrier('timeoutMs runs from the moment a run leaves the queue', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('wait.js', 'setTimeout(() => {}, 2500)');
      await sb.writeFile('quick.js', 'console.log(1)');
      const [first, second] = await Promise.all([
        sb.exec('wait.js', { timeoutMs: 10_000 }),
        // Queued ~2.5 s behind the first: a deadline counted from this call would pass first.
        sb.exec('quick.js', { timeoutMs: 2000 }),
      ]);
      expect(first).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect(second).toEqual({ stdout: '1\n', stderr: '', exitCode: 0 });
    } finally {
      await sb.destroy();
    }
  });
});

/**
 * B1: the end state is authored by the guest. Whatever its realm makes of the
 * capture — bytes over the cap, not bytes, a throw, a hang — is that call's
 * result (`stateRefused`, or `timeout` for a hang), the state of before stays,
 * and a neighbour call on the same worker gets its exact result.
 */
describe('a guest-authored end state is judged as that call’s result (Fault matrix)', () => {
  const POISON: Record<string, string> = {
    'over the cap': `const U = Uint8Array; globalThis.Uint8Array = new Proxy(U, { construct: (t, [n, ...r]) => typeof n === 'number' ? new U(n + 70000) : new U(n, ...r) });`,
    'not bytes': `const U = Uint8Array; globalThis.Uint8Array = new Proxy(U, { construct: (t, a) => (typeof a[0] === 'number' ? {} : new U(...a)) });`,
    throws: `for (const k of Object.getOwnPropertyNames(DataView.prototype)) if (k.startsWith('set')) DataView.prototype[k] = () => { throw new Error('evil /secret/path') };`,
    hangs: `for (const k of Object.getOwnPropertyNames(DataView.prototype)) if (k.startsWith('set')) DataView.prototype[k] = () => { for (;;) {} };`,
  };
  for (const [label, poison] of Object.entries(POISON)) {
    carrier(label, async () => {
      const { value } = await consumer(`
        const neighbour = settle(runCode("setTimeout(() => console.log('n'), 1500)", { timeoutMs: 20000 }));
        const sb = await createSandbox({ maxFsBytes: 64 * 1024 });
        await sb.writeFile('keep', 'k');
        await sb.writeFile('p.js', ${JSON.stringify(`require('fs').writeFileSync('new', 'x'); console.log('ran'); ${poison}`)});
        const exec = await settle(sb.exec('p.js', { timeoutMs: 3000 }));
        const shared = children().length;
        out({ exec, neighbour: await neighbour, shared, names: (await sb.list()).map((e) => e.name),
          next: await settle(sb.exec('p.js', { timeoutMs: 3000 })).then((r) => r.stdout) });`);
      const v = value as {
        exec: Record<string, unknown>;
        neighbour: unknown;
        shared: number;
        names: string[];
      };
      expect(v.neighbour).toEqual({ stdout: 'n\n', stderr: '', exitCode: 0 });
      expect(v.shared).toBe(1);
      expect(v.exec.stdout).toBe('ran\n');
      expect(v.exec.rejected).toBeUndefined();
      // The guest's own error text never reaches the host: the code is the trusted side's.
      expect(JSON.stringify(v.exec)).not.toContain('evil');
      // A codec whose capture resists the poison keeps the run's end state: honest too.
      const kept = v.exec.exitCode === 0 && v.exec.stateRefused === undefined;
      if (kept) expect(v.names).toEqual(['keep', 'new', 'p.js']);
      else {
        if (label === 'hangs')
          expect(v.exec).toMatchObject({ exitCode: null, termination: 'timeout' });
        else
          expect(v.exec).toMatchObject({
            exitCode: 0,
            stateRefused: expect.stringMatching(/^ERR_/),
          });
        expect(v.names).toEqual(['keep', 'p.js']);
      }
    });
  }
});

describe('the state changes only at a terminal exit (Fault matrix)', () => {
  carrier('a worker that sends a state frame and dies changes nothing', async () => {
    const dir = join(work, 'pkg-state-then-die');
    cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
    cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
    symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
    // Sends a valid snapshot of another tree (`blob`, written by the consumer below) as the
    // call's end state, then dies before any terminal frame.
    const blob = join(dir, 'other.snapshot');
    writeFileSync(
      join(dir, 'dist', 'child.js'),
      `import { readFileSync, writeSync } from 'node:fs';
       const f = (kind, call, b) => { const h = new Uint8Array(9); const v = new DataView(h.buffer);
         v.setUint32(0, b.length); h[4] = kind; v.setUint32(5, call); writeSync(3, h); if (b.length) writeSync(3, b); };
       let pending = '';
       process.stdin.setEncoding('utf8').on('data', (d) => {
         pending += d;
         for (let nl; (nl = pending.indexOf('\\n')) >= 0; ) {
           const req = JSON.parse(pending.slice(0, nl)); pending = pending.slice(nl + 1);
           if (req.type !== 'run' || !req.sandbox) continue;
           f(6, req.call, readFileSync(${JSON.stringify(blob)}));
           process.kill(process.pid, 'SIGKILL');
         }
       });
       process.stdin.on('end', () => process.exit(0));
       setInterval(() => {}, 1000);`,
    );
    const { value } = await consumer(
      `const other = await createSandbox();
       await other.writeFile('extra', 'x');
       (await import('node:fs')).writeFileSync(${JSON.stringify(blob)}, await other.snapshot());
       const sb = await createSandbox();
       await sb.writeFile('a', 'kept');
       const exec = await settle(sb.exec('a'));
       out({ exec, names: (await sb.list()).map((e) => e.name) });`,
      { entry: pathToFileURL(join(dir, 'dist', 'index.js')).href },
    );
    expect(value).toEqual({
      exec: {
        rejected: expect.stringMatching(/exited unexpectedly/),
        code: 'ERR_ISOLATE_HOST_WORKER_LOST',
      },
      names: ['a'],
    });
  });

  carrier(
    'a deadline that falls during the restore of a large state is a timeout; state unchanged',
    async () => {
      const sb = await createSandbox({ maxFileBytes: 32 << 20 });
      try {
        await sb.writeFile('big', new Uint8Array(30 << 20).fill(3));
        await sb.writeFile('a.js', "require('fs').writeFileSync('new', 'x')");
        expect(await sb.exec('a.js', { timeoutMs: 1 })).toEqual({
          stdout: '',
          stderr: '',
          exitCode: null,
          termination: 'timeout',
        });
        expect((await sb.list()).map((e) => e.name)).toEqual(['a.js', 'big']);
        expect((await sb.exec('a.js')).exitCode).toBe(0);
        expect((await sb.list()).map((e) => e.name)).toEqual(['a.js', 'big', 'new']);
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('creation from a snapshot refuses bad bytes (Fault matrix)', () => {
  carrier(
    'corrupt, oversized and foreign-template bytes reject with the codec’s code',
    async () => {
      const sb = await createSandbox();
      await sb.writeFile('f', 'x'.repeat(5000));
      const good = await sb.snapshot();
      await sb.destroy();
      await expect(
        createSandbox({ snapshot: good.slice(0, good.length - 1) }),
      ).rejects.toMatchObject({
        code: 'ERR_FS_SNAPSHOT_CORRUPT',
      });
      await expect(createSandbox({ snapshot: good, maxFsBytes: 1024 })).rejects.toMatchObject({
        code: 'ERR_FS_SNAPSHOT_TOO_LARGE',
      });
      const again = await createSandbox({ snapshot: good });
      expect((await again.list()).map((e) => e.name)).toEqual(['f']);
      await again.destroy();
    },
  );
});

describe('sandboxes are independent (S7)', () => {
  carrier('a spinning run in one sandbox does not hold another’s', async () => {
    const a = await createSandbox();
    const b = await createSandbox();
    try {
      await a.writeFile('spin.js', 'for (;;) {}');
      await b.writeFile('quick.js', 'console.log(1)');
      const spinning = a.exec('spin.js', { timeoutMs: 20_000 });
      const first = await Promise.race([
        b.exec('quick.js').then(() => 'b'),
        spinning.then(() => 'a'),
      ]);
      expect(first).toBe('b');
      await a.destroy();
      await spinning.catch(() => {});
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});

describe('names the snapshot cannot hold (Fault matrix, ADR-0567 16 383 code units)', () => {
  carrier(
    'a host write of a longer name is refused at once; a guest-made one refuses its run’s state',
    async () => {
      const sb = await createSandbox();
      try {
        const long = 'n'.repeat(16_384);
        await expect(sb.writeFile(long, 'x')).rejects.toMatchObject({
          code: 'ENAMETOOLONG',
          syscall: 'open',
        });
        await sb.writeFile('n'.repeat(16_383), 'x');
        await sb.writeFile('g.js', `require('fs').writeFileSync('${'m'.repeat(16_384)}', 'x')`);
        expect(await sb.exec('g.js')).toEqual({
          stdout: '',
          stderr: '',
          exitCode: 0,
          stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_CAPTURE',
        });
        expect((await sb.list()).map((e) => e.name.length).sort((a, b) => a - b)).toEqual([
          4, 16_383,
        ]);
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('boot memory and buffer ownership (Final+GREEN findings)', () => {
  carrier('an isolate too small for the runtime itself ends as memory, as runCode', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('a.js', '1');
      expect(await sb.exec('a.js', { memoryLimitMb: 8 })).toEqual({
        stdout: '',
        stderr: '',
        exitCode: null,
        termination: 'memory',
      });
    } finally {
      await sb.destroy();
    }
  });

  carrier('host buffers are copies both ways: changing them later changes no file', async () => {
    const sb = await createSandbox();
    try {
      const mine = new Uint8Array([1, 2, 3]);
      await sb.writeFile('f', mine);
      mine[0] = 9;
      const read = await sb.readFile('f');
      read[1] = 9;
      expect([...(await sb.readFile('f'))]).toEqual([1, 2, 3]);
    } finally {
      await sb.destroy();
    }
  });
});

describe('restore at the memory boundary (codec review, manager 2026-11-22)', () => {
  carrier(
    'a run either sees all of its files or none: a failed restore never runs guest code',
    async () => {
      const sb = await createSandbox();
      try {
        for (let i = 0; i < 24; i++) await sb.writeFile(`f${i}`, new Uint8Array(1 << 20).fill(i));
        await sb.writeFile('count.js', "console.log(require('fs').readdirSync('.').length)");
        const seen = new Set<string>();
        for (let mb = 24; mb <= 96; mb += 8) {
          const r = await sb.exec('count.js', { memoryLimitMb: mb });
          if (r.stateRefused !== undefined) {
            expect(r).toEqual({
              stdout: '',
              stderr: '',
              exitCode: null,
              stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_RESTORE',
            });
            seen.add('refused');
          } else if (r.termination === 'memory') seen.add('memory');
          else {
            expect(r).toEqual({ stdout: '25\n', stderr: '', exitCode: 0 });
            seen.add('ran');
          }
        }
        // The sweep crosses the boundary, and the state is intact after every refusal.
        expect(seen.has('ran')).toBe(true);
        expect(seen.has('refused') || seen.has('memory')).toBe(true);
        expect((await sb.exec('count.js')).stdout).toBe('25\n');
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('snapshot bytes are never aliased (codec review, manager 2026-11-22)', () => {
  carrier('createSandbox({ snapshot }) copies its input; snapshot() hands out a copy', async () => {
    const a = await createSandbox();
    await a.writeFile('f', 'one');
    const bytes = await a.snapshot();
    const b = await createSandbox({ snapshot: bytes });
    try {
      bytes.fill(0);
      expect(await text(b, 'f')).toBe('one');
      const first = await b.snapshot();
      first.fill(0);
      const again = await b.snapshot();
      expect(again.some((x) => x !== 0)).toBe(true);
      expect(await text(b, 'f')).toBe('one');
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});

describe('every early end of a sandbox run carries its state fate (audit, manager 2026-11-22)', () => {
  // `import()` ends a run from inside the isolate (ADR-0557 gap): before, a sandbox run ended so
  // was read as a protocol violation and took its worker's neighbours with it.
  // rifty's loader serves `import()` written in a file (corpus rows); source compiled by
  // `vm` reaches the isolate's native hook, the declared gap that ends the run.
  const FORMS: Record<string, Record<string, string>> = {
    'vm.runInThisContext': {
      'i.js':
        "require('fs').writeFileSync('w', '1'); require('vm').runInThisContext(\"import('./x.js')\")",
      'x.js': 'module.exports = 7',
    },
    'vm in a timer': {
      'i.js':
        "require('fs').writeFileSync('w', '1'); setTimeout(() => require('vm').runInThisContext(\"import('./x.js')\"), 5)",
      'x.js': 'module.exports = 7',
    },
  };
  for (const [form, files] of Object.entries(FORMS)) {
    carrier(`import() — ${form}: the run's own result, its neighbour exact`, async () => {
      const { value } = await consumer(`
        const neighbour = settle(runCode("setTimeout(() => console.log('n'), 1500)", { timeoutMs: 20000 }));
        const sb = await createSandbox();
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) await sb.writeFile(name, data);
        const exec = await settle(sb.exec('i.js', { timeoutMs: 10000 }));
        out({ exec, neighbour: await neighbour, names: (await sb.list()).map((e) => e.name) });`);
      const v = value as { exec: Record<string, unknown>; neighbour: unknown; names: string[] };
      expect(v.neighbour).toEqual({ stdout: 'n\n', stderr: '', exitCode: 0 });
      expect(v.exec.rejected).toBeUndefined();
      expect(v.exec.exitCode).toBe(1);
      expect(String(v.exec.stderr)).toContain('isolate-host.dynamic-import');
      // Ended by the gap, not on its own: the state of before, named by the trusted side.
      expect(v.exec.stateRefused).toBe('ERR_ISOLATE_HOST_SANDBOX_CAPTURE');
      expect(v.names).not.toContain('w');
    });
  }
});

describe('Buffer inputs and outputs are copies (audit, manager 2026-11-22)', () => {
  carrier(
    'a pooled Buffer, a view with an offset, readFile and snapshot() share no memory',
    async () => {
      const sb = await createSandbox();
      try {
        const pooled = Buffer.from('abc');
        await sb.writeFile('p', pooled);
        pooled[0] = 0x7a;
        const big = Buffer.alloc(64, 1);
        const view = big.subarray(10, 13);
        await sb.writeFile('v', view);
        big.fill(9);
        const read = await sb.readFile('p');
        read[1] = 0x7a;
        expect(Buffer.from(await sb.readFile('p')).toString()).toBe('abc');
        expect([...(await sb.readFile('v'))]).toEqual([1, 1, 1]);
        expect((await sb.readFile('p')).buffer.byteLength).toBe(3);
        const snap = await sb.snapshot();
        const again = await createSandbox({ snapshot: Buffer.from(snap) });
        expect(Buffer.from(await again.readFile('p')).toString()).toBe('abc');
        await again.destroy();
      } finally {
        await sb.destroy();
      }
    },
  );
});

describe('host errors carry no consumer frames or paths (audit, manager 2026-11-22)', () => {
  carrier(
    'message, code, syscall, path and stack of each refusal name only sandbox paths',
    async () => {
      const host = [process.cwd(), fileURLToPath(new URL('..', import.meta.url)), tmpdir()];
      const sb = await createSandbox({ maxFileBytes: 4 });
      const errors: unknown[] = [];
      const grab = async (p: Promise<unknown>) => errors.push(await p.catch((e: unknown) => e));
      await grab(sb.readFile('nope'));
      await grab(sb.writeFile('a\0b', 'x'));
      await grab(sb.writeFile('big', 'xxxxx'));
      await grab(sb.writeFile('n'.repeat(16_384), 'x'));
      await grab(sb.remove('nope'));
      await grab(sb.exec('a.js', { env: {} }));
      await sb.destroy();
      await grab(sb.readFile('x'));
      for (const e of errors) {
        expect(e).toBeInstanceOf(Error);
        const text = JSON.stringify({
          ...(e as object),
          message: (e as Error).message,
          stack: (e as Error).stack,
        });
        for (const h of host) expect(text).not.toContain(h);
        expect((e as Error).stack).not.toMatch(/\n\s+at /);
      }
    },
  );
});

/**
 * A worker that closes its result channel in the middle of a sandbox run (manager 2026-11-22,
 * after #420): after the run's `state` frame and before its `exit`, or before any frame. The
 * channel's end is a lost worker (ADR-0563 §6): the run reruns once alone, then rejects
 * WORKER_LOST; the state changes only at a terminal exit, so it stays as before. The worker
 * answers a `runCode` neighbour honestly (`n`, exit 0): the neighbour is rerun, exactly once.
 */
function closingChannelPackage(name: string, blob: string, afterState: boolean): string {
  const dir = join(work, `pkg-close-${name}`);
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { closeSync, readFileSync, writeSync } from 'node:fs';
     const f = (kind, call, b) => { const h = new Uint8Array(9); const v = new DataView(h.buffer);
       v.setUint32(0, b.length); h[4] = kind; v.setUint32(5, call); writeSync(3, h); if (b.length) writeSync(3, b); };
     let pending = '';
     process.stdin.setEncoding('utf8').on('data', (d) => {
       pending += d;
       for (let nl; (nl = pending.indexOf('\\n')) >= 0; ) {
         const req = JSON.parse(pending.slice(0, nl)); pending = pending.slice(nl + 1);
         if (req.type !== 'run') continue;
         if (!req.sandbox) { setTimeout(() => { f(1, req.call, Uint8Array.of(1, 0, 110, 10)); f(2, req.call, Uint8Array.of(0)); }, 300); continue; }
         setTimeout(() => {
           ${afterState ? `f(6, req.call, readFileSync(${JSON.stringify(blob)}));` : ''}
           closeSync(3);
         }, 50);
       }
     });
     process.stdin.on('end', () => process.exit(0));
     setInterval(() => {}, 1000);`,
  );
  return pathToFileURL(join(dir, 'dist', 'index.js')).href;
}

describe('a result channel closed in the middle of a sandbox run (Fault matrix)', () => {
  for (const afterState of [true, false]) {
    carrier(
      `closed ${afterState ? 'after the state frame, before exit' : 'before any frame'}`,
      async () => {
        const blob = join(work, `close-${afterState}.snapshot`);
        const { value } = await consumer(
          `const other = await createSandbox();
         await other.writeFile('extra', 'x');
         (await import('node:fs')).writeFileSync(${JSON.stringify(blob)}, await other.snapshot());
         const sb = await createSandbox();
         await sb.writeFile('a', 'kept');
         const neighbour = settle(runCode('1', { timeoutMs: 20000 }));
         const exec = await settle(sb.exec('a', { timeoutMs: 20000 }));
         out({ exec, neighbour: await neighbour, names: (await sb.list()).map((e) => e.name) });`,
          { entry: closingChannelPackage(String(afterState), blob, afterState) },
        );
        expect(value).toEqual({
          exec: {
            rejected: expect.stringMatching(/exited unexpectedly .*closing its result channel/),
            code: 'ERR_ISOLATE_HOST_WORKER_LOST',
          },
          neighbour: { stdout: 'n\n', stderr: '', exitCode: 0 },
          names: ['a'],
        });
      },
    );
  }
});

describe("runCode's hardening and options through exec (FIT S6, S10)", () => {
  carrier(
    'no network or child processes; output cap, shared buffers and limits as runCode',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile(
          'h.js',
          `(async () => {
  for (const f of [() => fetch('http://x'), () => require('http'), () => require('child_process')]) {
    try { await f(); console.log('ran') } catch (e) { console.log(e.name, String(e.message).split(' (')[0]) }
  }
  console.log(typeof SharedArrayBuffer, typeof globalThis.ivm, typeof process.binding);
})();`,
        );
        const r = await sb.exec('h.js', { allowSharedArrayBuffer: false });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toBe(
          [
            'NotImplementedError Not implemented: isolate-host.fetch',
            'NotImplementedError Not implemented: isolate-host.http',
            'NotImplementedError Not implemented: isolate-host.child_process',
            'undefined undefined undefined',
            '',
          ].join('\n'),
        );
        await sb.writeFile(
          'flood.js',
          "for (let i = 0; i < 1000; i++) console.log('x'.repeat(99))",
        );
        const flood = await sb.exec('flood.js', { maxOutputBytes: 1000 });
        expect(flood).toMatchObject({ exitCode: 0, truncated: true });
        expect(flood.stdout).toHaveLength(1000);
      } finally {
        await sb.destroy();
      }
    },
  );

  carrier('a 1 MiB random file round-trips host → run → host byte for byte', async () => {
    const sb = await createSandbox();
    try {
      const bytes = new Uint8Array(1 << 20);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
      await sb.writeFile('in.bin', bytes);
      await sb.writeFile('cp.js', "require('fs').copyFileSync('in.bin', 'out.bin')");
      expect((await sb.exec('cp.js')).exitCode).toBe(0);
      expect(Buffer.compare(Buffer.from(await sb.readFile('out.bin')), Buffer.from(bytes))).toBe(0);
    } finally {
      await sb.destroy();
    }
  });

  carrier(
    'a sandbox the consumer drops keeps nothing alive: the consumer exits on its own',
    async () => {
      const r = await consumer(
        `const sb = await createSandbox();
       await sb.writeFile('a.js', 'console.log(1)');
       out(await sb.exec('a.js'));`,
        { naturalExit: true },
      );
      expect(r.value).toEqual({ stdout: '1\n', stderr: '', exitCode: 0 });
      expect(r.exitCode).toBe(0);
      expect(r.signal).toBeNull();
    },
  );
});

describe('destroy of a light run on a shared worker (Final+GREEN r2 concern)', () => {
  carrier(
    'resolves once the cancelled run’s terminal frame arrives; the worker stays',
    async () => {
      const { value } = await consumer(`
      const sb = await createSandbox();
      await sb.writeFile('spin.js', 'for (;;) {}');
      const neighbour = settle(runCode("setTimeout(() => console.log('n'), 1500)", { timeoutMs: 20000 }));
      const running = settle(sb.exec('spin.js', { timeoutMs: 60000 }));
      await sleep(300);
      const before = children();
      await sb.destroy();
      out({ run: await running, neighbour: await neighbour, sameWorker: children().some((p) => before.includes(p)) });`);
      expect(value).toEqual({
        run: {
          rejected: 'isolate-host sandbox: destroyed',
          code: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED',
        },
        neighbour: { stdout: 'n\n', stderr: '', exitCode: 0 },
        sameWorker: true,
      });
    },
  );
});

describe('external review round 1 (manager 2026-11-23)', () => {
  carrier('destroy after a timed-out run waits until that isolate has stopped', async () => {
    // A builtin ignoring termination (ADR-0563 §4) keeps the isolate past its deadline; it
    // holds 300 MiB, so its worker's RSS tells whether it is still there.
    const { value } = await consumer(`
      const sb = await createSandbox();
      await sb.writeFile('s.js', "globalThis.h = new Uint8Array(300 << 20).fill(1); const a = Array.from({ length: 3e6 }, () => Math.random()); for (;;) a.sort()");
      const rss = (pid) => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim() || 0);
      const r = await sb.exec('s.js', { timeoutMs: 1500, memoryLimitMb: 512 });
      const pid = children().find((p) => rss(p) > 400 * 1024);
      await sb.destroy();
      let atResolve; try { atResolve = pid === undefined || rss(pid) < 300 * 1024 } catch { atResolve = true }
      out({ termination: r.termination, held: pid !== undefined, atResolve });`);
    expect(value).toEqual({ termination: 'timeout', held: true, atResolve: true });
  });

  carrier('the queue keeps no result: a dropped snapshot is collectable', async () => {
    const { value } = await consumer(
      `const sb = await createSandbox();
       await sb.writeFile('big', new Uint8Array(8 << 20).fill(1));
       let ref = new WeakRef(await sb.snapshot());
       for (let i = 0; i < 5 && ref.deref() !== undefined; i++) { await sleep(10); globalThis.gc(); }
       out({ collected: ref.deref() === undefined });`,
      { flags: ['--expose-gc'] },
    );
    expect(value).toEqual({ collected: true });
  });

  carrier('a refused overwrite past the cap leaves the old bytes', async () => {
    const sb = await createSandbox({ maxFsBytes: 64 * 1024 });
    try {
      await sb.writeFile('f', 'old');
      await expect(sb.writeFile('f', new Uint8Array(100 * 1024))).rejects.toMatchObject({
        code: 'ERR_ISOLATE_HOST_SANDBOX_FULL',
      });
      expect(await text(sb, 'f')).toBe('old');
    } finally {
      await sb.destroy();
    }
  });

  carrier('input bytes are the bytes at the call, even behind a long run', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('w.js', 'setTimeout(() => {}, 300)');
      const running = sb.exec('w.js');
      const mine = new Uint8Array([1, 2, 3]);
      const writing = sb.writeFile('f', mine);
      mine.fill(9);
      await Promise.all([running, writing]);
      expect([...(await sb.readFile('f'))]).toEqual([1, 2, 3]);
      const snap = await sb.snapshot();
      const created = createSandbox({ snapshot: snap });
      snap.fill(0);
      const again = await created;
      expect([...(await again.readFile('f'))]).toEqual([1, 2, 3]);
      await again.destroy();
    } finally {
      await sb.destroy();
    }
  });

  carrier('unknown option names are refused; the sandbox shows no internals', async () => {
    await expect(createSandbox({ maxFsByte: 1 } as Record<string, unknown>)).rejects.toMatchObject({
      code: 'ERR_INVALID_ARG_VALUE',
    });
    const sb = await createSandbox();
    try {
      await sb.writeFile('a.js', '1');
      await expect(sb.exec('a.js', { timeoutMS: 5 })).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_VALUE',
      });
      expect(JSON.stringify(sb)).toBe('{}');
      expect(Object.keys(sb)).toEqual([]);
    } finally {
      await sb.destroy();
    }
  });
});

describe('a call whose isolate still runs keeps its slot on every end (ADR-0563 §7)', () => {
  carrier(
    'memory reported while a builtin still holds the isolate: the slot stays taken',
    async () => {
      const { value } = await consumer(`
      const neighbours = [0, 1, 2].map(() => settle(runCode('setTimeout(() => {}, 20000)', { timeoutMs: 40000 })));
      await sleep(200);
      const culprit = await settle(runCode("const a = Array.from({ length: 3e6 }, () => Math.random()); const keep = []; for (;;) { keep.push(new Array(2e6).fill(1.5)); a.sort() }", { memoryLimitMb: 96, timeoutMs: 60000 }));
      const before = children();
      const probe = settle(runCode('1'));
      await sleep(100);
      const after = children();
      await probe; await Promise.all(neighbours);
      out({ culprit: culprit.termination, newWorker: after.some((p) => !before.includes(p)) });`);
      expect(value).toEqual({ culprit: 'memory', newWorker: true });
    },
  );
});

describe('external review round 2 (manager 2026-11-23)', () => {
  carrier(
    'a cap below an empty sandbox is refused at creation; at the least it works',
    async () => {
      for (const maxFsBytes of [0, 1, 1024])
        await expect(createSandbox({ maxFsBytes })).rejects.toMatchObject({
          code: 'ERR_OUT_OF_RANGE',
        });
      const error = (await createSandbox({ maxFsBytes: 1 }).catch((e: unknown) => e)) as Error;
      const least = Number(/at least (\d+)/.exec(error.message)?.[1]);
      const sb = await createSandbox({ maxFsBytes: least });
      await sb.exec('nope.js').catch(() => {});
      await sb.destroy();
      await expect(createSandbox({ maxFsBytes: least - 1 })).rejects.toMatchObject({
        code: 'ERR_OUT_OF_RANGE',
      });
    },
  );

  carrier(
    'everything an operation is given is fixed at the call: args, options, bytes',
    async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('w.js', 'setTimeout(() => {}, 300)');
        await sb.writeFile('a.js', 'console.log(process.argv.slice(2).join(","))');
        const running = sb.exec('w.js');
        const args = ['x', 'y'];
        const options = { args, timeoutMs: 20_000 };
        const queued = sb.exec('a.js', options);
        args.push('z');
        options.timeoutMs = 1;
        await running;
        expect(await queued).toEqual({ stdout: 'x,y\n', stderr: '', exitCode: 0 });
      } finally {
        await sb.destroy();
      }
      const opts = { maxFileBytes: 4 };
      const creating = createSandbox(opts);
      opts.maxFileBytes = 1 << 20;
      const small = await creating;
      await expect(small.writeFile('f', 'xxxxx')).rejects.toMatchObject({
        code: 'ERR_FS_FILE_TOO_LARGE',
      });
      await small.destroy();
    },
  );

  carrier('a destroy in flight leaves no hold on the run: its state is collectable', async () => {
    const { value } = await consumer(
      `const used = () => { globalThis.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
       const base = used();
       const sb = await createSandbox();
       for (let i = 0; i < 2; i++) await sb.writeFile('big' + i, new Uint8Array(16 << 20).fill(1));
       await sb.writeFile('spin.js', 'for (;;) {}');
       const running = settle(sb.exec('spin.js', { timeoutMs: 60000 }));
       await sleep(300);
       await sb.destroy();
       await running;
       // V8 sweeps freed ArrayBuffers on a background thread after gc(): poll until it has
       // (a real hold never drops; the inputs and the FS's copies are 64 MiB of garbage).
       let held = Infinity;
       for (let i = 0; i < 20 && held >= 8; i++) { await sleep(100); held = Math.min(held, (used() - base) / 2 ** 20); }
       out({ held, alive: typeof sb });`,
      { flags: ['--expose-gc'] },
    );
    expect((value as { held: number }).held).toBeLessThan(8);
  });

  carrier('a state that fails to encode leaves no phantom call on its worker', async () => {
    // A test limit: the floor keeps the real codec from throwing here, so the
    // throw is injected at the pool seam (CallSpec.sandbox.state).
    const pool = new Pool();
    const spec = {
      allowSharedArrayBuffer: false,
      code: '1',
      timeoutMs: 20_000,
      memoryLimitMb: 64,
      maxOutputBytes: 1 << 20,
    };
    const before = childPids();
    for (let i = 0; i < 4; i++)
      await expect(
        pool.run({
          ...spec,
          sandbox: {
            path: '/workspace/a.js',
            args: [],
            maxFsBytes: 1 << 20,
            state: () => {
              throw new RangeError('encode failed');
            },
          },
        }),
      ).rejects.toThrow('encode failed');
    // Four phantoms would fill the worker's slots: this call would need a second worker.
    await expect(pool.run({ ...spec, code: 'setTimeout(() => {}, 500)' })).resolves.toMatchObject({
      exitCode: 0,
    });
    expect(childPids().filter((p) => !before.includes(p))).toHaveLength(1);
  });

  carrier(
    'a request that fails half-written rejects its call (no rerun) and ends that worker',
    async () => {
      // A test limit at the pool seam: the state's second 3 MiB piece cannot be read.
      const pool = new Pool();
      const bytes = new Uint8Array(7 << 20);
      const real = bytes.buffer;
      let reads = 0;
      Object.defineProperty(bytes, 'buffer', {
        get: () => {
          if (++reads > 1) throw new RangeError('piece unreadable');
          return real;
        },
      });
      const spec = {
        allowSharedArrayBuffer: false,
        code: '',
        timeoutMs: 20_000,
        memoryLimitMb: 64,
        maxOutputBytes: 1 << 20,
      };
      const before = childPids();
      await expect(
        pool.run({
          ...spec,
          sandbox: { path: '/workspace/a.js', args: [], maxFsBytes: 8 << 20, state: () => bytes },
        }),
      ).rejects.toThrow('piece unreadable');
      // Its worker was killed (half a line on its stdin); no solo rerun was spawned.
      await new Promise((r) => setTimeout(r, 300));
      expect(childPids().filter((p) => !before.includes(p))).toHaveLength(0);
      await expect(pool.run({ ...spec, code: '1' })).resolves.toMatchObject({ exitCode: 0 });
    },
  );

  carrier('a destroy between the run result and its continuation rejects the exec', async () => {
    // The window is microtasks wide (another settled call's reaction may destroy there):
    // the real shared pool is wrapped so destroy lands exactly in it.
    const pool = sharedPool();
    const run = pool.run;
    const sb = await createSandbox();
    await sb.writeFile('t.js', 'require("fs").writeFileSync("after", "x")');
    let destroying: Promise<void> | undefined;
    pool.run = (spec, onStart) =>
      run.call(pool, spec, onStart).then((result) => {
        destroying = sb.destroy();
        return result;
      });
    try {
      await expect(sb.exec('t.js')).rejects.toMatchObject({
        code: 'ERR_ISOLATE_HOST_SANDBOX_DESTROYED',
      });
      await destroying;
    } finally {
      pool.run = run;
    }
  });
});

describe('external review round 3 (manager 2026-11-23)', () => {
  carrier(
    'a call that ends stopped frees its slot with its result: bursts stay on one warm worker',
    async () => {
      // The terminal frame and `gone` in one write: a separate `gone` chunk left the slot
      // taken when the next burst was placed, and it spawned a cold worker.
      const { value } = await consumer(`
      await runCode('1');
      const seen = new Set(children());
      for (let b = 0; b < 50; b++) {
        await Promise.all([0, 1, 2, 3].map(() => runCode('console.log(1)')));
        for (const p of children()) seen.add(p);
      }
      out({ workers: seen.size });`);
      expect(value).toEqual({ workers: 1 });
    },
  );
});

describe('a refused write leaves the state as it was, times included (Greptile, PR #419)', () => {
  carrier('overwrite, new file, new directories: the next run sees the same times', async () => {
    const sb = await createSandbox({ maxFsBytes: 64 << 10 });
    try {
      await sb.writeFile('d/f', 'old');
      await sb.writeFile(
        'st.js',
        "const fs = require('fs'); console.log(JSON.stringify(process.argv.slice(2).map((p) => { const s = fs.statSync(p); return [p, s.mtimeMs, s.ctimeMs, s.atimeMs, s.birthtimeMs, s.size]; })), JSON.stringify(fs.readdirSync('d')))",
      );
      const seen = async () =>
        (await sb.exec('st.js', { args: ['d', 'd/f', '/workspace'] })).stdout;
      const before = await seen();
      await new Promise((r) => setTimeout(r, 20));
      const big = new Uint8Array(70 << 10);
      for (const path of ['d/f', 'd/new', 'd/x/y/z', 'e/f'])
        await expect(sb.writeFile(path, big)).rejects.toMatchObject({
          code: 'ERR_ISOLATE_HOST_SANDBOX_FULL',
        });
      expect(await seen()).toBe(before);
    } finally {
      await sb.destroy();
    }
  });
});
