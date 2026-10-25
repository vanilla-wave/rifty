import { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runRuntimeSmokeChild } from '../../packages/runtime-js/src/internal/runtime-smoke-child.test-helper.ts';

const fixture = fileURLToPath(new URL('./fixtures/runtime-smoke-child-fault.ts', import.meta.url));
const marker = 'RIFTY_RUNTIME_SMOKE_CHILD_OK';

function run(mode: string, timeoutMs = 5_000): Promise<string> {
  return runRuntimeSmokeChild({
    fixture,
    marker,
    timeoutMs,
    env: { RIFTY_SMOKE_CHILD_FAULT: mode },
  });
}

async function expectTimedOutAndGone(mode: string, diagnostic: RegExp): Promise<void> {
  let failure: unknown;
  try {
    await run(mode, 500);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toMatch(/timed out after 500ms/i);
  expect(message).toMatch(diagnostic);
  const pid = Number(/(?:TIMEOUT|MARKER_LEAK)_PID:(\d+)/.exec(message)?.[1]);
  expect(Number.isInteger(pid)).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (processIsAlive(pid)) {
    if (Date.now() >= deadline) {
      process.kill(pid, 'SIGKILL');
      throw new Error(`runtime smoke fault child ${pid} survived cleanup`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('runtime-global smoke child boundary', () => {
  it('returns captured output only after a zero exit and exact marker', async () => {
    await expect(run('success')).resolves.toContain(marker);
  });

  it('rejects a zero exit that never published the exact marker', async () => {
    await expect(run('missing-marker')).rejects.toThrow(/missing.*RIFTY_RUNTIME_SMOKE_CHILD_OK/i);
  });

  it('does not accept the marker as a substring of another line', async () => {
    await expect(run('marker-substring')).rejects.toThrow(/missing.*RIFTY_RUNTIME_SMOKE_CHILD_OK/i);
  });

  it('does not synthesize an exact marker across stdout and stderr', async () => {
    await expect(run('cross-stream-marker')).rejects.toThrow(
      /missing.*RIFTY_RUNTIME_SMOKE_CHILD_OK/i,
    );
  });

  it('retains an exact terminal stdout marker after bounded preceding output', async () => {
    await expect(run('large-output-marker')).resolves.toMatch(/RIFTY_RUNTIME_SMOKE_CHILD_OK/u);
  });

  it('retains terminal failure diagnostics after bounded preceding output', async () => {
    await expect(run('large-output-nonzero')).rejects.toThrow(
      /exit.*7.*terminal failure after bounded output/is,
    );
  });

  it('preserves a nonzero child exit and its diagnostics', async () => {
    await expect(run('nonzero')).rejects.toThrow(/exit.*7.*child primary failure/is);
  });

  it('a nonzero exit outranks an exact marker', async () => {
    await expect(run('marker-nonzero')).rejects.toThrow(/exit.*7.*child failed after marker/is);
  });

  it('bounds a silent child and reports the configured timeout', async () => {
    await expectTimedOutAndGone('timeout', /TIMEOUT_PID:/);
  });

  it('timeout remains primary when termination produces a later exit 7', async () => {
    await expectTimedOutAndGone('timeout-exit', /late exit 7 after timeout/);
  });

  it('uses SIGKILL after the child ignores SIGTERM and rejects only after exit', async () => {
    await expectTimedOutAndGone('timeout-ignore-term', /ignored SIGTERM; waiting for SIGKILL/);
  });

  it('keeps timeout primary and waits for exit after a timeout-phase kill error', async () => {
    const nativeKill = ChildProcess.prototype.kill;
    let injected = false;
    ChildProcess.prototype.kill = function (signal): boolean {
      const result = nativeKill.call(this, signal);
      if (!injected && signal === 'SIGTERM') {
        injected = true;
        this.emit('error', new Error('injected timeout kill error'));
      }
      return result;
    };
    let failure: unknown;
    let pid = Number.NaN;
    let aliveAtRejection = false;
    try {
      try {
        await run('timeout-ignore-term', 500);
      } catch (error) {
        failure = error;
      }
      const message = failure instanceof Error ? failure.message : '';
      pid = Number(/TIMEOUT_PID:(\d+)/u.exec(message)?.[1]);
      aliveAtRejection = Number.isInteger(pid) && processIsAlive(pid);
      if (Number.isInteger(pid)) await waitForProcessExit(pid);
    } finally {
      ChildProcess.prototype.kill = nativeKill;
      if (Number.isInteger(pid) && processIsAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/timed out after 500ms/i);
    expect((failure as Error).message).toMatch(/injected timeout kill error/i);
    expect(aliveAtRejection).toBe(false);
  });

  it('rejects a child terminated by a signal', async () => {
    await expect(run('signal')).rejects.toThrow(/signal.*SIGTERM/i);
  });

  it('does not accept a marker published before child-owned handles close', async () => {
    await expectTimedOutAndGone('marker-before-close', /RIFTY_RUNTIME_SMOKE_CHILD_OK/);
  });
});
