export interface DelayedCatalogDeleteOptions {
  readonly delayMs: number;
  readonly deleteProject: (id: string) => Promise<void>;
  readonly onCommitted: (id: string) => void;
  readonly onFailed: (id: string, error: unknown) => void;
}

export interface DelayedCatalogDelete {
  pending(): string | null;
  schedule(id: string): void;
  undo(): string | null;
  dispose(): void;
}

/** Page-only Undo window; the owner catalog remains untouched until expiry. */
export function createDelayedCatalogDelete(
  options: DelayedCatalogDeleteOptions,
): DelayedCatalogDelete {
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < 0) {
    throw new RangeError('Catalog delete delay must be a non-negative safe integer');
  }

  let scheduled: { readonly id: string; readonly timer: ReturnType<typeof setTimeout> } | null =
    null;
  let disposed = false;

  const clear = (): string | null => {
    const current = scheduled;
    if (current === null) return null;
    clearTimeout(current.timer);
    scheduled = null;
    return current.id;
  };

  return Object.freeze({
    pending: () => scheduled?.id ?? null,

    schedule(id: string) {
      if (disposed) throw new Error('Catalog delete policy is closed');
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('Catalog delete id must be a non-empty string');
      }
      if (scheduled !== null) throw new Error(`Catalog delete ${scheduled.id} is still undoable`);
      const claim = {
        id,
        timer: setTimeout(() => {
          if (scheduled !== claim) return;
          scheduled = null;
          void options.deleteProject(id).then(
            () => options.onCommitted(id),
            (error: unknown) => options.onFailed(id, error),
          );
        }, options.delayMs),
      };
      scheduled = claim;
    },

    undo: clear,

    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  });
}
