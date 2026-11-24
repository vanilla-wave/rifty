/**
 * Cancelling a sandbox operation with an `AbortSignal` (backlog
 * `distribution/isolate-host-sandbox-exec-abort-signal`): its scenario, the
 * error against live Node's `AbortError`, the option's refusals and the host
 * ops. The table of moments × ends is `sandbox-abort-table.test.ts`.
 */
import { execFile } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';
import { type CallHandle, type CallSpec, sharedPool } from '../src/pool.ts';
import { nodeEval } from './support.ts';

interface Signalled {
  readonly signal?: unknown;
}
interface Sandbox {
  writeFile(path: string, data: string, options?: Signalled): Promise<void>;
  readFile(path: string, options?: Signalled): Promise<Uint8Array>;
  list(path?: string, options?: Signalled): Promise<{ name: string }[]>;
  remove(path: string, options?: Signalled): Promise<void>;
  snapshot(options?: Signalled): Promise<Uint8Array>;
  exec(path: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  destroy(): Promise<void>;
}
const createSandbox = (options?: Record<string, unknown>): Promise<Sandbox> =>
  (pkg as unknown as { createSandbox: (o?: unknown) => Promise<Sandbox> }).createSandbox(options);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failure = (p: Promise<unknown>): Promise<Record<string, unknown>> =>
  p.then(
    (value) => ({ resolved: value }),
    (e: Record<string, unknown>) => e,
  );
const names = async (sb: Sandbox) => (await sb.list()).map((e) => e.name);

/** Count the pool calls placed while `body` runs (observation only: the real pool runs). */
async function placed<T>(body: () => Promise<T>): Promise<{ value: T; calls: number }> {
  const pool = sharedPool();
  const run = pool.run;
  let calls = 0;
  pool.run = (spec: CallSpec, onStart?: (h: CallHandle) => void) => {
    calls++;
    return run.call(pool, spec, onStart);
  };
  try {
    return { value: await body(), calls };
  } finally {
    pool.run = run;
  }
}

/** The observable shape of an error, as both sides compute it. */
const SHAPE = `(e, reason) => ({
  ctor: e.constructor.name,
  name: e.name,
  code: e.code,
  message: e.message,
  own: Object.getOwnPropertyNames(e),
  keys: Object.keys(e),
  isError: e instanceof Error,
  causeIsReason: e.cause === reason,
  cause: { ctor: e.cause?.constructor?.name, name: e.cause?.name, message: e.cause?.message, code: e.cause?.code },
})`;
const shape = new Function(`return ${SHAPE}`)() as (e: unknown, reason: unknown) => unknown;

describe('the turn signal cancels a run without destroying the sandbox (scenario)', () => {
  it('an endless run rejects AbortError at the abort; the files are those of before; the next exec runs', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('keep.txt', 'k');
      await sb.writeFile('main.js', "require('fs').writeFileSync('partial', '1'); for (;;) {}");
      const controller = new AbortController();
      const reason = new Error('turn over');
      const { value, calls } = await placed(async () => {
        const run = failure(sb.exec('main.js', { signal: controller.signal }));
        // Queued behind it with the same signal: never starts.
        const queued = failure(sb.exec('main.js', { signal: controller.signal }));
        await sleep(200);
        const at = performance.now();
        controller.abort(reason);
        const e = await run;
        const ms = performance.now() - at;
        const rest = await queued;
        // The queue has reached the aborted exec's turn: what it placed is counted.
        await names(sb);
        return { e, ms, queued: rest };
      });
      expect(value.e).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(value.e.cause).toBe(reason);
      expect(value.ms).toBeLessThan(50);
      expect(value.queued).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(calls).toBe(1);
      expect(await names(sb)).toEqual(['keep.txt', 'main.js']);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      await sb.writeFile('main.js', "require('fs').writeFileSync('done', '1')");
      expect(await sb.exec('main.js')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect(await names(sb)).toEqual(['done', 'keep.txt', 'main.js']);
    } finally {
      await sb.destroy();
    }
  });

  it('an already-aborted signal rejects without a pool call', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('main.js', "require('fs').writeFileSync('ran', '1')");
      const { value, calls } = await placed(() =>
        failure(sb.exec('main.js', { signal: AbortSignal.abort() })),
      );
      expect(value).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(calls).toBe(0);
      expect(await names(sb)).toEqual(['main.js']);
    } finally {
      await sb.destroy();
    }
  });

  it('an abort after the result has no effect and leaves no listener', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('main.js', "require('fs').writeFileSync('ran', '1')");
      const controller = new AbortController();
      expect(await sb.exec('main.js', { signal: controller.signal })).toEqual({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      controller.abort();
      expect(await names(sb)).toEqual(['main.js', 'ran']);
      expect(await sb.exec('main.js')).toMatchObject({ exitCode: 0 });
    } finally {
      await sb.destroy();
    }
  });
});

