/**
 * `new Worker(file, options)` startup options, decided at construction before
 * any thread id or hold exists (ADR-0449 §1–§3, §6).
 */

import { NotImplementedError } from '@riftydev/io';
import { getKernelWorkerUrl, isSabIpcSupported } from '@riftydev/kernel';
import { invalidArgType } from '../internal/node-received.ts';
import { compileNodeStartupOptions } from '../internal/node-startup-options.ts';
import { readNodeEntryBootstrapIfPresent } from './node-entry-runtime-config.ts';
import { getNodeEntryWorkerUrl } from './node-entry-url.ts';

export interface WorkerLaunchOptions {
  readonly execArgv?: unknown;
  readonly stdin?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

export interface WorkerLaunch {
  /** A real kernel Worker realm; otherwise the same-realm fallback. */
  readonly kernelBacked: boolean;
  /** The worker's exact `process.execArgv`. */
  readonly execArgv: readonly string[];
  readonly capture: { readonly stdout: boolean; readonly stderr: boolean };
}

export function resolveWorkerLaunch(options: WorkerLaunchOptions): WorkerLaunch {
  const explicit = options.execArgv;
  if (explicit && !Array.isArray(explicit)) {
    throw invalidArgType('"options.execArgv" property', 'an instance of Array', explicit);
  }
  // Falsy inherits the parent thread's launch tokens, never its public array.
  // TODO(backlog: runtime-js/worker-threads-inherited-exec-argv): an eval
  // parent's `-e <source>` stays the named throw.
  const tokens = explicit || (readNodeEntryBootstrapIfPresent()?.launch.execArgv ?? []);
  const { execArgv } = compileNodeStartupOptions(tokens, 'worker_threads.Worker');
  if (options.stdin) {
    throw new NotImplementedError(
      'worker_threads.Worker.stdin',
      'a parent-to-worker stdin stream is not carried',
    );
  }
  const kernelBacked =
    isSabIpcSupported() && getKernelWorkerUrl() !== null && getNodeEntryWorkerUrl() !== null;
  if (!kernelBacked && execArgv.length > 0) {
    throw new NotImplementedError(
      'worker_threads.Worker.execArgv.same-realm',
      'a same-realm Worker runs in its parent realm and cannot start with its own options',
    );
  }
  if (!kernelBacked && (options.stdout || options.stderr)) throw sameRealmStdio();
  return {
    kernelBacked,
    execArgv,
    capture: { stdout: Boolean(options.stdout), stderr: Boolean(options.stderr) },
  };
}

/** A same-realm Worker's output already shares the parent's process streams. */
export function sameRealmStdio(): NotImplementedError {
  return new NotImplementedError(
    'worker_threads.Worker.stdio.same-realm',
    "a same-realm Worker's output shares the parent streams",
  );
}
