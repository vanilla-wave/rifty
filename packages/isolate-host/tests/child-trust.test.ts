/**
 * The child does not trust the isolate (ADR-0557 §6). The guest realm is the
 * guest's, so the status crosses as ONE PRIMITIVE and the CHILD validates it: a
 * guest bundle that returns garbage, rejects, or throws must become a failed
 * run (exit 1) with no host text in stderr — never a forged clean run, never a
 * rejection of `runCode` as an infrastructure failure (I3, I4).
 *
 * Each case runs the real built `runCode` over a copy of the package whose
 * `dist/guest.js` is a stub, so it tests the child's own judgement rather than
 * the real guest's goodwill.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-guest-stub-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** `run` bodies for the stub guest; each is evaluated inside the isolate. */
const STUBS: Readonly<Record<string, string>> = {
  'status not a number': "() => 'pwn'",
  'status out of range': '() => 256',
  'status negative': '() => -1',
  'status fractional': '() => 1.5',
  // Both coerce to a clean 0 in a Uint8 frame if the integer check is gone.
  'status fractional below 1': '() => 0.5',
  'status NaN': '() => Number.NaN',
  'status not finite': '() => Number.POSITIVE_INFINITY',
  'no status at all': '() => undefined',
  'null instead of a status': '() => null',
  'an object instead of the primitive': '() => ({ code: 0 })',
  'a thenable instead of the primitive': '() => ({ then: (resolve) => resolve(0) })',
  'a rejected promise': "() => Promise.reject(new Error('pwn'))",
  'a throw': "() => { throw new Error('pwn') }",
  'never settles': '() => new Promise(() => {})',
};

function stubPackage(label: string, run: string): string {
  const dir = join(work, label.replace(/\W+/g, '-'));
  cpSync(join(PACKAGE_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(PACKAGE_DIR, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'dist', 'guest.js'),
    `Object.defineProperty(globalThis, '__riftyGuest', {
       value: Object.freeze({ run: ${run}, fire() {}, rejection() {} }),
       configurable: true,
     });`,
  );
  return join(dir, 'dist', 'index.js');
}

function consume(entry: string): { resolved?: Record<string, unknown>; rejected?: string } {
  const script = `const { runCode } = await import(${JSON.stringify(new URL(`file://${entry}`).href)});
    process.on('uncaughtException', (e) => { console.log(JSON.stringify({ uncaught: e.message })); process.exit(0) });
    runCode('console.log(1)', { timeoutMs: 2000 }).then(
      (r) => console.log(JSON.stringify({ resolved: r })),
      (e) => console.log(JSON.stringify({ rejected: e.message })),
    );`;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 20_000,
    }),
  );
}

describe('the child judges what the isolate hands it', () => {
  for (const [label, run] of Object.entries(STUBS)) {
    it(label, () => {
      const report = consume(stubPackage(label, run));
      expect(report.rejected).toBeUndefined();
      if (label === 'never settles') {
        // Nothing to judge: the deadline owns it, with a distinct termination.
        expect(report.resolved).toEqual({
          stdout: '',
          stderr: '',
          exitCode: null,
          termination: 'timeout',
        });
        return;
      }
      expect(report.resolved).toEqual({
        stdout: '',
        // stderr stays the program's own bytes: the child adds no line.
        stderr: '',
        exitCode: 1,
      });
    }, 30_000);
  }

  it("a status the child accepts is the run's, so the stubs above are judged, not ignored", () => {
    const report = consume(stubPackage('an accepted status', '() => 7'));
    expect(report.resolved).toEqual({ stdout: '', stderr: '', exitCode: 7 });
  }, 30_000);

  it("a guest bundle with no entry at all is the child's own failure, not a clean run", () => {
    const entry = stubPackage('no guest entry', '() => 0');
    writeFileSync(join(entry, '..', 'guest.js'), '/* nothing is published */');
    const report = consume(entry);
    expect(report.resolved).toBeUndefined();
    expect(report.rejected).toMatch(/^isolate-host child failed: /);
  }, 30_000);
});
