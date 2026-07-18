import type { KernelEntryCapabilityPorts } from '@riftydev/kernel';
import {
  SHADOW_ASSET_CAPABILITY,
  type ShadowAssetPlan,
  type ShadowAssetPortServer,
  type ShadowAssetRuntimeReader,
  startShadowAssetPortServer,
} from '@riftydev/npm-client';
import { createSupervisedPromise } from '../glue/run-foreground-child.ts';
import type { OwnerChildAdmissionReservation } from './owner-package-state.ts';

/** Owner-private bridge from the package FIFO to one fresh child port session. */
export interface OwnerChildAdmissionAuthority {
  reserve(options?: Readonly<{ signal?: AbortSignal }>): Promise<OwnerChildAdmissionReservation>;
  runtimeReader(plan: ShadowAssetPlan): ShadowAssetRuntimeReader;
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

function prepareSession(
  reservation: OwnerChildAdmissionReservation,
  authority: OwnerChildAdmissionAuthority,
): PreparedSession {
  if (reservation.readiness.kind === 'not-required') return NO_SESSION;
  const { plan, receipt } = reservation.readiness;
  if (receipt.requiredSetDigest !== plan.requiredSetDigest) {
    throw new Error('child admission receipt does not attest its exact runtime-asset plan');
  }
  const channel = new MessageChannel();
  let server: ShadowAssetPortServer;
  try {
    server = startShadowAssetPortServer({
      plan,
      port: channel.port1,
      reader: authority.runtimeReader(plan),
    });
  } catch (error) {
    channel.port1.close();
    channel.port2.close();
    throw error;
  }
  return Object.freeze({
    capabilityPorts: Object.freeze({ [SHADOW_ASSET_CAPABILITY]: channel.port2 }),
    dispose: () => server.dispose(),
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
  try {
    session = dependencies.prepareSession(reservation, authority);
    options.beforeSpawn?.();
    handle = options.spawn(session.capabilityPorts);
    physicalExit = createSupervisedPromise<void>((resolve) => {
      handle!.once('exit', () => {
        physicalExited = true;
        resolve();
      });
    });

    let abortBound = false;
    const onAbort = (): void => {
      void session.dispose();
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
    const settleSession = (): void => {
      detachAbort();
      void session.dispose();
    };
    void physicalExit.then(settleSession, settleSession);

    const lifecycle = Object.freeze({ dispose: session.dispose });
    const result = options.supervise(handle, lifecycle);
    reservation.commit();
    return result as Awaited<Result>;
  } catch (error) {
    const failures: unknown[] = [];
    detachAbort();
    let sessionSettlement: Promise<void>;
    try {
      sessionSettlement = session.dispose();
    } catch (disposeError) {
      failures.push(disposeError);
      sessionSettlement = Promise.resolve();
    }
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

    let canAwaitPhysicalExit = physicalExit !== undefined;
    try {
      const killed = handle.kill('SIGTERM');
      if (killed === false && !physicalExited) {
        failures.push(new Error('owner child closed without an exit event'));
        canAwaitPhysicalExit = false;
      }
    } catch (killError) {
      failures.push(killError);
      if (!physicalExited) canAwaitPhysicalExit = false;
    }
    const exited =
      canAwaitPhysicalExit && physicalExit !== undefined
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
