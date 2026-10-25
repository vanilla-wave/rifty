import { type ProcessTerminalEventSource, observeProcessTerminalOutcome } from '@riftydev/kernel';
import {
  type NodeEntryRuntimeBinding,
  snapshotNodeEntryRuntimeBindings,
} from '@riftydev/runtime-js/builtins/node-entry-url';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type { GuestRoots } from './guest-layout.ts';

export interface OwnerChildRuntimeBindingSession {
  readonly runtimeBindings: readonly NodeEntryRuntimeBinding[];
}

export interface OwnerChildAdmissionReservation {
  readonly snapshot: OwnerChildRuntimeBindingSession;
  commit(): void;
  abortBeforeSpawn(error: unknown): void;
  abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
}

export type ReserveOwnerChildAdmission = (root: string) => Promise<OwnerChildAdmissionReservation>;

/** Project physical owner paths into the child's guest namespace. */
export function projectOwnerChildRuntimeBindings(
  bindings: readonly NodeEntryRuntimeBinding[],
  guestRoots?: GuestRoots,
): readonly NodeEntryRuntimeBinding[] {
  if (guestRoots === undefined) return snapshotNodeEntryRuntimeBindings(bindings);
  const { remoteFsRoot, publicRoot } = guestRoots;
  if (!isAbsolute(remoteFsRoot) || normalizePath(remoteFsRoot) !== remoteFsRoot) {
    throw new TypeError('owner child runtime binding root must be normalized and absolute');
  }
  return snapshotNodeEntryRuntimeBindings(
    bindings.map((binding) => {
      if (!binding.packagePath.startsWith(`${remoteFsRoot}/`)) {
        throw new TypeError(
          `owner child runtime binding ${binding.packagePath} is outside ${remoteFsRoot}`,
        );
      }
      const relative = binding.packagePath.slice(remoteFsRoot.length);
      return {
        ...binding,
        packagePath: publicRoot === '/' ? relative : `${publicRoot}${relative}`,
      };
    }),
  );
}

/** Physical exit evidence, registered immediately after spawn returns. */
export function observeOwnerChildExit(handle: object): Promise<void> {
  return new Promise<void>((resolve) => {
    observeProcessTerminalOutcome(handle as ProcessTerminalEventSource, () => resolve());
  });
}
