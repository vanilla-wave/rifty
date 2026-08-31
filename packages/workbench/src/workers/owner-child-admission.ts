import { type ProcessTerminalEventSource, observeProcessTerminalOutcome } from '@riftydev/kernel';
import {
  type NodeEntryRuntimeBinding,
  snapshotNodeEntryRuntimeBindings,
} from '@riftydev/runtime-js/builtins/node-entry-url';
import { isAbsolute, normalizePath } from '@riftydev/vfs';

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

/** Project physical owner paths into the child's existing `/` namespace. */
export function projectOwnerChildRuntimeBindings(
  bindings: readonly NodeEntryRuntimeBinding[],
  remoteFsRoot?: string,
): readonly NodeEntryRuntimeBinding[] {
  if (remoteFsRoot === undefined) return snapshotNodeEntryRuntimeBindings(bindings);
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
      return { ...binding, packagePath: binding.packagePath.slice(remoteFsRoot.length) };
    }),
  );
}

/** Physical exit evidence, registered immediately after spawn returns. */
export function observeOwnerChildExit(handle: object): Promise<void> {
  return new Promise<void>((resolve) => {
    observeProcessTerminalOutcome(handle as ProcessTerminalEventSource, () => resolve());
  });
}

export function commitOwnerChildAdmission(
  reservation: OwnerChildAdmissionReservation,
  _exited: Promise<unknown>,
): void {
  reservation.commit();
}

export function abortOwnerChildAdmissionBeforeSpawn(
  reservation: OwnerChildAdmissionReservation,
  error: unknown,
): void {
  reservation.abortBeforeSpawn(error);
}

/** Keep the overlapping package slot until the spawned worker is confirmed dead. */
export async function abortOwnerChildAdmissionAfterSpawn(
  reservation: OwnerChildAdmissionReservation,
  error: unknown,
  exited: Promise<unknown>,
): Promise<void> {
  await reservation.abortAfterChildSettlement(error, exited);
}
