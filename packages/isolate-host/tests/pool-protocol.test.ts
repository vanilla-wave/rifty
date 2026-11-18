/**
 * Goal isolate-host-worker-pool, acceptance row 9 (I7): a worker after an
 * isolate escape is hostile and now carries several calls; a frame it
 * addresses to a call not in flight on it is a protocol violation, never
 * output or a status for another call. The worker here is a real Node process
 * replacing `dist/child.js` in a package copy; each call's `code` is the
 * hostile body it runs for that call (wire: acceptance item, "Wire").
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { consumer } from './support.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-hostile-pool-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A package copy whose worker runs each request's `code` with `call`, `f(kind, call, bytes)`, `text(s)`. */
function hostileWorkerPackage(): string {
  const dir = join(work, 'pkg');
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { writeSync } from 'node:fs';
     const f = (kind, call, payload) => {
       const b = Uint8Array.from(payload);
       const h = new Uint8Array(9); const v = new DataView(h.buffer);
       v.setUint32(0, b.length); h[4] = kind; v.setUint32(5, call);
       writeSync(3, Uint8Array.from([...h, ...b]));
     };
     const text = (s) => [...Buffer.from(s)];
     let pending = '';
     process.stdin.setEncoding('utf8').on('data', (d) => {
       pending += d;
       for (let nl; (nl = pending.indexOf('\\n')) >= 0; ) {
         const req = JSON.parse(pending.slice(0, nl)); pending = pending.slice(nl + 1);
         if (req.type === 'run') new Function('call', 'f', 'text', req.code)(req.call, f, text);
       }
     });
     setInterval(() => {}, 1000);`,
  );
  return pathToFileURL(join(dir, 'dist', 'index.js')).href;
}

const entry = hostileWorkerPackage();
const HONEST = 'setTimeout(() => { f(1, call, [1, 0, ...text("own")]); f(2, call, [0]); }, 800)';
const VIOLATION = /^isolate-host child protocol violation: /;

describe('call-addressed frames from a hostile worker (I7)', () => {
  it('frames for ids of calls on the other worker, or unknown ids, reject only the forging worker', async () => {
    const { value } = await consumer(
      `const honest = [0, 1, 2, 3].map(() => settle(runCode(${JSON.stringify(HONEST)}, { timeoutMs: 5000 })));
       await sleep(100);
       const forger = settle(runCode(${JSON.stringify(
         'for (let d = 1; d <= 4; d++) f(1, call - d, [1, 0, ...text("FORGED")]); f(1, call + 1000, [1, 0, ...text("FORGED")]); setTimeout(() => f(2, call, [0]), 800)',
       )}, { timeoutMs: 5000 }));
       out({ honest: await Promise.all(honest), forger: await forger, workers: children().length });`,
      { entry },
    );
    const v = value as { honest: unknown[]; forger: { rejected?: string } };
    expect(v.honest).toEqual([0, 1, 2, 3].map(() => ({ stdout: 'own', stderr: '', exitCode: 0 })));
    expect(v.forger.rejected).toMatch(VIOLATION);
  });

  it('a frame for a call already settled rejects the calls still in flight on that worker', async () => {
    const { value } = await consumer(
      `const settled = settle(runCode(${JSON.stringify(
        'f(2, call, [0]); setTimeout(() => f(1, call, [1, 0, ...text("LATE")]), 300)',
      )}, { timeoutMs: 5000 }));
       const inFlight = settle(runCode(${JSON.stringify(HONEST)}, { timeoutMs: 5000 }));
       out({ settled: await settled, inFlight: await inFlight });`,
      { entry },
    );
    expect(value).toEqual({
      settled: { stdout: '', stderr: '', exitCode: 0 },
      inFlight: { rejected: expect.stringMatching(VIOLATION) },
    });
  });
});
