import { spawn } from 'node:child_process';

export interface RuntimeSmokeChildOptions {
  readonly fixture: string;
  readonly marker: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
}

const STREAM_OUTPUT_LIMIT = 524_288;
const STREAM_OUTPUT_EDGE = STREAM_OUTPUT_LIMIT / 2;
const FORCE_KILL_GRACE_MS = 2_000;

interface CapturedStream {
  head: string;
  tail: string;
  total: number;
  truncated: boolean;
}

interface ExactLineTracker {
  partial: string;
  tooLong: boolean;
  found: boolean;
}

function appendCaptured(captured: CapturedStream, text: string): void {
  captured.total += text.length;
  if (captured.truncated) {
    captured.tail = (captured.tail + text).slice(-STREAM_OUTPUT_EDGE);
    return;
  }
  const combined = captured.head + text;
  if (combined.length <= STREAM_OUTPUT_LIMIT) {
    captured.head = combined;
    return;
  }
  captured.head = combined.slice(0, STREAM_OUTPUT_EDGE);
  captured.tail = combined.slice(-STREAM_OUTPUT_EDGE);
  captured.truncated = true;
}

function renderCaptured(captured: CapturedStream): string {
  if (!captured.truncated) return captured.head;
  const omitted = captured.total - captured.head.length - captured.tail.length;
  return `${captured.head}\n...[${omitted} chars truncated]...\n${captured.tail}`;
}

function inspectExactLines(tracker: ExactLineTracker, text: string, marker: string): void {
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const end = newline === -1 ? text.length : newline;
    if (!tracker.tooLong) {
      const fragment = text.slice(offset, end);
      if (tracker.partial.length + fragment.length <= marker.length + 1) {
        tracker.partial += fragment;
      } else {
        tracker.partial = '';
        tracker.tooLong = true;
      }
    }
    if (newline === -1) return;
    if (!tracker.tooLong && tracker.partial.replace(/\r$/u, '') === marker) {
      tracker.found = true;
    }
    tracker.partial = '';
    tracker.tooLong = false;
    offset = newline + 1;
  }
}

function finishExactLines(tracker: ExactLineTracker, marker: string): void {
  if (!tracker.tooLong && tracker.partial.replace(/\r$/u, '') === marker) {
    tracker.found = true;
  }
}

function renderOutput(
  stdout: CapturedStream,
  stderr: CapturedStream,
  processErrors: readonly Error[],
): string {
  const sections: string[] = [];
  const stdoutText = renderCaptured(stdout);
  const stderrText = renderCaptured(stderr);
  if (stdoutText) sections.push(`[stdout]\n${stdoutText}`);
  if (stderrText) sections.push(`[stderr]\n${stderrText}`);
  if (processErrors.length > 0) {
    sections.push(
      `[child-process error]\n${processErrors.map((error) => error.stack ?? error.message).join('\n')}`,
    );
  }
  return sections.join('\n');
}

export function runRuntimeSmokeChild(options: RuntimeSmokeChildOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', options.fixture], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: CapturedStream = { head: '', tail: '', total: 0, truncated: false };
    const stderr: CapturedStream = { head: '', tail: '', total: 0, truncated: false };
    const marker: ExactLineTracker = { partial: '', tooLong: false, found: false };
    const processErrors: Error[] = [];
    let spawned = false;
    let timedOut = false;
    let settled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      appendCaptured(stdout, text);
      inspectExactLines(marker, text, options.marker);
    });
    child.stderr.on('data', (text: string) => {
      appendCaptured(stderr, text);
    });
    child.once('spawn', () => {
      spawned = true;
    });
    child.on('error', (error) => {
      processErrors.push(error);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (error) {
        processErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
      forceKill = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          processErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }, FORCE_KILL_GRACE_MS);
    }, options.timeoutMs);

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      finishExactLines(marker, options.marker);
      const output = renderOutput(stdout, stderr, processErrors);
      const diagnostics = output ? `\n${output}` : '';
      if (!spawned && processErrors.length > 0) {
        reject(
          new Error(
            `runtime smoke child failed to spawn: ${processErrors[0]?.message}${diagnostics}`,
          ),
        );
        return;
      }
      if (timedOut) {
        reject(
          new Error(`runtime smoke child timed out after ${options.timeoutMs}ms${diagnostics}`),
        );
        return;
      }
      if (signal !== null) {
        reject(new Error(`runtime smoke child terminated by signal ${signal}${diagnostics}`));
        return;
      }
      if (processErrors.length > 0) {
        reject(new Error(`runtime smoke child process error${diagnostics}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`runtime smoke child exited with code ${String(code)}${diagnostics}`));
        return;
      }
      if (!marker.found) {
        reject(
          new Error(`runtime smoke child missing exact marker ${options.marker}${diagnostics}`),
        );
        return;
      }
      resolve(output);
    });
  });
}
