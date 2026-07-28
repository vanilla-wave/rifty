import {
  type KernelEntryCapabilityPorts,
  type ProcessTerminalEventSource,
  type WorkerEntryDescriptor,
  observeProcessTerminalOutcome,
} from '@riftydev/kernel';

export interface OwnerChildCapabilitySession {
  readonly capabilityPorts: KernelEntryCapabilityPorts;
  dispose(): void;
}

export interface OwnerChildAdmissionReservation {
  readonly snapshot: OwnerChildCapabilitySession;
  commit(): void;
  abortBeforeSpawn(error: unknown): void;
  abortAfterChildSettlement(error: unknown, exited: Promise<unknown>): Promise<void>;
}

export type ReserveOwnerChildAdmission = (root: string) => Promise<OwnerChildAdmissionReservation>;

/** Attach owner-minted endpoints only to the one URL entry being spawned. */
export function attachOwnerChildCapabilities(
  entry: WorkerEntryDescriptor,
  capabilityPorts: KernelEntryCapabilityPorts,
): WorkerEntryDescriptor {
  if (Object.keys(capabilityPorts).length === 0) return entry;
  if (entry.kind !== 'url') {
    throw new TypeError('owner child capabilities require a URL worker entry');
  }
  return Object.freeze({ ...entry, capabilityPorts });
}

/** Physical exit evidence, registered immediately after spawn returns. */
export function observeOwnerChildExit(handle: object): Promise<void> {
  return new Promise<void>((resolve) => {
    observeProcessTerminalOutcome(handle as ProcessTerminalEventSource, () => resolve());
  });
}

/** A committed spawn no longer holds the package FIFO; its port lives to exit. */
export function commitOwnerChildAdmission(
  reservation: OwnerChildAdmissionReservation,
  exited: Promise<unknown>,
): void {
  reservation.commit();
  void exited.finally(() => reservation.snapshot.dispose()).catch(() => {});
}

export function abortOwnerChildAdmissionBeforeSpawn(
  reservation: OwnerChildAdmissionReservation,
  error: unknown,
): void {
  try {
    reservation.snapshot.dispose();
  } finally {
    reservation.abortBeforeSpawn(error);
  }
}

/** Keep the overlapping package slot until the spawned worker is confirmed dead. */
export async function abortOwnerChildAdmissionAfterSpawn(
  reservation: OwnerChildAdmissionReservation,
  error: unknown,
  exited: Promise<unknown>,
): Promise<void> {
  try {
    await reservation.abortAfterChildSettlement(error, exited);
  } finally {
    reservation.snapshot.dispose();
  }
}
