/**
 * Declared difference, in-process host (Node's own `EventTarget`): Node's `addAbortListener` passes
 * its internal `kResistStopPropagation`, rifty's cannot, so an earlier listener's
 * `stopImmediatePropagation()` hides the abort from it. Pinned against live Node; owner
 * backlog runtime-js/stream-core-abort-listeners-host-event-target. Browser hosts: node-file row
 * `events-add-abort-listener-stop-propagation`.
 */
import { addAbortListener as nodeAddAbortListener } from 'node:events';
import { describe, expect, it } from 'vitest';
import { addAbortListener } from './events.ts';

function afterStoppingListener(add: typeof addAbortListener): string[] {
  const seen: string[] = [];
  const ac = new AbortController();
  ac.signal.addEventListener('abort', (event) => {
    seen.push('first: stopImmediatePropagation');
    event.stopImmediatePropagation();
  });
  add(ac.signal, () => seen.push('addAbortListener: ran'));
  ac.signal.addEventListener('abort', () => seen.push('later addEventListener: ran'));
  ac.abort();
  return seen;
}

describe('events.addAbortListener after a listener that stops propagation', () => {
  it('Node runs it; rifty does not (pinned)', () => {
    expect(afterStoppingListener(nodeAddAbortListener)).toEqual([
      'first: stopImmediatePropagation',
      'addAbortListener: ran',
    ]);
    expect(afterStoppingListener(addAbortListener)).toEqual(['first: stopImmediatePropagation']);
  });
});
