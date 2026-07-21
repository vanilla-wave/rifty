import type { KernelEntryCapabilityPorts } from '@riftydev/kernel';
import {
  SHADOW_ASSET_CAPABILITY,
  type ShadowAssetPlan,
  type ShadowAssetPortServer,
  type ShadowAssetRuntimeReader,
  startShadowAssetPortServer,
} from '@riftydev/npm-client';
import type { OwnerChildAdmissionReservation } from './owner-package-state.ts';

/** Owner-private bridge from the package FIFO to one fresh child port session. */
export interface OwnerChildAdmissionAuthority {
  reserve(options?: Readonly<{ signal?: AbortSignal }>): Promise<OwnerChildAdmissionReservation>;
  runtimeReader(plan: ShadowAssetPlan): ShadowAssetRuntimeReader;
  /** Optional owner-private entry capabilities, minted while the package FIFO is held. */
  entryCapabilities?(
    evidence: OwnerChildEntryEvidence,
  ): OwnerChildEntryCapabilitySession | undefined;
}

export interface OwnerChildEntryEvidence {
  readonly rootPackageVersionsByInstallPath: Readonly<Record<string, string>>;
}

export interface OwnerChildEntryCapabilitySession {
  readonly capabilityPorts: KernelEntryCapabilityPorts;
  /** Preparation is synchronous; rollback must finish before the package FIFO moves. */
  dispose(): void;
}

export interface OwnerChildAdmissionHandle {
  on(event: 'exit', listener: (...args: unknown[]) => void): unknown;
  once(event: 'exit', listener: (...args: unknown[]) => void): unknown;
  kill(signal?: string): unknown;
}

export interface OwnerChildSessionLifecycle {
  /** Idempotently fence this peer before a terminal control path kills it. */
  dispose(): Promise<void>;
}

interface AdmitOwnerChildOptions<Handle extends OwnerChildAdmissionHandle, Result> {
  readonly authority?: OwnerChildAdmissionAuthority;
  readonly signal?: AbortSignal;
  /** Runs after reservation/session creation and immediately before physical spawn. */
  readonly beforeSpawn?: () => void;
  readonly spawn: (capabilityPorts?: KernelEntryCapabilityPorts) => Handle;
  /** Synchronously attaches every remaining supervisor before admission commits. */
  readonly supervise: (handle: Handle, lifecycle: OwnerChildSessionLifecycle) => Result;
}

interface PreparedSession {
  readonly capabilityPorts?: KernelEntryCapabilityPorts;
  readonly dispose: () => Promise<void>;
}

interface OwnerChildAdmissionDependencies {
  readonly prepareSession: (
    reservation: OwnerChildAdmissionReservation,
    authority: OwnerChildAdmissionAuthority,
  ) => PreparedSession;
}

const NO_SESSION: PreparedSession = Object.freeze({
  dispose: () => Promise.resolve(),
});

function aggregateLifecycleFailure(
  original: unknown,
  failures: readonly unknown[],
  message: string,
): unknown {
  if (failures.length === 0) return original;
  return new AggregateError([original, ...failures], message);
}

function failAfterEntrySessionDispose(
  session: OwnerChildEntryCapabilitySession,
  failure: unknown,
): never {
  try {
    session.dispose();
  } catch (disposeError) {
    throw new AggregateError(
      [failure, disposeError],
      'owner child capability preparation and rollback failed',
    );
  }
  throw failure;
}

function prepareSession(
  reservation: OwnerChildAdmissionReservation,
  authority: OwnerChildAdmissionAuthority,
): PreparedSession {
  const entrySession = authority.entryCapabilities?.(
    Object.freeze({
      rootPackageVersionsByInstallPath: reservation.rootPackageVersionsByInstallPath,
    }),
  );
  let ports: Record<string, MessagePort>;
  try {
    ports = { ...(entrySession?.capabilityPorts ?? {}) };
  } catch (error) {
    if (entrySession !== undefined) failAfterEntrySessionDispose(entrySession, error);
    throw error;
  }
  if (entrySession !== undefined && ports[SHADOW_ASSET_CAPABILITY] !== undefined) {
    failAfterEntrySessionDispose(
      entrySession,
      new Error(`owner child capability collision: ${SHADOW_ASSET_CAPABILITY}`),
    );
  }
  let assetServer: ShadowAssetPortServer | undefined;
  let assetPort: MessagePort | undefined;
  try {
    if (reservation.readiness.kind === 'ready') {
      const { plan, receipt } = reservation.readiness;
      if (receipt.requiredSetDigest !== plan.requiredSetDigest) {
        throw new Error('child admission receipt does not attest its exact runtime-asset plan');
      }
      const channel = new MessageChannel();
      try {
        assetServer = startShadowAssetPortServer({
          plan,
          port: channel.port1,
          reader: authority.runtimeReader(plan),
        });
        assetPort = channel.port2;
      } catch (error) {
        channel.port1.close();
        channel.port2.close();
        throw error;
      }
    }
  } catch (error) {
    if (entrySession !== undefined) failAfterEntrySessionDispose(entrySession, error);
    throw error;
  }
  if (assetServer === undefined && entrySession === undefined) return NO_SESSION;
  if (assetPort !== undefined) {
    ports[SHADOW_ASSET_CAPABILITY] = assetPort;
  }
  return Object.freeze({
    capabilityPorts: Object.freeze(ports),
    async dispose(): Promise<void> {
      const outcomes = await Promise.allSettled([
        ...(assetServer === undefined ? [] : [assetServer.dispose()]),
        ...(entrySession === undefined
          ? []
          : [Promise.resolve().then(() => entrySession.dispose())]),
      ]);
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'owner child capability sessions failed to dispose');
      }
    },
  });
}

