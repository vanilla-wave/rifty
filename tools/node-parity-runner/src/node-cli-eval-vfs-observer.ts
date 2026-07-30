import { MemoryFsSync } from '@riftydev/vfs/internal';

type MutationKind = 'copy' | 'mkdir' | 'rename' | 'rm' | 'utimes' | 'write';

export interface NodeCliEvalVfsMutation {
  readonly kind: MutationKind;
  readonly path: string;
  readonly targetPath?: string;
}

export interface NodeCliEvalVfsAudit {
  readonly missing: readonly NodeCliEvalVfsMutation[];
  readonly unexpected: readonly NodeCliEvalVfsMutation[];
}

function cloneMutation(mutation: NodeCliEvalVfsMutation): NodeCliEvalVfsMutation {
  return { ...mutation };
}

function equalMutation(left: NodeCliEvalVfsMutation, right: NodeCliEvalVfsMutation): boolean {
  return (
    left.kind === right.kind && left.path === right.path && left.targetPath === right.targetPath
  );
}

/**
 * Real in-memory parity VFS with an append-only mutation history. Observation
 * starts after fixture setup, so a write-then-delete carrier cannot hide behind
 * an unchanged final tree.
 */
export class NodeCliEvalVfsObserver extends MemoryFsSync {
  readonly #mutations: NodeCliEvalVfsMutation[] = [];
  #observing = false;

  startObservation(): void {
    this.#mutations.length = 0;
    this.#observing = true;
  }

  mutations(): readonly NodeCliEvalVfsMutation[] {
    return this.#mutations.map(cloneMutation);
  }

  /**
   * Remove each declared guest effect exactly once. Missing declarations and
   * every remaining mutation stay visible; this is not a path allowlist.
   */
  audit(expectedGuestMutations: readonly NodeCliEvalVfsMutation[]): NodeCliEvalVfsAudit {
    const unexpected = [...this.mutations()];
    const missing: NodeCliEvalVfsMutation[] = [];
    for (const expected of expectedGuestMutations) {
      const match = unexpected.findIndex((actual) => equalMutation(actual, expected));
      if (match === -1) missing.push(cloneMutation(expected));
      else unexpected.splice(match, 1);
    }
    return { missing, unexpected };
  }

  override writeFileSync(path: string, data: Uint8Array): void {
    super.writeFileSync(path, data);
    this.record({ kind: 'write', path });
  }

  override mkdirSync(path: string, options: { recursive?: boolean }): void {
    super.mkdirSync(path, options);
    this.record({ kind: 'mkdir', path });
  }

  override rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    super.rmSync(path, options);
    this.record({ kind: 'rm', path });
  }

  override utimes(path: string, atimeMs: number, mtimeMs: number): void {
    super.utimes(path, atimeMs, mtimeMs);
    this.record({ kind: 'utimes', path });
  }

  override copyFileSync(sourcePath: string, targetPath: string): void {
    super.copyFileSync(sourcePath, targetPath);
    this.record({ kind: 'copy', path: sourcePath, targetPath });
  }

  override cpSync(
    sourcePath: string,
    targetPath: string,
    options: { recursive?: boolean } = {},
  ): void {
    super.cpSync(sourcePath, targetPath, options);
    this.record({ kind: 'copy', path: sourcePath, targetPath });
  }

  override renameSync(sourcePath: string, targetPath: string): void {
    super.renameSync(sourcePath, targetPath);
    this.record({ kind: 'rename', path: sourcePath, targetPath });
  }

  private record(mutation: NodeCliEvalVfsMutation): void {
    if (this.#observing) this.#mutations.push(mutation);
  }
}
