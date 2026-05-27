import { afterEach, describe, expect, it } from 'vitest';
import {
  exec,
  execSync,
  fork,
  spawn,
} from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

describe('child_process.spawn', () => {
  it('runs a script and streams stdout', async () => {
    writeFileSync('/hello.js', "__stdout_write('hi from child\\n');");
    const child = spawn('node', ['/hello.js']);
    let out = '';
    child.stdout.on('data', (c) => {
      out += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(out).toBe('hi from child\n');
    expect(code).toBe(0);
  });

  it('exit code 1 on thrown error', async () => {
    writeFileSync('/bad.js', "throw new Error('boom');");
    const child = spawn('node', ['/bad.js']);
    let err = '';
    child.stderr.on('data', (c) => {
      err += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(1);
    expect(err).toContain('boom');
  });

  it('spawn with unknown command emits ENOENT-like stderr + exit 127', async () => {
    const child = spawn('not-a-command');
    let err = '';
    child.stderr.on('data', (c) => {
      err += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', (c) => resolve(c as number | null)),
    );
    expect(code).toBe(127);
    expect(err).toMatch(/ENOENT/);
  });
});

describe('child_process.exec', () => {
  it('buffers stdout/stderr into callback', async () => {
    writeFileSync('/say.js', "__stdout_write('ok');");
    await new Promise<void>((resolve, reject) => {
      exec('node /say.js', (err, stdout, stderr) => {
        if (err) reject(err);
        try {
          expect(stdout).toBe('ok');
          expect(stderr).toBe('');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});

describe('child_process.fork', () => {
  it('returns a ChildProcess (IPC API present)', () => {
    writeFileSync('/c.js', "__stdout_write('forked');");
    const child = fork('/c.js');
    expect(typeof child.send).toBe('function');
    expect(typeof child.kill).toBe('function');
  });
});

describe('child_process.execSync', () => {
  // Post 2026-05-27 audit item #2: the in-realm `new Function(...)` fallback
  // was a silent stub (no exit code, no stdio isolation, no PID) and violated
  // CLAUDE.md "no silent stubs". Outside a SAB-capable kernel Worker the
  // function now throws `NotImplementedError`; the SAB happy path is exercised
  // separately in `exec-sync-worker.test.ts` (gated on `crossOriginIsolated`
  // + `getKernelWorkerUrl()`).
  it('throws NotImplementedError when SAB IPC is unavailable', () => {
    writeFileSync('/sync.js', "__stdout_write('sync');");
    expect(() => execSync('node /sync.js')).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execSync',
      }) as unknown as Error,
    );
  });
});

describe('ChildProcess.stdin', () => {
  it('write() throws NotImplementedError instead of silently no-op-ing', () => {
    writeFileSync('/silent.js', '');
    const child = spawn('node', ['/silent.js']);
    expect(() => child.stdin.write('x')).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child.stdin.write',
      }) as unknown as Error,
    );
  });
  it('end() throws NotImplementedError', () => {
    writeFileSync('/silent2.js', '');
    const child = spawn('node', ['/silent2.js']);
    expect(() => child.stdin.end()).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child.stdin.end',
      }) as unknown as Error,
    );
  });
});
