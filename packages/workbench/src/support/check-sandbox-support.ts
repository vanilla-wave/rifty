import { CHECK_IDS, WORKER_CLAIMS, WORKER_EVIDENCE, failure, modes } from './report.ts';
import type {
  SandboxSupportCheck,
  SandboxSupportCheckId,
  SandboxSupportOptions,
  SandboxSupportReport,
  SupportWorkerMessage,
  SupportWorkerRequest,
} from './types.ts';

const LIMITS = Object.freeze([
  'Only tested browser prerequisites in the current context: actual deployment assets, CSP differences and controlling Service Worker configuration remain unverified.',
  'No guarantee of arbitrary npm package compatibility, future storage availability or durability, or an available Workbench origin lease.',
  'Non-COI describes the SDK toolchain composition; openWorkbench still requires COI.',
]);

/** Active, disposable browser probes. Does not open a sandbox or inspect project data. */
export async function checkSandboxSupport(
  options: SandboxSupportOptions,
): Promise<SandboxSupportReport> {
  if (options?.probeBaseUrl === undefined) throw new TypeError('probeBaseUrl is required');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new RangeError('timeoutMs must be an integer from 1 to 60000');
  const persistence = options.persistence ?? 'preferred';
  if (!['required', 'preferred', 'ephemeral'].includes(persistence))
    throw new TypeError('Invalid persistence policy');
  if (
    options.nonCoiVmEngine !== undefined &&
    !['rewrite', 'quickjs'].includes(options.nonCoiVmEngine)
  )
    throw new TypeError('Invalid nonCoiVmEngine');
  if (options.wasm !== undefined && typeof options.wasm !== 'boolean')
    throw new TypeError('wasm must be boolean');
  const selected = { ...options, persistence };
  const base = new URL(String(options.probeBaseUrl), globalThis.location?.href);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.origin !== globalThis.location?.origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.pathname.endsWith('/')
  ) {
    throw new TypeError(
      'probeBaseUrl must be a same-origin HTTP(S) directory without credentials, query or fragment',
    );
  }
  const checks = new Map<SandboxSupportCheckId, SandboxSupportCheck>(
    CHECK_IDS.map((id) => [
      id,
      { id, status: 'incomplete', reason: `${id}: operation not completed` },
    ]),
  );
  let stopped = false;
  const set = (check: SandboxSupportCheck): void => {
    if (!stopped) checks.set(check.id, check);
  };
  const passed = (id: SandboxSupportCheckId, reason: string): void =>
    set({ id, status: 'passed', reason });
  const observe = (id: SandboxSupportCheckId, action: () => void): void => {
    try {
      action();
      passed(id, `${id}: current context supports the operation`);
    } catch (error) {
      set(failure(id, error));
    }
  };
  observe('window', () => {
    if (typeof document === 'undefined') throw new Error('A browser Window is required');
  });
  observe('secure-context', () => {
    if (!globalThis.isSecureContext) throw new Error('A secure browser context is required');
  });
  observe('cross-origin-isolated', () => {
    if (!globalThis.crossOriginIsolated)
      throw new Error('Current document is not cross-origin isolated');
  });
  let name: string | undefined;
  observe('crypto', () => {
    name = `rifty-support-${crypto.randomUUID()}`;
  });
  observe('service-worker-api', () => {
    if (!globalThis.navigator?.serviceWorker) throw new Error('Service Worker API is unavailable');
  });
  set({
    id: 'deployment-control',
    status: 'incomplete',
    reason:
      'Actual deployment controller and routing are not verified by disposable browser probes',
  });
  if (persistence === 'ephemeral')
    set({
      id: 'opfs',
      status: 'not-applicable',
      reason: 'OPFS is not used by ephemeral persistence',
    });

  const abort = new AbortController();
  const cleanupErrors: unknown[] = [];
  // Set when the probe phase ends; bounds the scratch removal's wait for the Worker's lock.
  let cleanupUntil = 0;
  const owned: (() => Promise<unknown>)[] = [];
  const pendingEffects: Promise<void>[] = [];
  // Native register/mkdir cannot be aborted: retain disposal even after the report deadline.
  const capture = <T>(
    creation: Promise<T>,
    dispose: (value: T) => Promise<unknown>,
  ): Promise<T | undefined> => {
    const effect = creation.then(async (value) => {
      if (stopped) {
        try {
          await dispose(value);
        } catch (error) {
          cleanupErrors.push(error);
        }
        return undefined;
      }
      owned.push(() => dispose(value));
      return value;
    });
    pendingEffects.push(
      effect.then(
        () => {},
        () => {},
      ),
    );
    return effect;
  };
  const work: Promise<unknown>[] = [];
  let worker: Worker | undefined;
  let port: MessageChannel | undefined;
  let broadcast: BroadcastChannel | undefined;
  let memory: SharedArrayBuffer | undefined;
  let resolveWorker: () => void = () => {};
  let resolvePort: () => void = () => {};
  let resolveBroadcast: () => void = () => {};
  let resolveStorage: () => void = () => {};
  const endWorker = (): void => {
    resolveWorker();
    resolvePort();
    resolveBroadcast();
    resolveStorage();
  };
  const workerFailed = (error: unknown): void => {
    // The observed load stands; a later Worker death only costs the evidence still pending.
    if (checks.get('module-worker')?.status === 'passed') {
      const detail = error instanceof Error ? error.message : String(error);
      for (const id of WORKER_EVIDENCE) {
        if (checks.get(id)?.status !== 'incomplete') continue;
        set({
          id,
          status: 'incomplete',
          reason: `${id}: probe Worker failed after loading: ${detail || 'cause unknown'}`,
        });
      }
    } else set(failure('module-worker', error));
    endWorker();
  };
  if (typeof document !== 'undefined' && name !== undefined) {
    const privateName = name;
    work.push(
      (async () => {
        try {
          let acquired = false;
          await navigator.locks.request(privateName, { ifAvailable: true }, (lock) => {
            acquired = lock !== null;
          });
          if (acquired) {
            passed(
              'page-locks',
              'Web Locks acquired and released a private Window lock; origin lease availability is unverified',
            );
          } else {
            set({
              id: 'page-locks',
              status: 'incomplete',
              reason: 'Private probe lock is occupied; availability not established',
            });
          }
        } catch (error) {
          set(failure('page-locks', error));
        }
      })(),
    );

    const asset = (filename: string): string => {
      const url = new URL(filename, base);
      url.searchParams.set('probe', privateName);
      return url.href;
    };
    try {
      const workerDone = new Promise<void>((resolve) => {
        resolveWorker = resolve;
      });
      const portDone = new Promise<void>((resolve) => {
        resolvePort = resolve;
      });
      const broadcastDone = new Promise<void>((resolve) => {
        resolveBroadcast = resolve;
      });
      work.push(workerDone, portDone, broadcastDone);
      port = new MessageChannel();
      port.port1.onmessage = (event) => {
        const data = event.data as { name?: unknown; bytes?: unknown };
        if (
          data.name === privateName &&
          data.bytes instanceof ArrayBuffer &&
          new Uint8Array(data.bytes).join(',') === '37,128,255'
        ) {
          passed(
            'message-port',
            'Transferred MessagePort and ArrayBuffer roundtrip preserved exact bytes',
          );
        } else set(failure('message-port', new Error('Transferred bytes differed')));
        resolvePort();
      };
      try {
        broadcast = new BroadcastChannel(privateName);
        broadcast.onmessage = (event) => {
          if (event.data === `${privateName}:ready`) {
            broadcast?.postMessage(privateName);
            return;
          }
          if (event.data !== `${privateName}:reply`) return;
          passed(
            'broadcast-channel',
            'BroadcastChannel exchanged messages between Window and Worker',
          );
          resolveBroadcast();
        };
        // Either side's native-channel greeting proves the peer is attached.
        broadcast.postMessage(privateName);
      } catch (error) {
        set(failure('broadcast-channel', error));
        resolveBroadcast();
      }
      observe('shared-memory', () => {
        memory = new SharedArrayBuffer(4);
        const atomics = Atomics as unknown as {
          waitAsync(
            view: Int32Array,
            index: number,
            value: number,
            timeout: number,
          ): { value: string | Promise<string> };
        };
        if (atomics.waitAsync(new Int32Array(memory), 0, 0, 0).value !== 'timed-out')
          throw new Error('Window Atomics.waitAsync failed');
      });
      // Allocation alone is not a shared-memory roundtrip.
      if (checks.get('shared-memory')?.status === 'passed')
        set({
          id: 'shared-memory',
          status: 'incomplete',
          reason: 'Shared memory allocated; Worker transfer/Atomics roundtrip not completed',
        });
      else memory = undefined;
      worker = new Worker(asset('support-worker.js'), { type: 'module' });
      worker.onerror = (event) => {
        event.preventDefault();
        workerFailed(new Error(event.message || 'Worker failed; cause unknown'));
      };
      worker.onmessageerror = () =>
        workerFailed(new Error('Worker message could not be deserialized; cause unknown'));
      worker.onmessage = (event: MessageEvent<SupportWorkerMessage>) => {
        const message = event.data;
        if (message?.kind === 'done') {
          resolveWorker();
          return;
        }
        if (message?.kind !== 'check') return;
        const check = message.check;
        if (
          !check ||
          !WORKER_CLAIMS.includes(check.id) ||
          !['passed', 'failed'].includes(check.status) ||
          typeof check.reason !== 'string'
        )
          return;
        if (
          check.id === 'shared-memory' &&
          check.status === 'passed' &&
          (memory === undefined || Atomics.load(new Int32Array(memory), 0) !== 42)
        ) {
          set(
            failure(
              'shared-memory',
              new Error('Worker shared-memory result was not observed in Window'),
            ),
          );
        } else set(check);
        if (check.id === 'broadcast-channel' && check.status === 'failed') resolveBroadcast();
        if (check.id === 'opfs') resolveStorage();
      };
      const start: SupportWorkerRequest = {
        kind: 'start',
        name: privateName,
        port: port.port2,
        ...(memory === undefined ? {} : { memory }),
      };
      worker.postMessage(start, [port.port2]);
      const bytes = new Uint8Array([37, 128, 255]).buffer;
      port.port1.postMessage({ name: privateName, bytes }, [bytes]);
      if (persistence !== 'ephemeral') {
        const storageDone = new Promise<void>((resolve) => {
          resolveStorage = resolve;
        });
        work.push(storageDone);
        work.push(
          (async () => {
            try {
              const root = await navigator.storage.getDirectory();
              if (stopped) return;
              try {
                await root.getDirectoryHandle(privateName);
                set({
                  id: 'opfs',
                  status: 'incomplete',
                  reason: 'Private storage probe name already exists; existing data left untouched',
                });
                resolveStorage();
                return;
              } catch (error) {
                if ((error as { name?: string })?.name === 'TypeMismatchError') {
                  set({
                    id: 'opfs',
                    status: 'incomplete',
                    reason: 'Private storage probe name is an existing file; left untouched',
                  });
                  resolveStorage();
                  return;
                }
                if ((error as { name?: string })?.name !== 'NotFoundError') throw error;
              }
              if (stopped) return;
              const directory = await capture(
                root.getDirectoryHandle(privateName, { create: true }),
                () => removeScratch(root, privateName, () => cleanupUntil),
              );
              if (stopped || directory === undefined) return;
              worker?.postMessage({
                kind: 'storage',
                directory,
                name: privateName,
              } satisfies SupportWorkerRequest);
            } catch (error) {
              set(failure('opfs', error));
              resolveStorage();
            }
          })(),
        );
      }
    } catch (error) {
      workerFailed(error);
    }

    for (const type of ['classic', 'module'] as const) {
      const id =
        type === 'classic' ? 'service-worker-registration' : 'service-worker-module-registration';
      work.push(
        (async () => {
          try {
            const scope = new URL(`${privateName}/${type}/`, base).href;
            const registrations = await navigator.serviceWorker.getRegistrations();
            if (stopped) return;
            if (
              location.href.startsWith(scope) ||
              registrations.some((registration) => registration.scope === scope)
            ) {
              set({
                id,
                status: 'incomplete',
                reason: `${id}: private scope is occupied; existing registration left untouched`,
              });
              return;
            }
            const registration = await capture(
              navigator.serviceWorker.register(asset('support-service-worker.js'), {
                scope,
                type,
                updateViaCache: 'none',
              }),
              (value) => value.unregister(),
            );
            if (registration === undefined || stopped) return;
            await activated(registration, abort.signal);
            passed(
              id,
              `${type} Service Worker registered and activated in a private scope; deployment control unverified`,
            );
          } catch (error) {
            set(failure(id, error));
          }
        })(),
      );
    }
  }

  const completed = await bounded(Promise.all(work), timeoutMs);
  if (!completed) {
    for (const check of checks.values()) {
      if (check.status === 'incomplete' && check.reason.endsWith('operation not completed'))
        set({
          ...check,
          reason: `${check.id}: probe deadline expired; operation and cause not established`,
        });
    }
  }
  cleanupUntil = Date.now() + timeoutMs;
  stopped = true;
  abort.abort();
  worker?.terminate();
  port?.port1.close();
  port?.port2.close();
  broadcast?.close();
  const cleaned = await bounded(
    Promise.all([
      ...pendingEffects,
      ...owned.map(async (dispose) => {
        try {
          await dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }),
    ]),
    timeoutMs,
  );
  const cleanup: SandboxSupportCheck = !cleaned
    ? {
        id: 'cleanup',
        status: 'incomplete',
        reason:
          'Cleanup deadline expired; pending native effects retain late cleanup, removal not yet established',
      }
    : cleanupErrors.length > 0
      ? failure(
          'cleanup',
          new AggregateError(
            cleanupErrors,
            // Keep each native name/message: the aggregate is the only place the caller sees them.
            `Cleanup failed: ${cleanupErrors.map((error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))).join('; ')}`,
          ),
        )
      : {
          id: 'cleanup',
          status: 'passed',
          reason: 'Probe Workers/ports/channels terminated and every owned native resource removed',
        };
  const snapshot = Object.freeze(
    [...checks.values()].map((check) =>
      Object.freeze({
        ...check,
        ...(check.error === undefined ? {} : { error: Object.freeze({ ...check.error }) }),
      }),
    ),
  );
  return Object.freeze({
    checkedAt: Date.now(),
    checks: snapshot,
    modes: modes(snapshot, selected),
    cleanup: Object.freeze(cleanup),
    limits: LIMITS,
  });
}

