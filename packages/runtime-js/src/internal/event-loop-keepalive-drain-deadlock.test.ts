/**
 * Regression test: awaitDrain must not self-deadlock when global setTimeout is
 * the keepalive-refcounted wrapper installed by installTimerGlobals().
 *
 * Isolated in its own file so the global timer swap does not pollute other
 * keepalive tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installTimerGlobals } from '../builtins/timers.ts';
import { awaitDrain, resetKeepalive } from './event-loop-keepalive.ts';

afterEach(() => resetKeepalive());

describe('awaitDrain does not self-deadlock on wrapped global setTimeout', () => {
  it('drains setTimeout-scheduled work via the host poll (no cap hang)', async () => {
    installTimerGlobals(); // global setTimeout is now the keepalive-refcounted wrapper
    // a user timer is the ONLY ref; it fires after 10ms then unrefs
    const userTimer = globalThis.setTimeout(() => {}, 10);
    // default scheduler (host setTimeout) must let the drain see refCount→0 once the
    // user timer fires — with a small cap, a self-deadlock would REJECT instead.
    await expect(awaitDrain({ capMs: 500 })).resolves.toBeUndefined();
    globalThis.clearTimeout(userTimer);
  });
});
