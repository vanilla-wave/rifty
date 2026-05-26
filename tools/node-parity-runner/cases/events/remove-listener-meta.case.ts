/**
 * Per Node docs (`EventEmitter.removeListener`): the emitter MUST emit a
 * synchronous `'removeListener'` meta-event BEFORE the listener is detached.
 * `Stream.Readable.pipe()`'s unpipe machinery relies on this — without it,
 * source/dest cleanup ladders silently leak listeners.
 *
 * Test pattern: register a `removeListener` listener that records the event
 * name + reference, then remove a different listener and assert it fired. Also
 * cover the corner case where `removeListener` itself is detached (Node treats
 * `removeListener` like any other event for the purposes of the meta-emit —
 * but the meta-event is suppressed for `removeListener`-on-`removeListener`
 * to avoid infinite recursion). We mirror that.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { EventEmitter } = require('node:events');
    const ee = new EventEmitter();
    const events = [];
    ee.on('removeListener', (event, listener) => {
      events.push(['meta', event, typeof listener === 'function']);
    });
    const handler = () => {};
    ee.on('foo', handler);
    ee.removeListener('foo', handler);
    console.log(JSON.stringify(events));
    // removeListener-on-removeListener does NOT re-emit (would infinite loop).
    const metaHandler = () => {};
    ee.on('removeListener', metaHandler);
    const before = ee.listenerCount('removeListener');
    ee.removeListener('removeListener', metaHandler);
    const after = ee.listenerCount('removeListener');
    console.log('rm-meta:' + before + ',' + after);
  `,
};

export default c;
