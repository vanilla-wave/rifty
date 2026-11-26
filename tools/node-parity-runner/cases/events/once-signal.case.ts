/**
 * `events.once(emitter, name, options)` (Node v24.16.0 `lib/events.js`): argument checks (an
 * async function: every throw is a rejection), `options.signal` aborted before / in the same tick /
 * in a microtask / after the event / never, the `'error'` listener, an EventTarget emitter, and no
 * listener left behind after any outcome. Not here: an earlier abort listener's
 * `stopImmediatePropagation()` — the host's `EventTarget` decides it (isolate: Node's, pinned in
 * `packages/isolate-host/tests/abort-event-target.test.ts`; browser hosts:
 * backlog runtime-js/stream-core-abort-listeners-host-event-target).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { EventEmitter, once } = require('node:events');
    const log = (s) => console.log(s);
    const label = (e) =>
      e instanceof Error
        ? e.constructor.name + '|' + e.name + '|' + e.code + '|' + e.message +
          (e.cause !== undefined ? '|cause=' + (e.cause instanceof Error ? e.cause.name : String(e.cause)) : '')
        : 'non-error ' + String(e);
    const counts = (ee) => 'x=' + ee.listenerCount('x') + ' error=' + ee.listenerCount('error');
    const settle = (p) => p.then((v) => 'resolved ' + JSON.stringify(v), (e) => 'rejected ' + label(e));
    const turn = () => new Promise((r) => setTimeout(r, 0));

    (async () => {
      log('length=' + once.length + ' name=' + once.name);
      for (const [name, args] of [
        ['emitter number', [1, 'x']],
        ['emitter object', [{}, 'x']],
        ['options null', [new EventEmitter(), 'x', null]],
        ['options array', [new EventEmitter(), 'x', []]],
        ['options string', [new EventEmitter(), 'x', 'o']],
        ['signal null', [new EventEmitter(), 'x', { signal: null }]],
        ['signal number', [new EventEmitter(), 'x', { signal: 1 }]],
        ['signal plain object', [new EventEmitter(), 'x', { signal: {} }]],
      ]) {
        let p;
        try {
          p = once(...args);
        } catch (e) {
          log(name + ': threw ' + label(e));
          continue;
        }
        log(name + ': ' + (await settle(p)));
      }

      // Aborted before the call: rejected, nothing registered.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        ac.abort('before');
        log('before: ' + (await settle(once(ee, 'x', { signal: ac.signal }))) + ' ' + counts(ee));
        const ee2 = new EventEmitter();
        log('before default reason: ' + (await settle(once(ee2, 'x', { signal: AbortSignal.abort() }))));
      }
      // Aborted in the same tick, then the event: rejected, listeners removed.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = settle(once(ee, 'x', { signal: ac.signal }));
        log('same tick: registered ' + counts(ee));
        ac.abort(new Error('now'));
        ee.emit('x', 1);
        log('same tick: ' + (await p) + ' ' + counts(ee));
      }
      // Aborted in a microtask.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = settle(once(ee, 'x', { signal: ac.signal }));
        queueMicrotask(() => ac.abort());
        log('microtask: ' + (await p) + ' ' + counts(ee));
      }
      // The event first, then abort: resolved, the abort has no effect.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = settle(once(ee, 'x', { signal: ac.signal }));
        ee.emit('x', 'a', 2);
        ac.abort();
        log('event first: ' + (await p) + ' ' + counts(ee));
      }
      // Never aborted: resolved by the event.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = settle(once(ee, 'x', { signal: ac.signal }));
        setTimeout(() => ee.emit('x', 'later'), 1);
        log('never: ' + (await p) + ' ' + counts(ee));
      }
      // 'error' before the event: rejected with it; with a signal, the abort listener goes too.
      {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = settle(once(ee, 'x', { signal: ac.signal }));
        ee.emit('error', new Error('boom'));
        log('error: ' + (await p) + ' ' + counts(ee));
        ac.abort();
        await turn();
        log('error then abort: done');
      }
      // once(ee, 'error'): resolved with the error, no extra 'error' listener.
      {
        const ee = new EventEmitter();
        const p = settle(once(ee, 'error'));
        log('name error: registered ' + counts(ee));
        ee.emit('error', new Error('E'));
        log('name error: ' + (await p).slice(0, 18) + ' ' + counts(ee));
      }
      // An EventTarget emitter: the Event; with a signal.
      {
        const et = new EventTarget();
        const p = once(et, 'x');
        et.dispatchEvent(new Event('x'));
        const [event] = await p;
        log('EventTarget: ' + event.type + ' ' + (event instanceof Event));
        const ac = new AbortController();
        const q = settle(once(et, 'y', { signal: ac.signal }));
        ac.abort('stop');
        log('EventTarget aborted: ' + (await q));
      }
      log('end');
    })();
  `,
};

export default c;
