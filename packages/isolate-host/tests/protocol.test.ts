/**
 * A child compromised by an isolate escape is hostile (ADR-0557 §6): the
 * consumer parses its fd-3 frames itself and judges each one. Each case runs
 * the real built `runCode` from a copy of the package whose `dist/child.js` is
 * a real hostile Node process writing raw bytes to fd 3; the consumer must
 * kill it and reject with a distinct protocol error — never throw, never hang,
 * never hold more than the output cap (I4).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CHANNEL_END_GRACE_MS } from '../src/pool.ts';
import { FrameReader, HEADER, KIND, frame } from '../src/protocol.ts';
import { consumer } from './support.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-hostile-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * Hostile child bodies: `f(kind, payload)` writes a frame with a true length
 * header, `raw(bytes)` writes anything. Each runs after reading the request (cap 1024).
 */
const HOSTILE: Readonly<Record<string, string>> = {
  'garbage bytes': 'raw([0xff, 0x0f, 0x99, 0x99, 0x99, 0x42, 0x42, 0x42, 0x42])',
  'unknown kind': 'f(9, [])',
  'kind zero': 'f(0, [1])',
  'frame announcing 4 GiB': 'raw([0xff, 0xff, 0xff, 0xf0, 1, ...C])',
  'output announcing past the cap': 'raw([0, 0, 0x10, 0, 1, ...C])',
  'output fd 3': 'f(1, [3, 0, 65])',
  'output truncated flag 2': 'f(1, [1, 2, 65])',
  'output header too short': 'f(1, [1])',
  'output with no new bytes': 'f(1, [1, 0])',
  'output past the cap in two frames':
    'f(1, [1, 0, ...new Array(1000).fill(65)]); f(1, [2, 0, ...new Array(100).fill(66)])',
  'output truncation reverted': 'f(1, [1, 1, 65]); f(1, [1, 0, 66])',
  'exit payload empty': 'f(2, [])',
  'exit payload too long': 'f(2, [0, 0])',
  'memory payload not empty': 'f(3, [0])',
  'error text over 4 KiB': 'f(4, new Array(5000).fill(120))',
  // A header split across writes must not be mistaken for a short frame.
  'byte-by-byte garbage': 'for (const b of [0xff, 0xff, 0xff, 0xff, 1, ...C]) raw([b])',
};

