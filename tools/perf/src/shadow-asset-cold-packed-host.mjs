import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const READY_PREFIX = 'RIFTY_SHADOW_ASSET_COLD_HOST=';
const START_TIMEOUT_MS = 600_000;
const STOP_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1024 * 1024;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

/** Build and hold the controller item's tarball-installed external host. */
export async function startPackedShadowAssetColdHost({ repoRoot, env }) {
  const runner = resolve(repoRoot, 'tests/integration/workbench-packed-consumer.mjs');
  const child = spawn(process.execPath, [runner, '--serve-shadow-asset-cold'], {
    cwd: repoRoot,
    env: { ...env, CI: '1', COREPACK_ENABLE_NETWORK: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let lineBuffer = '';
  let exited = false;
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
    exited = true;
    rejectReady(error);
    resolveExit({ error });
  });
  child.on('close', (code, signal) => {
    exited = true;
    rejectReady(
      new Error(
        `packed cold host exited before readiness (code ${String(code)}, signal ${String(signal)})\n${output}`,
      ),
    );
    resolveExit({ code, signal });
  });

  const timeout = delay(START_TIMEOUT_MS).then(() => {
    throw new Error(
      `packed cold host did not become ready within ${START_TIMEOUT_MS}ms\n${output}`,
    );
  });
  let origin;
  try {
    origin = await Promise.race([ready, timeout]);
  } catch (error) {
    if (!exited) child.kill('SIGTERM');
    await Promise.race([exit, delay(STOP_TIMEOUT_MS)]);
    if (!exited) child.kill('SIGKILL');
    throw error;
  }

  let stopped = false;
  return {
    origin,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (!exited) child.kill('SIGTERM');
      await Promise.race([exit, delay(STOP_TIMEOUT_MS)]);
      if (!exited) {
        child.kill('SIGKILL');
        await exit;
      }
    },
  };
}
