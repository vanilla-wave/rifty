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
  'frame announcing 4 GiB': 'raw([0xff, 0xff, 0xff, 0xf0, 1])',
  'output announcing past the cap': 'raw([0, 0, 0x10, 0, 1])',
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
  'byte-by-byte garbage': 'for (const b of [0xff, 0xff, 0xff, 0xff, 1]) raw([b])',
};

function hostilePackage(label: string, body: string): string {
  const dir = join(work, label.replace(/\W+/g, '-'));
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `import { closeSync, writeSync } from 'node:fs';
     const raw = (bytes) => writeSync(3, Uint8Array.from(bytes));
     const f = (kind, payload) => {
       const b = Uint8Array.from(payload);
       const h = new Uint8Array(5); new DataView(h.buffer).setUint32(0, b.length); h[4] = kind;
       raw([...h, ...b]);
     };
     process.stdin.once('data', () => { ${body}; setInterval(() => {}, 1000); });`,
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
      'raw([0, 0, 0x04, 0x02, 1, 1, 0, ...new Array(998).fill(65)])',
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
      'for (const b of [0, 0, 0, 5, 1, 1, 0, 104, 105, 33]) raw([b]); for (const b of [0, 0, 0, 1, 2, 7]) raw([b])',
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

  it('a channel closed without a result is its own outcome, not the deadline', () => {
    // The child closes fd 3 and lives on; the call must not wait for timeoutMs.
    const entry = hostilePackage('channel closed', 'closeSync(3)');
    const started = Date.now();
    const report = consume(entry, '{ timeoutMs: 20000, maxOutputBytes: 1024 }') as {
      rejected?: string;
      ms?: number;
    };
    expect(report.rejected).toBe('isolate-host child closed its result channel without a result');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(report.ms).toBeLessThan(1000);
  });
});
