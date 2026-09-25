/**
 * Node's `worker.stdout` / `worker.stderr` for a kernel-backed Worker (ADR-0449
 * §1): Worker-owned Readables fed by the kernel worker's output streams, piped
 * into the owner's process streams unless `stdout: true` / `stderr: true`.
 */

import { NotImplementedError, Readable } from '@riftydev/io';

type Listener = (chunk: unknown) => void;

interface OutputSource {
  on(event: 'data', listener: Listener): unknown;
  off(event: 'data', listener: Listener): unknown;
}

type OwnerStream = Parameters<Readable['pipe']>[0];

/** Node's `pipeWithoutWarning`: one pipe per Worker never trips the listener cap. */
function pipeWithoutWarning(source: Readable, dest: unknown, name: string): void {
  const target = dest as OwnerStream | undefined;
  if (typeof target?.write !== 'function') {
    throw new NotImplementedError(
      'worker_threads.Worker.stdio',
      `the owner process has no writable ${name} to receive the worker's output`,
    );
  }
  if (typeof target.on !== 'function') {
    // A same-realm child's process streams are write-only sinks: forward.
    source.on('data', (chunk: unknown) => target.write(chunk));
    return;
  }
  const cap = target as unknown as { _maxListeners?: number };
  const previous = cap._maxListeners;
  target.setMaxListeners(Number.POSITIVE_INFINITY);
  // Node skips `end()` for process stdio: the owner stream outlives the Worker.
  source.pipe(target, { end: false });
  cap._maxListeners = previous;
}

export class WorkerStdio {
  readonly stdout: Readable = new Readable({ read() {} });
  readonly stderr: Readable = new Readable({ read() {} });
  readonly #detach: (() => void)[] = [];
  #ended = false;

  constructor(
    owner: { readonly stdout?: unknown; readonly stderr?: unknown } | undefined,
    capture: { readonly stdout: boolean; readonly stderr: boolean },
  ) {
    if (!capture.stdout) pipeWithoutWarning(this.stdout, owner?.stdout, 'stdout');
    if (!capture.stderr) pipeWithoutWarning(this.stderr, owner?.stderr, 'stderr');
  }

  /** Feed from the kernel worker's output; the kernel drains it before its 'exit'. */
  attach(stdout: OutputSource, stderr: OutputSource): void {
    for (const [source, stream] of [
      [stdout, this.stdout],
      [stderr, this.stderr],
    ] as const) {
      const onData: Listener = (chunk) => {
        stream.push(chunk);
      };
      source.on('data', onData);
      this.#detach.push(() => source.off('data', onData));
    }
  }

  /** Node's `[kDispose]`: end both streams right before 'exit', so 'end' follows it. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const detach of this.#detach.splice(0)) detach();
    this.stdout.push(null);
    this.stderr.push(null);
  }
}
