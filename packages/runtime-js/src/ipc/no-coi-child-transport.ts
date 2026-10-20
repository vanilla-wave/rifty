import { NotImplementedError } from '@riftydev/io';
import {
  type KernelSyncApi,
  decodeReply,
  decodeRequest,
  encodeBinaryReply,
  encodeBinaryRequest,
  encodeReply,
  encodeRequest,
  getKernelDispatcher,
} from '@riftydev/kernel';
import { syncMirror } from '@riftydev/vfs';
import { serializeRuntimeError } from '../worker-fs-rpc.ts';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';

export const NO_COI_CHILD_NAME = 'rifty-no-coi-node-child/v1';
export interface NoCoiChildTransport {
  readonly endpoint: string;
  readonly workerUrl: string;
}
let transport: NoCoiChildTransport | null = null;
const callers = new Map<string, { callerPid: number }>();

export function openNoCoiChildRoute(inherited: boolean): {
  transport: NoCoiChildTransport;
  context: { callerPid: number };
  close(): void;
} {
  const base = noCoiChildTransport();
  const context = { callerPid: 0 };
  if (inherited) return { transport: base, context, close() {} };
  const token = crypto.randomUUID();
  const endpoint = new URL(base.endpoint);
  endpoint.searchParams.set('caller', token);
  callers.set(token, context);
  return {
    transport: { ...base, endpoint: endpoint.href },
    context,
    close: () => {
      callers.delete(token);
    },
  };
}

export function setNoCoiChildTransport(value: NoCoiChildTransport): void {
  transport = value;
}

export function noCoiChildTransport(): NoCoiChildTransport {
  if (transport === null)
    throw new NotImplementedError(
      'child_process.spawn.service-worker',
      'no-COI Node children require a controlling rifty Service Worker',
    );
  return transport;
}

/** The owner serves its current policy-wrapped FS, never a snapshot. */
export function installNoCoiChildFsOwner(target: EventTarget): void {
  target.addEventListener('message', ((event: MessageEvent) => {
    if (event.data?.type !== 'no-coi-child-fs-connect') return;
    const port = event.ports[0];
    if (
      !port ||
      typeof event.data.endpoint !== 'string' ||
      typeof event.data.workerUrl !== 'string'
    )
      throw new TypeError('invalid no-COI child bridge');
    setNoCoiChildTransport({ endpoint: event.data.endpoint, workerUrl: event.data.workerUrl });
    const dispatcher = getKernelDispatcher();
    installRuntimeJsFsHandlers(dispatcher, syncMirror);
    port.onmessage = async (request: MessageEvent) => {
      const reply = request.ports[0];
      if (!reply) return;
      try {
        if (!(request.data?.bytes instanceof Uint8Array))
          throw new TypeError('child FS request must be bytes');
        const caller = callers.get(request.data.caller);
        if (caller === undefined) throw new Error('child filesystem route is no longer live');
        const decoded = decodeRequest(request.data.bytes);
        const value = await dispatcher.dispatch(decoded, caller);
        reply.postMessage(
          value instanceof Uint8Array ? encodeBinaryReply(value) : encodeReply({ ok: true, value }),
        );
      } catch (error) {
        reply.postMessage(encodeReply({ ok: false, error: serializeRuntimeError(error) }));
      } finally {
        reply.close();
      }
    };
  }) as EventListener);
}

/** Native synchronous XHR blocks only this child Worker; the owner stays async. */
export function createNoCoiChildSyncApi(endpoint: string): KernelSyncApi {
  const NativeXHR = XMLHttpRequest;
  const exchange = (bytes: Uint8Array): unknown => {
    const xhr = new NativeXHR();
    xhr.open('POST', endpoint, false);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 35_000;
    xhr.send(bytes as Uint8Array<ArrayBuffer>);
    if (xhr.status !== 200)
      throw new Error(
        `child filesystem transport failed (${xhr.status}); mutation outcome unknown`,
      );
    const reply = decodeReply(new Uint8Array(xhr.response as ArrayBuffer));
    if (reply.ok) return reply.value;
    const error = reply.error ?? { name: 'Error', message: 'invalid child filesystem error reply' };
    throw Object.assign(new Error(error.message), error);
  };
  return {
    call: (method, payload) => exchange(encodeRequest({ method, payload })),
    callBinary: (method, payload) => exchange(encodeBinaryRequest(method, payload)),
  };
}