describe("the rejection is Node's AbortError (parity, Node fs.promises.readFile)", () => {
  // Node's own: an in-flight readFile aborted with and without a reason, a pre-aborted one without.
  const oracle = (): { reason: unknown; bare: unknown; pre: unknown } => {
    const r =
      nodeEval(`const fs = require('fs'); fs.writeFileSync('f', 'x'); const shape = ${SHAPE};
      (async () => {
        const reason = new Error('turn over');
        const c = new AbortController(); const p = fs.promises.readFile('f', { signal: c.signal }); c.abort(reason);
        const a = await p.catch((e) => shape(e, reason));
        const c2 = new AbortController(); const p2 = fs.promises.readFile('f', { signal: c2.signal }); c2.abort();
        const b = await p2.catch((e) => shape(e, c2.signal.reason));
        const s = AbortSignal.abort();
        const d = await fs.promises.readFile('f', { signal: s }).catch((e) => shape(e, s.reason));
        process.stdout.write(JSON.stringify({ reason: a, bare: b, pre: d }));
      })()`);
    return JSON.parse(r.stdout) as { reason: unknown; bare: unknown; pre: unknown };
  };
  it('abort(reason) and abort() in flight, abort() before the call give the oracle shape', async () => {
    const node = oracle();
    const sb = await createSandbox();
    try {
      await sb.writeFile('main.js', 'for (;;) {}');
      const c = new AbortController();
      const reason = new Error('turn over');
      const run = failure(sb.exec('main.js', { signal: c.signal }));
      await sleep(100);
      c.abort(reason);
      const c2 = new AbortController();
      const run2 = failure(sb.exec('main.js', { signal: c2.signal }));
      await sleep(100);
      c2.abort();
      const s = AbortSignal.abort();
      const pre = await failure(sb.exec('main.js', { signal: s }));
      expect({
        reason: shape(await run, reason),
        bare: shape(await run2, c2.signal.reason),
        pre: shape(pre, s.reason),
      }).toEqual(node);
    } finally {
      await sb.destroy();
    }
  });
});

describe('the signal option', () => {
  it("is an option of exec and of every host op; a value Node refuses is refused with Node's error", async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('m.js', '');
      const ok = new AbortController().signal;
      expect(await sb.exec('m.js', { signal: ok })).toMatchObject({ exitCode: 0 });
      await sb.writeFile('w', 'x', { signal: ok });
      expect(await sb.readFile('w', { signal: ok })).toEqual(new TextEncoder().encode('x'));
      expect(await sb.list(undefined, { signal: ok })).toHaveLength(2);
      await sb.remove('w', { signal: ok });
      expect(await sb.snapshot({ signal: ok })).toBeInstanceOf(Uint8Array);
      // The oracle: this very Node — `fs.promises.readFile` (its validator), `execFile` for a
      // signal-shaped object without `addEventListener` (it subscribes, as here).
      const node = async (bad: unknown): Promise<Record<string, unknown>> => {
        try {
          if (typeof bad === 'object' && bad !== null && 'aborted' in bad)
            execFile(process.execPath, ['-e', ''], { signal: bad as AbortSignal }, () => {});
          else await readFile(fileURLToPath(import.meta.url), { signal: bad as AbortSignal });
          return {};
        } catch (e) {
          const { name, code, message } = e as Record<string, unknown>;
          return { name, code, message };
        }
      };
      for (const bad of ['x', 1, null, {}, { aborted: false }]) {
        const expected = await node(bad);
        expect(expected.name, String(bad)).toBe('TypeError');
        const ops = [
          sb.exec('m.js', { signal: bad }),
          sb.writeFile('w', 'x', { signal: bad }),
          sb.readFile('m.js', { signal: bad }),
          sb.list(undefined, { signal: bad }),
          sb.remove('m.js', { signal: bad }),
          sb.snapshot({ signal: bad }),
        ];
        for (const op of ops) expect(await failure(op), String(bad)).toMatchObject(expected);
      }
      // A signal-shaped object already aborted: Node's readFile takes it as aborted.
      const shaped = { aborted: true, reason: 'r' };
      expect(await failure(sb.exec('m.js', { signal: shaped }))).toMatchObject({
        name: 'AbortError',
        code: 'ABORT_ERR',
        cause: 'r',
      });
      expect(
        await failure(readFile(fileURLToPath(import.meta.url), { signal: shaped as never })),
      ).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR', cause: 'r' });
      expect(await names(sb)).toEqual(['m.js']);
      for (const op of [
        sb.writeFile('w', 'x', { sinal: ok } as Signalled),
        sb.readFile('m.js', { sinal: ok } as Signalled),
      ])
        expect(await failure(op)).toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    } finally {
      await sb.destroy();
    }
  });

  it('a signal whose own members throw (a consumer bug) is refused at the call with that error; nothing is placed', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('m.js', "require('fs').writeFileSync('ran', '1')");
      const thrown = new Error('reason getter');
      const aborted = AbortSignal.abort();
      Object.defineProperty(aborted, 'reason', {
        get() {
          throw thrown;
        },
      });
      const listening = new AbortController().signal;
      const refused = new Error('addEventListener');
      listening.addEventListener = () => {
        throw refused;
      };
      const { value, calls } = await placed(async () => [
        await failure(sb.exec('m.js', { signal: aborted })),
        await failure(sb.exec('m.js', { signal: listening })),
        await failure(sb.writeFile('w', 'x', { signal: listening })),
      ]);
      expect(value).toEqual([thrown, refused, refused]);
      expect(calls).toBe(0);
      expect(await names(sb)).toEqual(['m.js']);
    } finally {
      await sb.destroy();
    }
  });
});