/** ADR-0428's interval; the last one is reserved so a terminal lock is reported, not timed out. */
const CONTENTION_POLL_MS = 25;

/**
 * ADR-0428's platform fact at the probe's own boundary (ADR-0439): terminate() may leave the
 * Worker's sync access handle busy briefly, so the first removal can still meet that lock. Wait it
 * out inside the caller's cleanup deadline; a lock outliving it stays an explicit cleanup failure.
 */
async function removeScratch(
  root: FileSystemDirectoryHandle,
  name: string,
  deadline: () => number,
): Promise<void> {
  for (;;) {
    try {
      await root.removeEntry(name, { recursive: true });
      return;
    } catch (error) {
      if ((error as { name?: string })?.name !== 'NoModificationAllowedError') throw error;
      if (Date.now() + CONTENTION_POLL_MS >= deadline()) throw error;
      await new Promise((resolve) => setTimeout(resolve, CONTENTION_POLL_MS));
    }
  }
}

async function bounded(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function activated(registration: ServiceWorkerRegistration, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    const finish = (error?: Error): void => {
      worker?.removeEventListener('statechange', changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const changed = (): void => {
      if (worker?.state === 'activated') finish();
      else if (!worker || worker.state === 'redundant')
        finish(new Error('Disposable Service Worker activation failed; cause unknown'));
    };
    const aborted = (): void =>
      finish(new Error('Service Worker activation not completed before deadline'));
    worker?.addEventListener('statechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else changed();
  });
}
