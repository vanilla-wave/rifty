import { isTsResponseMessage } from '@riftydev/ts-language-service/protocol';
import type { WorkspaceOwnerHandle as WorkbenchWorkspaceOwnerHandle } from '@riftydev/workbench';
import { stampTsLspOwner, tsLspOwnerMatches } from './ts-lsp-owner-scope.ts';

type OwnerBridgeKey = WorkbenchWorkspaceOwnerHandle['snapshotPort'];

export interface TsLspOwnerChannel {
  sendTsLsp(message: unknown): void;
  onTsLsp(cb: (message: unknown) => void): () => void;
}

export interface RawOwnerChannel {
  readonly snapshotPort: OwnerBridgeKey;
  sendRawMessage(message: unknown): Promise<void>;
  onRawMessage(cb: (message: unknown) => void): () => void;
  close(): void;
}

/** Restore the playground-only protocol over the package's generic owner IPC. */
export function attachTsLspOwnerChannel<T extends RawOwnerChannel>(
  owner: T,
): T & TsLspOwnerChannel {
  const listeners = new Set<(message: unknown) => void>();
  const unsubscribeRaw = owner.onRawMessage((message) => {
    if (!isTsResponseMessage(message) || !tsLspOwnerMatches(message, owner.snapshotPort)) return;
    for (const listener of listeners) listener(message);
  });
  const closeOwner = owner.close.bind(owner);
  let closed = false;

  return {
    ...owner,
    sendTsLsp(message) {
      // Preserve the existing void transport contract. The correlated client
      // owns the bounded timeout and surfaces a refused/dead owner loudly.
      void owner.sendRawMessage(stampTsLspOwner(message, owner.snapshotPort)).catch(() => {});
    },
    onTsLsp(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribeRaw();
      listeners.clear();
      closeOwner();
    },
  };
}
