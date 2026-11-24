/**
 * The guest's `node:child_process` and `node:worker_threads` (ADR-0557 §6,
 * 2026-11-24): Node v24.16.0's export lists in their order. Real: the main
 * thread's identity (`isMainThread`, `threadId`, `parentPort`, …) and the
 * environment-data map; Node's argument error of the port members (no port can
 * exist here). Processes, workers, transfer marks, Web Locks: named gaps.
 */
import { EventEmitter } from '@riftydev/io';
import { loudAsync, loudClass, loudFunction, named } from './egress-gaps.ts';
import { nodeError } from './node-validators.ts';

const NO_PROCESS = 'no child processes in the rifty isolate host, ADR-0557';
const NO_WORKER = 'no worker threads in the rifty isolate host, ADR-0557';
const NO_CLONE =
  'no structured clone or transfer in the rifty isolate host (structuredClone, MessagePort absent), ADR-0557';
const NO_LOCKS = 'no Web Locks in the rifty isolate host (navigator.locks absent), ADR-0557';

const notAPort = (): TypeError =>
  nodeError(
    TypeError,
    'ERR_INVALID_ARG_TYPE',
    'The "port" argument must be a MessagePort instance',
  );

const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');

export function createChildProcess(): Record<string, unknown> {
  const fn = (name: string, length: number) =>
    loudFunction(name, length, `child_process.${name}`, NO_PROCESS);
  const cp: Record<string, unknown> = {
    _forkChild: fn('_forkChild', 2),
    ChildProcess: loudClass(
      'ChildProcess',
      0,
      'child_process.ChildProcess',
      EventEmitter,
      NO_PROCESS,
    ),
    exec: fn('exec', 3),
    execFile: fn('execFile', 4),
    execFileSync: fn('execFileSync', 3),
    execSync: fn('execSync', 2),
    fork: fn('fork', 1),
    spawn: fn('spawn', 3),
    spawnSync: fn('spawnSync', 3),
  };
  // Node's `util.promisify` forms: `function(...args)` calling the original.
  for (const name of ['exec', 'execFile'])
    Object.defineProperty(cp[name], promisifyCustom, { value: fn(name, 0) });
  return cp;
}

/** Web globals Node's module re-exports, as the guest defines them (ceilings, `web-shim.ts`). */
export interface PortGlobals {
  readonly MessagePort: unknown;
  readonly MessageChannel: unknown;
  readonly BroadcastChannel: unknown;
}

/** `navigator.locks`'s shape: a `LockManager` whose members are the gap. */
function lockManager(): object {
  // Node's constructor throws `new ERR_ILLEGAL_CONSTRUCTOR()` with that name unbound
  // (`lib/internal/locks.js`): V8's `TypeError`, for any argument a caller can pass.
  const LockManager = named(
    class {
      constructor() {
        throw new TypeError('ERR_ILLEGAL_CONSTRUCTOR is not a constructor');
      }
    },
    'LockManager',
    0,
  );
  const proto = LockManager.prototype as Record<PropertyKey, unknown>;
  const method = { writable: true, enumerable: true, configurable: true };
  Object.defineProperties(proto, {
    request: {
      ...method,
      value: loudAsync('request', 2, 'worker_threads.locks.request', NO_LOCKS),
    },
    query: { ...method, value: loudAsync('query', 0, 'worker_threads.locks.query', NO_LOCKS) },
    [Symbol.toStringTag]: { value: 'LockManager', configurable: true },
  });
  return Object.create(proto);
}

export function createWorkerThreads(ports: PortGlobals): Record<string, unknown> {
  const environmentData = new Map<unknown, unknown>();
  const fn = (name: string, length: number, hint: string) =>
    loudFunction(name, length, `worker_threads.${name}`, hint);
  return {
    isInternalThread: false,
    isMainThread: true,
    MessagePort: ports.MessagePort,
    MessageChannel: ports.MessageChannel,
    markAsUncloneable: fn('markAsUncloneable', 1, NO_CLONE),
    markAsUntransferable: fn('markAsUntransferable', 1, NO_CLONE),
    isMarkedAsUntransferable: fn('isMarkedAsUntransferable', 1, NO_CLONE),
    // Node's native members: no port exists in the guest, so every call is Node's
    // argument error (`moveMessagePortToContext` has no `prototype`).
    moveMessagePortToContext: named(
      (): never => {
        throw notAPort();
      },
      'moveMessagePortToContext',
      0,
    ),
    receiveMessageOnPort: named(function receiveMessageOnPort(_port: unknown): never {
      throw notAPort();
    }, 'receiveMessageOnPort'),
    resourceLimits: {},
    postMessageToThread: loudAsync(
      'postMessageToThread',
      4,
      'worker_threads.postMessageToThread',
      NO_WORKER,
    ),
    threadId: 0,
    threadName: '',
    SHARE_ENV: Symbol.for('nodejs.worker_threads.SHARE_ENV'),
    Worker: loudClass('Worker', 1, 'worker_threads.Worker', EventEmitter, NO_WORKER, true),
    parentPort: null,
    workerData: null,
    BroadcastChannel: ports.BroadcastChannel,
    setEnvironmentData: named(function setEnvironmentData(key: unknown, value: unknown): void {
      if (value === undefined) environmentData.delete(key);
      else environmentData.set(key, value);
    }, 'setEnvironmentData'),
    getEnvironmentData: named(function getEnvironmentData(key: unknown): unknown {
      return environmentData.get(key);
    }, 'getEnvironmentData'),
    locks: lockManager(),
  };
}
