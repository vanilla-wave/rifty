import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export interface ChildExecutionPlan {
  readonly cwd: string;
  readonly entryPath?: string;
}

/** Resolve one child cwd/entry snapshot before allocating a PID or Worker. */
export function buildChildExecutionPlan(
  parentCwd: string,
  requestedCwd: string | undefined,
  entryPath?: string,
): ChildExecutionPlan {
  const requested = requestedCwd ?? parentCwd;
  const cwd = normalizePath(isAbsolute(requested) ? requested : joinPath(parentCwd, requested));
  return {
    cwd,
    ...(entryPath === undefined
      ? {}
      : {
          entryPath: normalizePath(isAbsolute(entryPath) ? entryPath : joinPath(cwd, entryPath)),
        }),
  };
}
