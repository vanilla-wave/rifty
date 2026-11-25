/**
 * `events.addAbortListener(signal, listener)` (Node ≥ 20.5, `lib/internal/events/abort_listener.js`):
 * argument checks, an already-aborted signal (listener in a microtask, no arguments, even after
 * dispose), a later abort (once, Event argument, `this` = signal), the `Disposable` it returns,
 * order among other abort listeners. Not here: an earlier listener's `stopImmediatePropagation()`
 * (host `EventTarget` difference, backlog runtime-js/stream-core-abort-listeners-host-event-target).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const events = require('node:events');
    const { addAbortListener } = events;
    const log = (s) => console.log(s);
    const label = (e) =>
      e instanceof Error
        ? (e instanceof TypeError ? 'TypeError' : 'Error') + '|' + e.name + '|' + e.code + '|' + e.message
        : 'non-error ' + String(e);
    const turn = () => new Promise((r) => setTimeout(r, 0));

    (async () => {
      log('typeof=' + typeof addAbortListener);
      if (typeof addAbortListener !== 'function') return;
      log('length=' + addAbortListener.length + ' name=' + addAbortListener.name);
      log('on EventEmitter=' + (events.EventEmitter.addAbortListener === addAbortListener));
      const desc = Object.getOwnPropertyDescriptor(events, 'addAbortListener');
      log('descriptor=' + [desc.writable, desc.enumerable, desc.configurable].join(','));

      // Arguments: the signal is checked before the listener.
      for (const [name, args] of [
        ['no args', []],
        ['signal undefined', [undefined, () => {}]],
        ['signal null', [null, () => {}]],
        ['signal string', ['abc', () => {}]],
        ['signal number', [1, () => {}]],
        ['signal plain object', [{}, () => {}]],
        ['signal function', [function sig() {}, () => {}]],
        ['both bad', [{}, 'x']],
        ['listener undefined', [new AbortController().signal]],
        ['listener null', [new AbortController().signal, null]],
        ['listener object', [new AbortController().signal, {}]],
        ['listener string', [new AbortController().signal, 'fn']],
        ['listener handleEvent object', [new AbortController().signal, { handleEvent() {} }]],
        ['signal-shaped without addEventListener', [{ aborted: false }, () => {}]],
      ]) {
        try {
          const d = addAbortListener(...args);
          log(name + ': returned ' + typeof d);
        } catch (e) {
          log(name + ': ' + label(e));
        }
      }

      // Already aborted: queued as a microtask at registration, after sync code, no arguments.
      {
        const ac = new AbortController();
        ac.abort('why');
        queueMicrotask(() => log('pre: microtask queued before'));
        const d = addAbortListener(ac.signal, function (...args) {
          log('pre: listener this=' + (this === globalThis ? 'globalThis' : String(this)) +
            ' args=' + args.length + ' reason=' + ac.signal.reason);
        });
        queueMicrotask(() => log('pre: microtask queued after'));
        log('pre: sync after register');
        log('pre: proto=' + Object.getPrototypeOf(d) + ' keys=' + Reflect.ownKeys(d).map(String).join(','));
        log('pre: dispose type=' + typeof d[Symbol.dispose] + ' returns=' + d[Symbol.dispose]());
        await turn();
      }

      // Already aborted, disposed before the microtask: the listener still runs (Node removes nothing).
      {
        const ac = new AbortController();
        ac.abort();
        const d = addAbortListener(ac.signal, () => log('pre-dispose: listener ran'));
        d[Symbol.dispose]();
        log('pre-dispose: disposed');
        await turn();
      }

      // A signal-shaped object already "aborted": no addEventListener needed.
      {
        const d = addAbortListener({ aborted: true }, () => log('shaped: listener ran'));
        log('shaped: returned ' + typeof d[Symbol.dispose]);
        await turn();
      }

      // Abort after registration: the Event, this = signal, reason; synchronous inside abort().
      {
        const ac = new AbortController();
        addAbortListener(ac.signal, function (event) {
          log('post: listener this=signal:' + (this === ac.signal) + ' args=' + arguments.length +
            ' type=' + event.type + ' isEvent=' + (event instanceof Event) +
            ' target=signal:' + (event.target === ac.signal) + ' reason=' + ac.signal.reason.message);
        });
        log('post: before abort');
        ac.abort(new Error('boom'));
        log('post: after abort');
        ac.abort();
        await turn();
      }

      // Once: a dispatched 'abort' Event consumes it; the real abort does not run it again.
      {
        const ac = new AbortController();
        let n = 0;
        addAbortListener(ac.signal, () => log('once: run ' + ++n));
        ac.signal.dispatchEvent(new Event('abort'));
        ac.abort();
        log('once: total ' + n);
      }

      // Dispose before abort: never runs; dispose twice and after abort are fine.
      {
        const ac = new AbortController();
        const d = addAbortListener(ac.signal, () => log('dispose: listener ran'));
        d[Symbol.dispose]();
        d[Symbol.dispose]();
        ac.abort();
        const d2 = addAbortListener(ac.signal, () => {});
        const ac2 = new AbortController();
        const d3 = addAbortListener(ac2.signal, () => log('dispose: d3 ran'));
        ac2.abort();
        d3[Symbol.dispose]();
        log('dispose: done ' + typeof d2);
        await turn();
      }

      // Order among the signal's other abort listeners: registration order.
      {
        const ac = new AbortController();
        ac.signal.addEventListener('abort', () => log('order: addEventListener 1'));
        addAbortListener(ac.signal, () => log('order: addAbortListener A'));
        ac.signal.onabort = () => log('order: onabort');
        addAbortListener(ac.signal, () => log('order: addAbortListener B'));
        ac.signal.addEventListener('abort', () => log('order: addEventListener 2'));
        ac.abort();
      }

      // The same function twice: EventTarget keeps one; either dispose removes it.
      {
        const ac = new AbortController();
        const fn = () => log('same: ran');
        const d1 = addAbortListener(ac.signal, fn);
        addAbortListener(ac.signal, fn);
        ac.abort();
        const ac2 = new AbortController();
        const e1 = addAbortListener(ac2.signal, fn);
        addAbortListener(ac2.signal, fn);
        e1[Symbol.dispose]();
        ac2.abort();
        log('same: done ' + typeof d1);
      }

      // AbortSignal.abort() and AbortSignal.timeout(0).
      {
        addAbortListener(AbortSignal.abort('static'), () => log('static: ran'));
        const t = AbortSignal.timeout(1);
        addAbortListener(t, (event) => log('timeout: ran ' + event.type + ' ' + t.reason.name));
        await new Promise((r) => setTimeout(r, 20));
      }
      log('end');
    })();
  `,
};

export default c;
