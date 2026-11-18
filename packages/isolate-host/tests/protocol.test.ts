/**
 * A child compromised by an isolate escape is hostile (ADR-0557 §2): the
 * consumer treats every IPC message as untrusted. Each case runs the real
 * built `runCode` from a copy of the package whose `dist/child.js` is a real
 * hostile Node process; the consumer must kill it and reject with a distinct
 * protocol error — never throw inside its listener, never hang (I4).
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

/** Messages the hostile child sends after `ready` and the run request (JS source of an array). */
const HOSTILE: Readonly<Record<string, string>> = {
  // Every output fixture is well-formed but for the one field it names (truncated: false set).
  'output chunk not bytes':
    "[{ type: 'output', chunks: [[1, { byteLength: 5, x: 1 }]], truncated: false }]",
  'output fd 3': "[{ type: 'output', chunks: [[3, new Uint8Array(1)]], truncated: false }]",
  'output not an array': "[{ type: 'output', chunks: 'x', truncated: false }]",
  'output past the cap':
    "[{ type: 'output', chunks: [[1, new Uint8Array(4096)]], truncated: false }]",
  'output three chunks':
    "[{ type: 'output', chunks: [[1, new Uint8Array(1)], [2, new Uint8Array(1)], [1, new Uint8Array(1)]], truncated: false }]",
  'output without truncated flag': "[{ type: 'output', chunks: [[1, new Uint8Array(1)]] }]",
  'empty output chunk':
    "[{ type: 'output', chunks: [[1, new Uint8Array(1)], [2, new Uint8Array(0)]], truncated: false }]",
  'output with no new bytes': "[{ type: 'output', chunks: [], truncated: false }]",
  'repeated ready': "[{ type: 'ready' }]",
  'output with an extra key (padding)':
    "[{ type: 'output', chunks: [[1, new Uint8Array([65])]], truncated: false, pad: 'x'.repeat(1 << 20) }]",
  'exit with an extra key': "[{ type: 'exit', exitCode: 0, truncated: false, extra: 1 }]",
  'exit code string': "[{ type: 'exit', exitCode: 'pwn', truncated: false }]",
  'exit code fraction': "[{ type: 'exit', exitCode: 1.5, truncated: false }]",
  'exit code out of range': "[{ type: 'exit', exitCode: 300, truncated: false }]",
  'unknown type': "[{ type: 'bogus' }]",
  'not an object': "['hello']",
  'null message': '[null]',
};

function hostilePackage(label: string, messages: string): string {
  const dir = join(work, label.replace(/\W+/g, '-'));
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'child.js'),
    `process.once('message', () => { for (const m of ${messages}) process.send(m); setInterval(() => {}, 1000); });
     process.send({ type: 'ready' });`,
  );
  return join(dir, 'dist', 'index.js');
}

describe('consumer treats child IPC as hostile', () => {
  for (const [label, messages] of Object.entries(HOSTILE)) {
    it(label, () => {
      const entry = hostilePackage(label, messages);
      // A separate consumer process: a listener throw would crash it, a hang would time out.
      const script = `const { runCode } = await import(${JSON.stringify(new URL(`file://${entry}`).href)});
        const t = Date.now();
        process.on('uncaughtException', (e) => { console.log(JSON.stringify({ uncaught: e.message })); process.exit(0); });
        runCode('1', { timeoutMs: 5000, maxOutputBytes: 1024 }).then(
          (r) => console.log(JSON.stringify({ resolved: r })),
          (e) => console.log(JSON.stringify({ rejected: e.message, ms: Date.now() - t })),
        );`;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        timeout: 15_000,
      });
      const report = JSON.parse(out) as { rejected?: string; ms?: number };
      expect(report.rejected).toMatch(/^isolate-host child protocol violation: /);
      expect(report.ms).toBeLessThan(1000);
    });
  }
});
