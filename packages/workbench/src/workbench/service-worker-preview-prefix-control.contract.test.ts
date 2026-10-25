/** Candidate I5 Contract+RED; native stale-controller oracle: PR316 configuration probe. */
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proveRiftyServiceWorkerControl } from './service-worker-control.ts';

class BoundaryWorker {
  reply: MessagePort | undefined;
  postMessage(_message: unknown, transfer: Transferable[]) {
    const reply = transfer[0];
    if (!(reply instanceof MessagePort)) throw new Error('Expected native reply port');
    this.reply = reply;
  }
}
class BoundaryContainer extends EventTarget {
  controller: BoundaryWorker | null = new BoundaryWorker();
}
const nativeMessageChannel = globalThis.MessageChannel;
const channels: MessageChannel[] = [];
const aborts: AbortController[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'MessageChannel',
    class extends nativeMessageChannel {
      constructor() {
        super();
        channels.push(this);
      }
    },
  );
});
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort('test cleanup');
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.unstubAllGlobals();
});

function begin(previewPrefix?: string) {
  const callbacks = new Map<number, () => void>();
  let timerCount = 0;
  const container = new BoundaryContainer();
  const abort = new AbortController();
  aborts.push(abort);
  const timers = {
    setTimeout(callback: () => void, _delay: number) {
      const id = ++timerCount;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      callbacks.delete(id);
    },
  };
  const options = {
    container,
    timers,
    timeoutMs: 1000,
    signal: abort.signal,
    ...(previewPrefix === undefined ? {} : { previewPrefix }),
  };
  const proof = proveRiftyServiceWorkerControl(options);
  let outcome = 'pending';
  void proof.then(
    () => {
      outcome = 'resolved';
    },
    () => {
      outcome = 'rejected';
    },
  );
  return {
    proof,
    container,
    state: () => outcome,
    expire() {
      for (const callback of [...callbacks.values()]) callback();
    },
    pendingTimers: () => callbacks.size,
    createdTimers: () => timerCount,
  };
}
async function deliver(worker: BoundaryWorker | null, frame: unknown) {
  const reply = worker?.reply;
  const channel = channels.find((channel) => channel.port2 === reply);
  if (reply === undefined || channel === undefined) throw new Error('Missing native proof channel');
  const delivered = new Promise<void>((resolve) =>
    channel.port1.addEventListener('message', () => resolve(), { once: true }),
  );
  reply.postMessage(frame);
  await delivered;
  await Promise.resolve();
}
function pong(previewPrefix?: string) {
  return {
    type: SW_PONG,
    from: 'service-worker',
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
    ...(previewPrefix === undefined ? {} : { previewPrefix }),
  };
}

describe('I5 actual-controller prefix proof', () => {
  it('accepts matching explicit configuration on the correlated native port', async () => {
    const h = begin('/sandbox/p/');
    await deliver(h.container.controller, pong('/sandbox/p/'));
    await expect(h.proof).resolves.toBeUndefined();
    expect(h.pendingTimers()).toBe(0);
  });

  it.each(['/preview/', '/sandbox/other/', undefined])(
    'never admits selected prefix from same-version PONG %j',
    async (actual) => {
      const h = begin('/sandbox/p/');
      await deliver(h.container.controller, pong(actual));
      expect(h.state()).toBe('pending');
      h.expire();
      await expect(h.proof).rejects.toThrow(/PONG/);
    },
  );

  it('follows controllerchange after a stale configuration without creating another deadline', async () => {
    const h = begin('/sandbox/p/');
    await deliver(h.container.controller, pong('/preview/'));
    expect(h.state()).toBe('pending');
    h.container.controller = new BoundaryWorker();
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.pendingTimers()).toBe(1);
    expect(h.createdTimers()).toBe(1);
    await deliver(h.container.controller, pong('/sandbox/p/'));
    await expect(h.proof).resolves.toBeUndefined();
    expect(h.pendingTimers()).toBe(0);
  });

  it('keeps missing optional PONG configuration equal to the old default', async () => {
    const h = begin();
    await deliver(h.container.controller, pong());
    await expect(h.proof).resolves.toBeUndefined();
  });

  it('absence never silently adopts a controller configured with another prefix', async () => {
    const h = begin();
    await deliver(h.container.controller, pong('/sandbox/p/'));
    expect(h.state()).toBe('pending');
    h.expire();
    await expect(h.proof).rejects.toThrow(/PONG/);
  });

  it('malformed prefix values cannot stand in for the absent optional default', async () => {
    for (const previewPrefix of [null, false, 17]) {
      const h = begin();
      await deliver(h.container.controller, { ...pong(), previewPrefix });
      expect(h.state()).toBe('pending');
      h.expire();
      await expect(h.proof).rejects.toThrow(/PONG/);
    }
  });

  it('retains routing-version refusal even when prefix matches', async () => {
    const h = begin('/sandbox/p/');
    await deliver(h.container.controller, {
      ...pong('/sandbox/p/'),
      routingVersion: 'stale-routing',
    });
    expect(h.state()).toBe('pending');
    h.expire();
    await expect(h.proof).rejects.toThrow(/PONG/);
  });
});