function hostilePackage(label: string, body: string): string {
  const dir = join(work, label.replace(/\W+/g, '-'));
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { closeSync, writeFileSync, writeSync } from 'node:fs';
     const raw = (bytes) => writeSync(3, Uint8Array.from(bytes));
     let C = [];
     const f = (kind, payload) => {
       const b = Uint8Array.from(payload);
       const h = new Uint8Array(5); new DataView(h.buffer).setUint32(0, b.length); h[4] = kind;
       raw([...h, ...C, ...b]);
     };
     process.stdin.on('end', () => process.exit(0));
     process.stdin.once('data', (d) => {
       // The call id of the run request, big-endian: what every frame addresses.
       const call = JSON.parse(String(d).split('\\n')[0]).call;
       C = [call >>> 24, (call >>> 16) & 255, (call >>> 8) & 255, call & 255];
       ${body}; setInterval(() => {}, 1000);
     });`,
  );
  return join(dir, 'dist', 'index.js');
}

/** Run `runCode('1', options)` in a separate consumer process; a throw there is reported, not fatal. */
function consume(entry: string, options: string, flags: string[] = [], before = ''): unknown {
  const script = `const { runCode } = await import(${JSON.stringify(new URL(`file://${entry}`).href)});
    const t = Date.now();
    process.on('uncaughtException', (e) => { console.log(JSON.stringify({ uncaught: e.message })); process.exit(0); });
    ${before}
    runCode('1', ${options}).then(
      async (r) => console.log(JSON.stringify({ resolved: r, ms: Date.now() - t, held: await globalThis.held })),
      async (e) => console.log(JSON.stringify({ rejected: e.message, ms: Date.now() - t, held: await globalThis.held })),
    );`;
  return JSON.parse(
    execFileSync(process.execPath, [...flags, '--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );
}

/**
 * A preempted consumer, at the instant that matters: arming the closed-channel
 * grace, it stops running until its child (cued by SIGUSR2) has exited and the
 * grace is due, so the exit is still unread when the grace timer fires. `ps`
 * shows the exit; no fixed wait.
 */
const STARVED_AT_GRACE = `const { execFileSync } = await import('node:child_process');
  const kids = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' })
    .split('\\n').map((l) => /^\\s*(\\d+)\\s+(\\d+)\\s+(\\S+)\\s+(.*)$/.exec(l))
    .filter((m) => m && Number(m[2]) === process.pid);
  const arm = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = arm(fn, ms, ...args);
    if (ms === ${CHANNEL_END_GRACE_MS}) {
      const due = performance.now() + ms;
      for (const m of kids()) if (m[4].includes('child.js')) process.kill(Number(m[1]), 'SIGUSR2');
      const end = Date.now() + 10000;
      while (!kids().some((m) => m[3].startsWith('Z'))) if (Date.now() > end) throw new Error('no exit');
      while (performance.now() < due + 5);
    }
    return timer;
  };`;

describe('consumer treats the child channel as hostile', () => {
  for (const [label, body] of Object.entries(HOSTILE)) {
    it(label, () => {
      const report = consume(
        hostilePackage(label, body),
        '{ timeoutMs: 5000, maxOutputBytes: 1024 }',
      ) as { rejected?: string; ms?: number };
      expect(report.rejected).toMatch(/^isolate-host child protocol violation: /);
      expect(report.ms).toBeLessThan(1000);
    });
  }

  it('a legal header with a never-completed payload buffers at most one legal frame', () => {
    // Announces a 1026-byte output frame (cap 1024), sends 1000 bytes of it, then stalls.
    const entry = hostilePackage(
      'stalled frame',
      'raw([0, 0, 0x04, 0x02, 1, ...C, 1, 0, ...new Array(998).fill(65)])',
    );
    const report = consume(entry, '{ timeoutMs: 2000, maxOutputBytes: 1024 }') as {
      resolved?: { termination?: string; stdout: string };
    };
    expect(report.resolved?.termination).toBe('timeout');
    expect(report.resolved?.stdout).toBe('');
  });

  it('accepted output is copied, never kept as views into received buffers', () => {
    // 2^16 valid one-byte frames, then the child idles. While the call is pending the
    // consumer holds the bytes (64 KiB) in one buffer, not 2^16 received chunk objects.
    const entry = hostilePackage(
      'valid one-byte flood',
      'for (let i = 0; i < 1 << 16; i++) f(1, [1, 0, 65])',
    );
    const report = consume(
      entry,
      '{ timeoutMs: 6000, maxOutputBytes: 1 << 20 }',
      ['--expose-gc'],
      `const used = () => { globalThis.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
       const base = used();
       setTimeout(() => { globalThis.held = (used() - base) / (1 << 20); }, 4500);`,
    ) as { resolved?: { stdout: string; termination?: string }; held?: number };
    expect(report.resolved?.stdout.length).toBe(1 << 16);
    expect(report.resolved?.termination).toBe('timeout');
    expect(report.held).toBeGreaterThanOrEqual(0);
    expect(report.held).toBeLessThan(4);
  }, 30_000);

  it('a frame fed one byte at a time is accepted whole', () => {
    const entry = hostilePackage(
      'byte-by-byte valid',
      'for (const b of [0, 0, 0, 5, 1, ...C, 1, 0, 104, 105, 33]) raw([b]); for (const b of [0, 0, 0, 1, 2, ...C, 7]) raw([b])',
    );
    const report = consume(entry, '{ timeoutMs: 5000, maxOutputBytes: 1024 }') as {
      resolved?: { stdout: string; exitCode: number | null };
    };
    expect(report.resolved).toEqual({ stdout: 'hi!', stderr: '', exitCode: 7 });
  });

  it('bytes after a terminal frame are ignored, in its chunk or after it', () => {
    for (const [label, body] of [
      ['same chunk', 'f(2, [3]); raw([0xff, 0xff, 0xff, 0xff, 9])'],
      ['later chunk', 'f(2, [3]); setTimeout(() => raw([0xff, 0xff, 0xff, 0xff, 9]), 20)'],
    ] as const) {
      const report = consume(
        hostilePackage(`trailing garbage ${label}`, body),
        '{ timeoutMs: 5000, maxOutputBytes: 1024 }',
      ) as { resolved?: { exitCode: number | null } };
      expect(report.resolved?.exitCode, label).toBe(3);
    }
  });

  it('a child that closes the channel and exits is reported by its own exit code', () => {
    // Both the closed channel and the exit describe this run; the exit is the
    // precise one, so it must win over the channel-closed outcome — also when
    // the consumer reads it only after the grace timer is due.
    const entry = hostilePackage(
      'closed then exit',
      "process.on('SIGUSR2', () => process.exit(7)); closeSync(3)",
    );
    const report = consume(
      entry,
      '{ timeoutMs: 5000, maxOutputBytes: 1024 }',
      [],
      STARVED_AT_GRACE,
    ) as { rejected?: string };
    expect(report.rejected).toBe('isolate-host child exited unexpectedly (code 7, signal null)');
  });

  // A starved consumer judges its deadline by what it reads first, not by when the
  // child sent it: reading late cannot tell a frame sent in time from one sent after
  // (backlog distribution/isolate-host-starved-deadline-outcome). Pinned both ways.
  it('a starved consumer: a result sent after the deadline loses to it (timeout)', () => {
    const sent = join(work, 'late-frame-sent');
    const entry = hostilePackage(
      'result after a starved deadline',
      // Its timer starts after the call did: the frame leaves after the 1500 ms deadline.
      `setTimeout(() => { f(2, [5]); writeFileSync(${JSON.stringify(sent)}, '') }, 1600)`,
    );
    const report = consume(
      entry,
      '{ timeoutMs: 1500, maxOutputBytes: 1024 }',
      [],
      `const { existsSync } = await import('node:fs');
       queueMicrotask(() => {
         const end = Date.now() + 10000;
         while (!existsSync(${JSON.stringify(sent)})) if (Date.now() > end) throw new Error('no frame');
       });`,
    ) as { resolved?: unknown };
    expect(report.resolved).toEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      termination: 'timeout',
    });
  });

  it('a starved consumer: a rerun that finishes after the deadline is a lost call (F1)', () => {
    // Order imposed, no start in the budget: the call lands on a warm worker the consumer
    // kills at once; its solo rerun may boot as slowly as it likes while the consumer
    // stalls (from the check phase: the next turn runs the due deadline before its poll),
    // and answers only on the consumer's cue, after the deadline. The 3000 ms bound only
    // has to cover the consumer's own turn that reads the kill and spawns the solo.
    const ready = join(work, 'starved-rerun-ready');
    const sent = join(work, 'starved-rerun-sent');
    const entry = hostilePackage(
      'rerun after a starved deadline',
      `const answer = (r) => {
         C = [r.call >>> 24, (r.call >>> 16) & 255, (r.call >>> 8) & 255, r.call & 255];
         if (r.solo) {
           process.on('SIGUSR2', () => { f(2, [5]); writeFileSync(${JSON.stringify(sent)}, '') });
           writeFileSync(${JSON.stringify(ready)}, '');
         } else if (r.code === 'prime') f(2, [0]);
       };
       answer(JSON.parse(String(d).split('\\n')[0]));
       process.stdin.on('data', (more) => answer(JSON.parse(String(more).split('\\n')[0])))`,
    );
    const report = consume(
      entry,
      '{ timeoutMs: 3000, maxOutputBytes: 1024 }',
      [],
      `const { execFileSync } = await import('node:child_process');
       const { existsSync } = await import('node:fs');
       const kids = (zombie) => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' })
         .split('\\n').map((l) => /^\\s*(\\d+)\\s+(\\d+)\\s+(\\S+)\\s+(.*)$/.exec(l))
         .filter((m) => m && Number(m[2]) === process.pid && (zombie ? m[3].startsWith('Z') : m[4].includes('child.js') && !m[3].startsWith('Z')))
         .map((m) => Number(m[1]));
       const end = Date.now() + 20000;
       const until = (ok, what) => { while (!ok()) if (Date.now() > end) throw new Error('no ' + what); };
       await runCode('prime', { timeoutMs: 60000 });
       const [warm] = kids(false);
       queueMicrotask(() => {
         const due = performance.now() + 3000;
         process.kill(warm, 'SIGKILL');
         until(() => kids(true).includes(warm), 'exit');
         const step = () => {
           const solo = kids(false).find((p) => p !== warm);
           if (solo === undefined) {
             // Read late (the deadline won): a readable red, not a spin until the harness kills it.
             if (Date.now() > end) throw new Error('no solo rerun spawned');
             return void setImmediate(step);
           }
           until(() => existsSync(${JSON.stringify(ready)}), 'ready');
           until(() => performance.now() >= due + 5, 'deadline');
           process.kill(solo, 'SIGUSR2');
           until(() => existsSync(${JSON.stringify(sent)}), 'frame');
         };
         setImmediate(step);
       });`,
    ) as { rejected?: string };
    expect(report.rejected).toBe(
      'isolate-host child exited unexpectedly (code null, signal SIGKILL); its rerun did not finish within timeoutMs',
    );
  });

  // From its channel's end the worker can answer nothing: it takes no call and is never
  // idle, through the grace and until its loss is decided. Each case acts inside the
  // consumer's 'end' handler (where the grace is armed), so no timing decides it.
  const AT_CHANNEL_END = (act: string) => `const arm = globalThis.setTimeout;
    let acted = false;
    globalThis.setTimeout = (fn, ms, ...args) => {
      const timer = arm(fn, ms, ...args);
      if (ms === ${CHANNEL_END_GRACE_MS} && !acted) { acted = true; ${act} }
      return timer;
    };`;
  const ANSWER = (
    cases: string,
  ) => `const id = (c) => [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
    const answer = (r) => { C = id(r.call); ${cases} };
    const each = (chunk) => { for (const l of String(chunk).trim().split('\\n')) answer(JSON.parse(l)) };
    each(d);
    process.stdin.on('data', each)`;

  it('a worker whose result channel ended takes no new call: the call gets a fresh worker, not a spent rerun', async () => {
    const entry = hostilePackage(
      'placement after channel end',
      ANSWER(`if (r.solo) process.kill(process.pid, 'SIGKILL');
        else if (r.code === 'first') closeSync(3);
        else f(2, [9]);`),
    );
    const { value } = await consumer(
      `let second;
       ${AT_CHANNEL_END("second = settle(runCode('second'));")}
       const first = await settle(runCode('first'));
       out({ first, second: await second });`,
      { entry: pathToFileURL(entry).href },
    );
    expect(value).toEqual({
      first: {
        rejected: 'isolate-host child exited unexpectedly (code null, signal SIGKILL)',
        code: 'ERR_ISOLATE_HOST_WORKER_LOST',
      },
      second: { stdout: '', stderr: '', exitCode: 9 },
    });
  });

  it('a worker whose result channel ended is not idle: a healthy warm worker survives it', async () => {
    // Worker A holds 4 calls, B 1. A answers its 4 and ends its channel; at that end B
    // answers. B going idle must not count A as a second idle worker and end itself.
    const marker = (name: string) => JSON.stringify(join(work, `idle-${name}`));
    const entry = hostilePackage(
      'idle after channel end',
      `const calls = [];
       process.on('SIGUSR1', () => { for (const c of calls) { C = id(c); f(2, [0]); } closeSync(3); });
       ${ANSWER(`if (r.code === 'bad') { calls.push(r.call); if (calls.length === 4) writeFileSync(${marker('bad')}, String(process.pid)); }
         else if (r.code === 'healthy') {
           process.on('SIGUSR2', () => { C = id(r.call); f(2, [0]); writeFileSync(${marker('sent')}, ''); });
           writeFileSync(${marker('healthy')}, String(process.pid));
         } else { writeFileSync(${marker('next')}, String(process.pid)); f(2, [0]); }`)}`,
    );
    const { value } = await consumer(
      `const { existsSync } = await import('node:fs');
       const pid = (m) => Number(readFileSync(m, 'utf8'));
       const calls = [...Array.from({ length: 4 }, () => settle(runCode('bad'))), settle(runCode('healthy'))];
       await waitFor(() => (existsSync(${marker('bad')}) && existsSync(${marker('healthy')}) ? true : undefined), 20000);
       const healthy = pid(${marker('healthy')});
       ${AT_CHANNEL_END(`process.kill(healthy, 'SIGUSR2');
         const end = Date.now() + 10000;
         while (!existsSync(${marker('sent')})) if (Date.now() > end) throw new Error('no frame');`)}
       process.kill(pid(${marker('bad')}), 'SIGUSR1');
       const results = await Promise.all(calls);
       const next = await settle(runCode('next'));
       out({ results, next, servedBy: pid(${marker('next')}) === healthy ? 'healthy' : 'another' });`,
      { entry: pathToFileURL(entry).href },
    );
    const ok = { stdout: '', stderr: '', exitCode: 0 };
    expect(value).toEqual({ results: [ok, ok, ok, ok, ok], next: ok, servedBy: 'healthy' });
  });

  it('a starved consumer: a result sent before the deadline but read after it is timeout (declared, compat ⚠️)', () => {
    // From the call on the consumer does not run until the child has written its exit
    // frame and the deadline is due; the frame waits unread. Node has no such deadline:
    // the honest outcome is the result; today it is `timeout`.
    const marker = join(work, 'exit-frame-written');
    const entry = hostilePackage(
      'result before a starved deadline',
      `f(2, [5]); writeFileSync(${JSON.stringify(marker)}, '')`,
    );
    const report = consume(
      entry,
      '{ timeoutMs: 1500, maxOutputBytes: 1024 }',
      [],
      `const { existsSync } = await import('node:fs');
       queueMicrotask(() => {
         const due = performance.now() + 1500;
         const end = Date.now() + 10000;
         while (!existsSync(${JSON.stringify(marker)})) if (Date.now() > end) throw new Error('no frame');
         while (performance.now() < due + 5);
       });`,
    ) as { resolved?: unknown };
    expect(report.resolved).toEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      termination: 'timeout',
    });
  });

  it('a starved consumer: a worker lost before the deadline but read after it is timeout, no rerun (declared, compat ⚠️)', () => {
    // The child dies at once (channel and exit together); the consumer does not run
    // until it is a zombie and the deadline is due. The honest outcome is a lost worker
    // and its rerun; today the deadline is read first.
    const entry = hostilePackage(
      'lost before a starved deadline',
      "process.kill(process.pid, 'SIGKILL')",
    );
    const report = consume(
      entry,
      '{ timeoutMs: 1500, maxOutputBytes: 1024 }',
      [],
      `const { execFileSync } = await import('node:child_process');
       const zombie = () => execFileSync('ps', ['-A', '-o', 'ppid=,stat='], { encoding: 'utf8' })
         .split('\\n').some((l) => { const [ppid, stat] = l.trim().split(/\\s+/); return Number(ppid) === process.pid && stat?.startsWith('Z'); });
       queueMicrotask(() => {
         const due = performance.now() + 1500;
         const end = Date.now() + 10000;
         while (!zombie()) if (Date.now() > end) throw new Error('no exit');
         while (performance.now() < due + 5);
       });`,
    ) as { resolved?: unknown };
    expect(report.resolved).toEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      termination: 'timeout',
    });
  });

  it('a channel closed without a result is its own outcome, not the deadline', () => {
    // The child closes fd 3 and lives on; the call must not wait for timeoutMs.
    const entry = hostilePackage('channel closed', 'closeSync(3)');
    const started = Date.now();
    const report = consume(entry, '{ timeoutMs: 20000, maxOutputBytes: 1024 }') as {
      rejected?: string;
      ms?: number;
    };
    // A lost worker (ADR-0563 §6): named by its exit, which the consumer forced.
    expect(report.rejected).toBe(
      'isolate-host child exited unexpectedly (code null, signal SIGKILL) after closing its result channel without a result',
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(report.ms).toBeLessThan(1000);
  });
});

describe('FrameReader framing is independent of how the bytes are chunked', () => {
  // Deterministic, unlike a pipe: every split point and one byte at a time.
  const max = (kind: number, call: number): number | string =>
    call !== 7
      ? `call ${call}`
      : kind === KIND.output
        ? 16
        : kind === KIND.exit
          ? 1
          : `kind ${kind}`;
  const stream = Uint8Array.from([
    ...frame(KIND.output, 7, Uint8Array.of(1, 0, 0x61, 0x62)),
    ...frame(KIND.output, 7, Uint8Array.of(2, 0, 0x63)),
    ...frame(KIND.exit, 7, Uint8Array.of(3)),
  ]);
  const feed = (chunks: Uint8Array[]) => {
    const reader = new FrameReader(max);
    const frames: [number, number, number[]][] = [];
    const violations: string[] = [];
    for (const chunk of chunks) {
      const bad = reader.push(chunk, (kind, call, payload) => {
        frames.push([kind, call, [...payload]]);
        return undefined;
      });
      if (bad !== null) violations.push(bad);
    }
    return { frames, violations };
  };
  const whole = feed([stream]);

  it('parses the stream whole', () => {
    expect(whole).toEqual({
      frames: [
        [KIND.output, 7, [1, 0, 0x61, 0x62]],
        [KIND.output, 7, [2, 0, 0x63]],
        [KIND.exit, 7, [3]],
      ],
      violations: [],
    });
  });

  it('gives the same frames at every split point', () => {
    for (let at = 1; at < stream.byteLength; at++) {
      expect({ at, ...feed([stream.slice(0, at), stream.slice(at)]) }).toEqual({ at, ...whole });
    }
  });

  it('gives the same frames one byte at a time', () => {
    expect(feed([...stream].map((b) => Uint8Array.of(b)))).toEqual(whole);
  });

  it('refuses an over-long header however it is split, before its payload arrives', () => {
    const hostile = frame(KIND.exit, 7, Uint8Array.of(0, 0));
    for (let at = 1; at < HEADER; at++) {
      expect({ at, ...feed([hostile.slice(0, at), hostile.slice(at, HEADER)]) }).toEqual({
        at,
        frames: [],
        violations: ['frame length 2 > 1'],
      });
    }
  });

  it('refuses a frame for a call the judge does not know, before its payload arrives', () => {
    const hostile = frame(KIND.exit, 8, Uint8Array.of(0));
    expect(feed([hostile.slice(0, HEADER)])).toEqual({ frames: [], violations: ['call 8'] });
  });
});
