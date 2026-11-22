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
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CHANNEL_END_GRACE_MS } from '../src/pool.ts';
import { FrameReader, HEADER, KIND, frame } from '../src/protocol.ts';

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
      (r) => console.log(JSON.stringify({ resolved: r, ms: Date.now() - t, held: globalThis.held })),
      (e) => console.log(JSON.stringify({ rejected: e.message, ms: Date.now() - t })),
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

  it('a result sent before the deadline wins over it, however late the consumer reads it', () => {
    // A preempted consumer: from the call on it does not run until the child has
    // written its exit frame and the deadline is due; the frame waits unread.
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
    expect(report.resolved).toEqual({ stdout: '', stderr: '', exitCode: 5 });
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
