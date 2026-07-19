import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const READY_PREFIX = 'RIFTY_SHADOW_ASSET_COLD_HOST=';
const START_TIMEOUT_MS = 600_000;
const STOP_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1024 * 1024;
const WAIT_TIMEOUT = Symbol('packed cold host wait timeout');

async function waitWithin(promise, milliseconds) {
  let timeout;
  const timed = new Promise((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout(WAIT_TIMEOUT), milliseconds);
  });
  try {
    return await Promise.race([promise, timed]);
  } finally {
    clearTimeout(timeout);
  }
}

function positiveTimeout(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return next.length <= MAX_OUTPUT ? next : next.slice(-MAX_OUTPUT);
}

export function hostOriginFromLine(line) {
  if (!line.startsWith(READY_PREFIX)) return null;
  let value;
  try {
    value = JSON.parse(line.slice(READY_PREFIX.length));
  } catch (error) {
    throw new Error('packed cold host emitted malformed readiness JSON', { cause: error });
  }
  if (value === null || typeof value !== 'object' || typeof value.origin !== 'string') {
    throw new Error('packed cold host readiness omitted origin');
  }
  const origin = new URL(value.origin);
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('packed cold host readiness origin is not http(s)');
  }
  return origin.origin;
}

function exitDescription(result) {
  return `code ${String(result.code)}, signal ${String(result.signal)}`;
}

function unexpectedExit(result, output, boundary) {
  return new Error(
    `packed cold host ${boundary} (${exitDescription(result)})\n${output}`,
    result.error === undefined ? undefined : { cause: result.error },
  );
}

function signalHostProcess(child, signal) {
  if (signal !== 'SIGKILL' || process.platform === 'win32' || child.pid === undefined) {
    return child.kill(signal);
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function assertExpectedStopExit(result, output, forced) {
  if (result.error !== undefined) {
    throw unexpectedExit(result, output, 'failed during stop');
  }
  if (result.code === 0 && result.signal === null) return;
  if (result.code === null && result.signal === 'SIGTERM') return;
  if (forced && result.code === null && result.signal === 'SIGKILL') return;
  throw unexpectedExit(result, output, 'exited unexpectedly during stop');
}

/** Build and hold the controller item's tarball-installed external host. */
export async function startPackedShadowAssetColdHost({
  repoRoot,
  env,
  startTimeoutMs = START_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
  killTimeoutMs = KILL_TIMEOUT_MS,
}) {
  positiveTimeout(startTimeoutMs, 'startTimeoutMs');
  positiveTimeout(stopTimeoutMs, 'stopTimeoutMs');
  positiveTimeout(killTimeoutMs, 'killTimeoutMs');
  const runner = resolve(repoRoot, 'tests/integration/workbench-packed-consumer.mjs');
  const child = spawn(process.execPath, [runner, '--serve-shadow-asset-cold'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: { ...env, CI: '1', COREPACK_ENABLE_NETWORK: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let lineBuffer = '';
  let closed = false;
  let spawnError;
  let resolveExit;
  const exit = new Promise((resolvePromise) => {
    resolveExit = resolvePromise;
  });
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });

  const consumeStdout = (chunk) => {
    const text = String(chunk);
    output = appendBounded(output, text);
    process.stdout.write(text);
    lineBuffer += text;
    for (;;) {
      const newline = lineBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = lineBuffer.slice(0, newline).trim();
      lineBuffer = lineBuffer.slice(newline + 1);
      try {
        const origin = hostOriginFromLine(line);
        if (origin !== null) resolveReady(origin);
      } catch (error) {
        rejectReady(error);
      }
    }
  };
  child.stdout.on('data', consumeStdout);
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    output = appendBounded(output, text);
    process.stderr.write(text);
  });
  child.on('error', (error) => {
    spawnError = error;
    rejectReady(new Error('packed cold host process failed', { cause: error }));
  });
  child.on('close', (code, signal) => {
    closed = true;
    const result = { code, signal, error: spawnError };
    rejectReady(unexpectedExit(result, output, 'exited before readiness'));
    resolveExit(result);
  });

  const terminate = async ({ acceptExistingExit }) => {
    if (closed) {
      const result = await exit;
      if (acceptExistingExit) return;
      throw unexpectedExit(result, output, 'exited outside the stop boundary');
    }

    const termDelivered = signalHostProcess(child, 'SIGTERM');
    if (!termDelivered) {
      const result = await waitWithin(exit, stopTimeoutMs);
      if (result === WAIT_TIMEOUT) {
        throw new Error(`packed cold host rejected SIGTERM and did not exit\n${output}`);
      }
      if (acceptExistingExit) return;
      throw unexpectedExit(result, output, 'exited before SIGTERM delivery');
    }

    const gracefulResult = await waitWithin(exit, stopTimeoutMs);
    if (gracefulResult !== WAIT_TIMEOUT) {
      if (!acceptExistingExit) assertExpectedStopExit(gracefulResult, output, false);
      return;
    }

    const killDelivered = signalHostProcess(child, 'SIGKILL');
    const forcedResult = await waitWithin(exit, killTimeoutMs);
    if (forcedResult === WAIT_TIMEOUT) {
      const delivery = killDelivered ? 'accepted' : 'rejected';
      throw new Error(
        `packed cold host ${delivery} SIGKILL but did not exit within ${killTimeoutMs}ms\n${output}`,
      );
    }
    if (!acceptExistingExit) assertExpectedStopExit(forcedResult, output, killDelivered);
  };

  let origin;
  try {
    const readyResult = await waitWithin(ready, startTimeoutMs);
    if (readyResult === WAIT_TIMEOUT) {
      throw new Error(
        `packed cold host did not become ready within ${startTimeoutMs}ms\n${output}`,
      );
    }
    origin = readyResult;
  } catch (error) {
    try {
      await terminate({ acceptExistingExit: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'packed cold host start failed and teardown did not complete',
      );
    }
    throw error;
  }

  let stopPromise;
  return {
    origin,
    stop() {
      stopPromise ??= terminate({ acceptExistingExit: false });
      return stopPromise;
    },
  };
}
