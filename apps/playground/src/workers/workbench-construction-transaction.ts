type ConstructionCleanup = () => void | Promise<void>;

interface CleanupEntry {
  active: boolean;
  readonly cleanup: ConstructionCleanup;
}

export interface WorkbenchConstructionLease {
  release(): void;
}

export interface WorkbenchConstructionTransaction {
  own(cleanup: ConstructionCleanup): WorkbenchConstructionLease;
  transfer(
    owned: readonly WorkbenchConstructionLease[],
    cleanup: ConstructionCleanup,
  ): WorkbenchConstructionLease;
  commit(): void;
  rollback(cause: unknown, message: string): Promise<never>;
}

/** Construction-only ownership stack; successful composites absorb their inputs. */
export function createWorkbenchConstructionTransaction(): WorkbenchConstructionTransaction {
  const entries: CleanupEntry[] = [];
  let state: 'open' | 'closed' = 'open';

  const assertOpen = (): void => {
    if (state !== 'open') throw new Error('Workbench construction transaction is closed');
  };

  const own = (cleanup: ConstructionCleanup): WorkbenchConstructionLease => {
    assertOpen();
    const entry: CleanupEntry = { active: true, cleanup };
    entries.push(entry);
    return Object.freeze({
      release() {
        entry.active = false;
      },
    });
  };

  return Object.freeze({
    own,
    transfer(
      owned: readonly WorkbenchConstructionLease[],
      cleanup: ConstructionCleanup,
    ): WorkbenchConstructionLease {
      const replacement = own(cleanup);
      for (const lease of owned) lease.release();
      return replacement;
    },
    commit() {
      assertOpen();
      state = 'closed';
      for (const entry of entries) entry.active = false;
    },
    async rollback(cause: unknown, message: string): Promise<never> {
      assertOpen();
      state = 'closed';
      const failures: unknown[] = [cause];
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry === undefined || !entry.active) continue;
        entry.active = false;
        try {
          await entry.cleanup();
        } catch (cleanupError) {
          if (!failures.includes(cleanupError)) failures.push(cleanupError);
        }
      }
      if (failures.length === 1) throw cause;
      throw new AggregateError(failures, message);
    },
  });
}