describe('host ops: aborted at the call or while queued → AbortError, no effect; started → they complete', () => {
  const OPS: Readonly<Record<string, (sb: Sandbox, signal: AbortSignal) => Promise<unknown>>> = {
    writeFile: (sb, signal) => sb.writeFile('w', 'x', { signal }),
    readFile: (sb, signal) => sb.readFile('f', { signal }),
    list: (sb, signal) => sb.list(undefined, { signal }),
    remove: (sb, signal) => sb.remove('f', { signal }),
    snapshot: (sb, signal) => sb.snapshot({ signal }),
  };
  for (const [name, op] of Object.entries(OPS)) {
    it(`${name}: an aborted signal at the call`, async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('f', 'data');
        const reason = new Error('turn over');
        const e = await failure(op(sb, AbortSignal.abort(reason)));
        expect(e).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
        expect(e.cause).toBe(reason);
        expect(await names(sb)).toEqual(['f']);
      } finally {
        await sb.destroy();
      }
    });
    it(`${name}: aborted while queued behind a run, it rejects at the abort; later ops keep their order`, async () => {
      const sb = await createSandbox();
      try {
        await sb.writeFile('f', 'data');
        await sb.writeFile('slow.js', 'const t = Date.now(); while (Date.now() - t < 600) {}');
        const order: string[] = [];
        const run = sb.exec('slow.js').then(() => order.push('run'));
        const c = new AbortController();
        const queued = failure(op(sb, c.signal)).then((e) => {
          order.push('aborted');
          return e;
        });
        const later = sb.writeFile('later', 'y').then(() => order.push('later'));
        await sleep(150);
        c.abort();
        expect(await queued).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
        expect(order).toEqual(['aborted']);
        await Promise.all([run, later]);
        expect(order).toEqual(['aborted', 'run', 'later']);
        expect(await names(sb)).toEqual(['f', 'later', 'slow.js']);
      } finally {
        await sb.destroy();
      }
    });
  }
});

describe('a consumer listener that stops the abort event does not stop the cancel (as Node)', () => {
  it('the run in flight and an op queued behind it are cancelled; execFile on the same signal too', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('main.js', 'for (;;) {}');
      const c = new AbortController();
      c.signal.addEventListener('abort', (e) => e.stopImmediatePropagation());
      const run = failure(sb.exec('main.js', { signal: c.signal, timeoutMs: 5000 }));
      const queued = failure(sb.writeFile('w', 'x', { signal: c.signal }));
      const node = new Promise<unknown>((resolve) =>
        execFile(
          process.execPath,
          ['-e', 'setTimeout(() => {}, 5000)'],
          { signal: c.signal },
          resolve,
        ),
      );
      await sleep(200);
      const at = performance.now();
      c.abort();
      expect(await run).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(performance.now() - at).toBeLessThan(50);
      expect(await queued).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(await node).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(await names(sb)).toEqual(['main.js']);
    } finally {
      await sb.destroy();
    }
  });
});

describe('exec options are read at the call', () => {
  it('`args: null` is ERR_INVALID_ARG_TYPE, as an args that is not an array', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile('m.js', '');
      expect(await failure(sb.exec('m.js', { args: null }))).toMatchObject({
        code: 'ERR_INVALID_ARG_TYPE',
      });
    } finally {
      await sb.destroy();
    }
  });
});
