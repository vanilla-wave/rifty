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
  const sb = await createSandbox({ maxFsBytes: 1024 });
  await sb.writeFile('a', 'kept');
  const exec = await settle(sb.exec('a'));
  out({ run, exec, kept: Buffer.from(await sb.readFile('a')).toString() });`;

describe('a hostile worker and state frames (Fault matrix)', () => {
  carrier(
    'a state frame for a runCode call, or past maxFsBytes, is a protocol violation',
    async () => {
      const { value } = await consumer(HOSTILE_BODY, {
        entry: hostileStatePackage('oversized', 2048, 1, 0),
      });
      expect(value).toMatchObject({ run: VIOLATION, exec: VIOLATION, kept: 'kept' });
    },
  );

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
    ${end === 'destroy' ? 'await destroyed;' : ''}
    // Disposed: its worker gives the 300 MiB back (or is gone).
    const freed = await waitFor(() => { try { return rss(pid) < 300 * 1024 ? true : undefined } catch { return true } }, 10000).catch(() => false);
    out({ result, freed });`;

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
    throws: `for (const k of Object.getOwnPropertyNames(DataView.prototype)) if (k.startsWith('set')) DataView.prototype[k] = () => { throw new Error('poisoned') };`,
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
      if (label === 'hangs')
        expect(v.exec).toMatchObject({ exitCode: null, termination: 'timeout' });
      else
        expect(v.exec).toMatchObject({ exitCode: 0, stateRefused: expect.stringMatching(/^ERR_/) });
      expect(v.names).toEqual(['keep', 'p.js']);
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
