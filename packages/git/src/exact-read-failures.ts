/**
 * Exact-read-failure carrier (ADR-0357). isomorphic-git's `FileSystem.read`
 * collapses EVERY `readFile` rejection into `null` ("absent") and its `readdir`
 * collapses non-ENOTDIR rejections into `[]` ("empty") — a storage failure
 * (EIO/EACCES/EDQUOT) becomes false history, false status, or a parentless
 * commit. The carrier latches the first non-absence rejection observed during a
 * facade operation and rethrows it — even when isomorphic-git swallowed it and
 * "succeeded". While a failure is latched, mutating fs verbs fail-stop with it:
 * a swallowed read must never seed a write (e.g. an unreadable parent ref
 * becoming a parentless commit that moves the branch). Absence stays proven:
 * ENOENT/ENOTDIR/EISDIR are POSIX probe outcomes real git treats as "not
 * here", never storage failures.
 *
 * Operations on one carrier run SERIALIZED (per-instance FIFO): a latched
 * failure belongs to exactly the operation whose window observed it — never to
 * a concurrent sibling by timing. Distinct instances stay independent.
 */
import type { GitFs } from './fs-adapter.ts';

/** POSIX probe outcomes that encode semantic absence, not storage failure. */
const ABSENCE_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

function isAbsenceProbe(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ABSENCE_CODES.has(error.code)
  );
}

/** Probe catch handler: proven absence → false; a storage failure rethrows. */
export function absentOnProbe(error: unknown): false {
  if (isAbsenceProbe(error)) return false;
  throw error;
}

/** Out-of-band sentinel: `undefined`/`null` rejection VALUES keep identity. */
const NO_FAILURE = Symbol('no-failure');

interface OperationContext {
  failure: unknown;
}

export interface ExactReadFailureCarrier {
  readonly fs: GitFs;
  guard<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Wrap every method of a facade object in the carrier guard. Methods must be
 * closure-based (no `this`); the cast only erases the per-method signatures —
 * the surface is structurally identical.
 */
export function guardSurface<T extends object>(
  api: T,
  guard: <R>(operation: () => Promise<R>) => Promise<R>,
): T {
  const guarded: Partial<Record<keyof T, unknown>> = {};
  for (const key of Object.keys(api) as (keyof T)[]) {
    const method = api[key] as unknown as (...args: unknown[]) => Promise<unknown>;
    guarded[key] = (...args: unknown[]) => guard(() => method(...args));
  }
  return guarded as T;
}

export function carryExactReadFailures(base: GitFs): ExactReadFailureCarrier {
  // Single in-flight context — guard() serializes operations per instance.
  let current: OperationContext | null = null;
  // Latch into the window that ISSUED the read (snapshot at verb entry): a
  // rejection delivered late by an ABANDONED parallel read (Promise.all
  // sibling) must never poison the next operation's window. Latching into an
  // already-settled context is harmless — guard reads only its own context.
  const capture = (issuer: OperationContext | null, error: unknown): void => {
    if (isAbsenceProbe(error)) return;
    if (issuer !== null && issuer.failure === NO_FAILURE) issuer.failure = error;
  };
  const assertNoLatchedFailure = (): void => {
    if (current !== null && current.failure !== NO_FAILURE) throw current.failure;
  };
  const inner = base.promises;
  const fs: GitFs = {
    promises: {
      // Verb-by-verb delegation (never a spread): prototype-carried and
      // receiver-bound GitFs implementations stay valid.
      async readFile(p, opts) {
        const issuer = current;
        try {
          return await inner.readFile(p, opts);
        } catch (error) {
          // isomorphic-git probes `readFile()` with NO path at fs-capability
          // detection (per facade call); that rejection is the designed probe.
          if (p !== undefined) capture(issuer, error);
          throw error;
        }
      },
      async readdir(p) {
        const issuer = current;
        try {
          return await inner.readdir(p);
        } catch (error) {
          capture(issuer, error);
          throw error;
        }
      },
      // Write verbs fail-stop on a latched READ failure only; write-direction
      // swallows inside isomorphic-git and facade catch-alls are a separate
      // axis. TODO(backlog: shell/isogit-write-failure-swallows)
      async writeFile(p, data, opts) {
        assertNoLatchedFailure();
        await inner.writeFile(p, data, opts);
      },
      async unlink(p) {
        assertNoLatchedFailure();
        await inner.unlink(p);
      },
      async mkdir(p) {
        assertNoLatchedFailure();
        await inner.mkdir(p);
      },
      async rmdir(p) {
        assertNoLatchedFailure();
        await inner.rmdir(p);
      },
      stat: (p) => inner.stat(p),
      lstat: (p) => inner.lstat(p),
      readlink: (p) => inner.readlink(p),
      symlink: (target, p) => inner.symlink(target, p),
      chmod: (p, mode) => inner.chmod(p, mode),
    },
  };
  // Per-instance FIFO: the queue key IS the carrier (one per makeGit).
  let queue: Promise<void> = Promise.resolve();
  return {
    fs,
    guard(operation) {
      const run = queue.then(async () => {
        const context: OperationContext = { failure: NO_FAILURE };
        current = context;
        try {
          const result = await operation();
          if (context.failure !== NO_FAILURE) throw context.failure;
          return result;
        } catch (error) {
          throw context.failure !== NO_FAILURE ? context.failure : error;
        } finally {
          current = null;
        }
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
