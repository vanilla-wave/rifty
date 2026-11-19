/**
 * ADR-0563 §3: a worker after an
 * isolate escape is hostile and now carries several calls; a frame it
 * addresses to a call not in flight on it is a protocol violation, never
 * output or a status for another call. The worker here is a real Node process
 * replacing `dist/child.js` in a package copy; each call's `code` is the
 * hostile body it runs for that call (wire: `src/protocol.ts`).
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { consumer } from './support.ts';

/** The acceptance carrier; RED was `it.fails` before the pool landed. */
const carrier = it;

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-hostile-pool-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const LEDGER = join(work, 'calls.ledger');
const FORGER_PID = join(work, 'forger.pid');

/**
 * A package copy whose worker runs each request's `code` with `call`,
 * `f(kind, call, bytes)`, `text(s)` and `others()` — the call ids every other
 * hostile worker of this consumer received (a shared ledger file).
 */
function hostileWorkerPackage(): string {
  const dir = join(work, 'pkg');
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { appendFileSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
     const LEDGER = ${JSON.stringify(LEDGER)}, FORGER_PID = ${JSON.stringify(FORGER_PID)};
     const others = () => readFileSync(LEDGER, 'utf8').trim().split('\\n').map((l) => l.split(' ').map(Number))
       .filter(([pid]) => pid !== process.pid).map(([, call]) => call);
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
         if (req.type !== 'run') continue;
         appendFileSync(LEDGER, process.pid + ' ' + req.call + '\\n');
         new Function('call', 'f', 'text', 'others', 'writeFileSync', 'FORGER_PID', req.code)(req.call, f, text, others, writeFileSync, FORGER_PID);
       }
     });
     // Like a real worker, gone when its consumer is (stdin end): no orphan per test run.
     process.stdin.on('end', () => process.exit(0));
     setInterval(() => {}, 1000);`,
  );
  return pathToFileURL(join(dir, 'dist', 'index.js')).href;
}

const entry = hostileWorkerPackage();
const HONEST = 'setTimeout(() => { f(1, call, [1, 0, ...text("own")]); f(2, call, [0]); }, 1500)';
const VIOLATION = /^isolate-host child protocol violation: /;

describe('call-addressed frames from a hostile worker (ADR-0563 §3)', () => {
  carrier(
    'frames for ids of calls on the other worker, or unknown ids, kill only the forging worker',
    async () => {
      writeFileSync(LEDGER, '');
      const { value } = await consumer(
        `const honest = [0, 1, 2, 3].map(() => settle(runCode(${JSON.stringify(HONEST)}, { timeoutMs: 5000 })));
       await sleep(100);
       const forger = settle(runCode(${JSON.stringify(
         'writeFileSync(FORGER_PID, String(process.pid)); const t = setInterval(() => { const ids = others(); if (ids.length < 4) return; clearInterval(t); for (const id of [...ids, call + 1000]) f(1, id, [1, 0, ...text("FORGED")]); setTimeout(() => f(2, call, [0]), 800); }, 20)',
       )}, { timeoutMs: 5000 }));
       const results = await Promise.all(honest);
       const rejected = await forger;
       // Inside the live consumer: the violation itself must kill the forger, not consumer exit.
       const pid = Number(readFileSync(${JSON.stringify(FORGER_PID)}, 'utf8'));
       const killed = await waitFor(() => { try { process.kill(pid, 0); return undefined; } catch { return true; } }, 3000).catch(() => false);
       out({ honest: results, forger: rejected, killed });`,
        { entry },
      );
      const v = value as { honest: unknown[]; forger: { rejected?: string }; killed: boolean };
      expect(v.honest).toEqual(
        [0, 1, 2, 3].map(() => ({ stdout: 'own', stderr: '', exitCode: 0 })),
      );
      expect(v.forger.rejected).toMatch(VIOLATION);
      expect(v.killed).toBe(true);
    },
  );

  carrier('a frame for an unknown call id alone is a violation', async () => {
    writeFileSync(LEDGER, '');
    const { value } = await consumer(
      `out(await settle(runCode(${JSON.stringify(
        'f(1, call + 1000, [1, 0, ...text("FORGED")]); setTimeout(() => f(2, call, [0]), 800)',
      )}, { timeoutMs: 5000 })));`,
      { entry },
    );
    expect((value as { rejected?: string }).rejected).toMatch(VIOLATION);
  });

  carrier(
    'a frame for a call already settled rejects the calls still in flight on that worker',
    async () => {
      writeFileSync(LEDGER, '');
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
    },
  );

  carrier("a lost worker's rejection carries no worker-written text", async () => {
    writeFileSync(LEDGER, '');
    // Each hostile worker writes text to its stderr and dies; the call reruns once, then rejects.
    const { value } = await consumer(
      `out(await settle(runCode(${JSON.stringify(
        "process.stderr.write('WORKER-TEXT\\n', () => process.kill(process.pid, 'SIGKILL'))",
      )}, { timeoutMs: 10000 })));`,
      { entry },
    );
    const v = value as { rejected?: string; code?: string };
    expect(v.code).toBe('ERR_ISOLATE_HOST_WORKER_LOST');
    expect(v.rejected).toMatch(/exited unexpectedly .*SIGKILL/);
    expect(v.rejected).not.toContain('WORKER-TEXT');
  });

  carrier(
    'a worker that has exited but whose channel is still open takes no new call',
    async () => {
      writeFileSync(LEDGER, '');
      // The first call answers, then its worker exits while a grandchild keeps fd 3 open for 3 s:
      // 'exit' has fired, 'close' has not.
      const { value } = await consumer(
        `await settle(runCode(${JSON.stringify(
          'f(2, call, [0]); import("node:child_process").then(({ spawn }) => { spawn("sleep", ["3"], { stdio: ["ignore", "ignore", "ignore", 3], detached: true }).unref(); setTimeout(() => process.exit(0), 50) })',
        )}, { timeoutMs: 10000 }));
       await sleep(400);
       const t0 = now();
       const next = await settle(runCode(${JSON.stringify('setTimeout(() => f(2, call, [0]), 100)')}, { timeoutMs: 10000 }));
       out({ next, ms: now() - t0 });`,
        { entry },
      );
      const v = value as { next: unknown; ms: number };
      expect(v.next).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      // Placed on the exited worker it would wait for 'close' (3 s), then rerun.
      expect(v.ms).toBeLessThan(2000);
    },
  );
});
