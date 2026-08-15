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

interface OperationContext {
  failure?: unknown;
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
  // One context per in-flight facade operation; a failure is attributed to every
  // operation whose window it landed in (over-loud beats a provenance lie).
  const active = new Set<OperationContext>();
  const capture = (error: unknown): void => {
    if (isAbsenceProbe(error)) return;
    for (const context of active) context.failure ??= error;
  };
  const assertNoLatchedFailure = (): void => {
    for (const context of active) {
      if (context.failure !== undefined) throw context.failure;
    }
  };
  const readFile = base.promises.readFile.bind(base.promises);
  const readdir = base.promises.readdir.bind(base.promises);
  const writeFile = base.promises.writeFile.bind(base.promises);
  const unlink = base.promises.unlink.bind(base.promises);
  const mkdir = base.promises.mkdir.bind(base.promises);
  const rmdir = base.promises.rmdir.bind(base.promises);
  const fs: GitFs = {
    promises: {
      ...base.promises,
      async readFile(p, opts) {
        try {
          return await readFile(p, opts);
        } catch (error) {
          // isomorphic-git probes `readFile()` with NO path at fs-capability
          // detection (per facade call); that rejection is the designed probe.
          if (p !== undefined) capture(error);
          throw error;
        }
      },
      async readdir(p) {
        try {
          return await readdir(p);
        } catch (error) {
          capture(error);
          throw error;
        }
      },
      async writeFile(p, data, opts) {
        assertNoLatchedFailure();
        await writeFile(p, data, opts);
      },
      async unlink(p) {
        assertNoLatchedFailure();
        await unlink(p);
      },
      async mkdir(p) {
        assertNoLatchedFailure();
        await mkdir(p);
      },
      async rmdir(p) {
        assertNoLatchedFailure();
        await rmdir(p);
      },
    },
  };
  return {
    fs,
    async guard(operation) {
      const context: OperationContext = {};
      active.add(context);
      try {
        const result = await operation();
        if (context.failure !== undefined) throw context.failure;
        return result;
      } catch (error) {
        throw context.failure !== undefined ? context.failure : error;
      } finally {
        active.delete(context);
      }
    },
  };
}
