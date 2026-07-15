/** Path-only vocabulary shared by VFS mutation producers and policy guards. */
export type VfsMutationIntent =
  | {
      readonly kind: 'write' | 'mkdir' | 'rm' | 'utimes';
      readonly path: string;
    }
  | {
      readonly kind: 'rename' | 'copy';
      readonly sourcePath: string;
      readonly targetPath: string;
    };

/** Host policy may delay a whole logical mutation batch, but not replace it. */
export type VfsMutationGuard = <T>(
  intents: readonly VfsMutationIntent[],
  apply: () => T | Promise<T>,
) => T | Promise<T>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function intentLabel(intents: readonly VfsMutationIntent[]): string {
  return intents.map((intent) => intent.kind).join('+');
}

/**
 * Run one non-empty logical mutation batch through an optional host guard.
 * A fulfilled guard must call `apply` exactly once. Rejection before apply is
 * valid: durable policy transitions may fail and must fence the mutation.
 */
export function guardVfsMutations<T>(
  guard: VfsMutationGuard | undefined,
  intents: readonly VfsMutationIntent[],
  apply: () => T | Promise<T>,
): T | Promise<T> {
  if (intents.length === 0) {
    throw new Error('VfsMutationGuard: mutation batch must not be empty');
  }
  if (!guard) return apply();

  const batch = intents.map((intent) => ({ ...intent })) as readonly VfsMutationIntent[];
  const label = intentLabel(batch);
  let state: 'open' | 'applied' | 'settled' = 'open';
  let application: T | Promise<T> | undefined;
  let applicationStarted = false;
  let applicationThrew = false;
  let applicationError: unknown;
  const guardedApply = (): T | Promise<T> => {
    if (state === 'applied') {
      throw new Error(`VfsMutationGuard: apply called more than once for ${label}`);
    }
    if (state === 'settled') {
      throw new Error(`VfsMutationGuard: apply called after settlement for ${label}`);
    }
    state = 'applied';
    applicationStarted = true;
    try {
      application = apply();
      return application;
    } catch (error) {
      applicationThrew = true;
      applicationError = error;
      throw error;
    }
  };

  const fulfilled = (): T | Promise<T> => {
    if (!applicationStarted) {
      state = 'settled';
      throw new Error(`VfsMutationGuard: fulfilled without apply for ${label}`);
    }
    state = 'settled';
    if (applicationThrew) throw applicationError;
    return application as T | Promise<T>;
  };

  let guarded: T | Promise<T>;
  try {
    guarded = guard(batch, guardedApply);
  } catch (error) {
    state = 'settled';
    throw error;
  }
  if (!isThenable(guarded)) return fulfilled();
  return Promise.resolve(guarded).then(
    () => fulfilled(),
    (error: unknown) => {
      state = 'settled';
      throw error;
    },
  );
}