const DEFAULT_DEPENDENCIES: OwnerChildAdmissionDependencies = Object.freeze({ prepareSession });

async function awaitChildAndSessionSettlement(
  physicalExit: Promise<void>,
  sessionSettlement: Promise<void>,
): Promise<void> {
  const outcomes = await Promise.allSettled([physicalExit, sessionSettlement]);
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'owner child and session settlement failed');
  }
}

function createSessionSettlement(session: PreparedSession): () => Promise<void> {
  let settlement: Promise<void> | null = null;
  return () => {
    if (settlement !== null) return settlement;
    try {
      settlement = Promise.resolve(session.dispose());
    } catch (error) {
      settlement = Promise.reject(error);
    }
    void settlement.catch(() => {});
    return settlement;
  };
}

type PhysicalExitObservation =
  | Readonly<{ kind: 'attached'; exited: Promise<void> }>
  | Readonly<{ kind: 'attachment-failed'; exited: Promise<void>; error: unknown }>;

function observePhysicalExit(
  handle: OwnerChildAdmissionHandle,
  onExitObserved: () => void,
): PhysicalExitObservation {
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  let observed = false;
  const onExit = (): void => {
    if (observed) return;
    observed = true;
    onExitObserved();
    resolveExit();
  };
  try {
    handle.once('exit', onExit);
    return Object.freeze({ kind: 'attached', exited });
  } catch (onceError) {
    try {
      handle.on('exit', onExit);
    } catch (onError) {
      return Object.freeze({
        kind: 'attachment-failed',
        exited,
        error: new AggregateError(
          [onceError, onError],
          'owner child physical-exit observers both failed to attach',
        ),
      });
    }
    return Object.freeze({ kind: 'attachment-failed', exited, error: onceError });
  }
}

/**
 * One child-admission transaction. After the FIFO reservation resolves, session
 * creation, physical spawn, supervision attachment, and commit stay synchronous.
 */
export async function admitOwnerChild<Handle extends OwnerChildAdmissionHandle, Result>(
  options: AdmitOwnerChildOptions<Handle, Result>,
  dependencies: OwnerChildAdmissionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Awaited<Result>> {
  const authority = options.authority;
  if (authority === undefined) {
    options.beforeSpawn?.();
    return options.supervise(options.spawn(), NO_SESSION) as Awaited<Result>;
  }

  const reservation = await authority.reserve(
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (options.signal?.aborted) {
    const error = new DOMException('The operation was aborted', 'AbortError');
    try {
      reservation.abortBeforeSpawn(error);
    } catch (settlementError) {
      throw aggregateLifecycleFailure(
        error,
        [settlementError],
        'owner child abort and reservation settlement failed before session preparation',
      );
    }
    throw error;
  }
  let session = NO_SESSION;
  let handle: Handle | undefined;
  let physicalExit: Promise<void> | undefined;
  let physicalExited = false;
  let detachAbort = (): void => {};
  let disposeSession = createSessionSettlement(NO_SESSION);
  try {
    session = dependencies.prepareSession(reservation, authority);
    disposeSession = createSessionSettlement(session);
    options.beforeSpawn?.();
    handle = options.spawn(session.capabilityPorts);
    const exitObservation = observePhysicalExit(handle, () => {
      physicalExited = true;
    });
    physicalExit = exitObservation.exited;
    if (exitObservation.kind === 'attachment-failed') throw exitObservation.error;

    let abortBound = false;
    const onAbort = (): void => {
      void disposeSession();
    };
    if (options.signal !== undefined) {
      abortBound = true;
      options.signal.addEventListener('abort', onAbort, { once: true });
      detachAbort = (): void => {
        if (!abortBound) return;
        abortBound = false;
        options.signal?.removeEventListener('abort', onAbort);
      };
      if (options.signal.aborted) onAbort();
    }
    const settleOnExit = (): void => {
      detachAbort();
      void disposeSession();
    };
    void physicalExit.then(settleOnExit, settleOnExit);

    const lifecycle = Object.freeze({ dispose: disposeSession });
    const result = options.supervise(handle, lifecycle);
    reservation.commit();
    return result as Awaited<Result>;
  } catch (error) {
    const failures: unknown[] = [];
    detachAbort();
    const sessionSettlement = disposeSession();
    if (handle === undefined) {
      try {
        reservation.abortBeforeSpawn(error);
      } catch (abortError) {
        failures.push(abortError);
      }
      try {
        await sessionSettlement;
      } catch (disposeError) {
        failures.push(disposeError);
      }
      throw aggregateLifecycleFailure(error, failures, 'owner child failed before physical spawn');
    }

    try {
      const killed = handle.kill('SIGTERM');
      if (killed === false && !physicalExited) {
        failures.push(new Error('owner child closed without an exit event'));
      }
    } catch (killError) {
      failures.push(killError);
    }
    const exited =
      physicalExit !== undefined
        ? awaitChildAndSessionSettlement(physicalExit, sessionSettlement)
        : sessionSettlement;
    try {
      await reservation.abortAfterChildSettlement(error, exited);
    } catch (settlementError) {
      failures.push(settlementError);
    }
    throw aggregateLifecycleFailure(error, failures, 'owner child admission failed after spawn');
  }
}
