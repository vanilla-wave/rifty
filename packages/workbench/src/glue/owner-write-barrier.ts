/** Owner-side apply + durability protocol shared by every page write path. */
export interface OwnerWritePort<Frame> {
  writeFrameAcked(frame: Frame): Promise<unknown>;
  flushDurable(): Promise<void>;
}

export interface OwnerWriteCommit {
  /** Resolves after every frame was applied by the captured owner. */
  readonly applied: Promise<void>;
  /** Resolves after `applied` and that same owner's durability drain. */
  readonly durable: Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation()).catch((error: unknown) => {
      throw asError(error);
    });
  } catch (error) {
    return Promise.reject(asError(error));
  }
}

/**
 * Capture one owner, apply frames in order, then flush that same owner once.
 * The first apply is invoked synchronously; later applies follow their prior
 * ack. Both stage promises are hot, so callers cannot accidentally omit flush.
 */
export function commitOwnerWrites<Frame, Owner extends OwnerWritePort<Frame>>(
  currentOwner: () => Owner,
  frames: readonly Frame[],
): OwnerWriteCommit {
  const batch = [...frames];
  if (batch.length === 0) {
    const complete = Promise.resolve();
    return { applied: complete, durable: complete };
  }

  let owner: Owner;
  try {
    owner = currentOwner();
  } catch (error) {
    const failed = Promise.reject<void>(asError(error));
    void failed.catch(() => {});
    return { applied: failed, durable: failed };
  }

  let index = 0;
  const applyNext = (): Promise<void> =>
    invoke(() => owner.writeFrameAcked(batch[index]!)).then(() => {
      index += 1;
      return index < batch.length ? applyNext() : undefined;
    });

  const applied = applyNext();
  const durable = applied.then(() => invoke(() => owner.flushDurable()));
  // `durable` starts eagerly. Keep an internal rejection observer so a caller
  // awaiting `applied` before `durable` never creates an unhandled-rejection gap.
  void durable.catch(() => {});
  return { applied, durable };
}
