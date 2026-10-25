import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import pLimit, { limitFunction } from './index.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const guard = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Unsettled queue promise')), 1500),
    ),
  ]);
// Retained test.js: validation, concurrency/counts/changes, values/args/errors and ALS.
for (const bad of [0, -1, 1.2, undefined, true]) assert.throws(() => pLimit(bad));
let active = 0;
let max = 0;
const limit = pLimit(2);
assert.deepEqual(
  await Promise.all(
    [1, 2, 3, 4].map((value) =>
      limit(async () => {
        active++;
        max = Math.max(max, active);
        await tick();
        active--;
        return value;
      }),
    ),
  ),
  [1, 2, 3, 4],
);
assert.equal(max, 2);
assert.equal(limit.activeCount, 0);
assert.equal(limit.pendingCount, 0);
assert.equal(await limit((value) => value, Symbol.for('argument')), Symbol.for('argument'));
const error = new Error('same error');
await assert.rejects(
  limit(() => {
    throw error;
  }),
  (e) => e === error,
);
assert.equal(await limit(() => 7), 7);
const store = new AsyncLocalStorage();
await Promise.all(
  [1, 2, 3].map((id) =>
    store.run({ id }, () =>
      limit(async () => {
        await tick();
        assert.equal(store.getStore().id, id);
      }),
    ),
  ),
);
limit.concurrency = 1;
assert.equal(limit.concurrency, 1);
assert.throws(() => {
  limit.concurrency = 0;
});
let wrappedActive = 0;
let wrappedPeak = 0;
const wrapped = limitFunction(
  async (value) => {
    wrappedActive++;
    wrappedPeak = Math.max(wrappedPeak, wrappedActive);
    await tick();
    wrappedActive--;
    return value * 2;
  },
  { concurrency: 1 },
);
assert.deepEqual(await Promise.all([2, 3, 4].map(wrapped)), [4, 6, 8]);
assert.equal(wrappedPeak, 1);
let release;
const legacy = pLimit(1);
const running = legacy(
  () =>
    new Promise((resolve) => {
      release = resolve;
    }),
);
await tick();
let called = false;
let settled = false;
legacy(() => {
  called = true;
}).then(
  () => {
    settled = true;
  },
  () => {
    settled = true;
  },
);
legacy.clearQueue();
assert.equal(legacy.pendingCount, 0);
release();
await running;
await tick();
assert.equal(called, false);
assert.equal(settled, false);
// Deterministic ports of upstream concurrency-change/count tests; no perf-window threshold.
const changing = pLimit(1);
let releaseInitial;
const firstChange = changing(
  () =>
    new Promise((resolve) => {
      releaseInitial = resolve;
    }),
);
await tick();
let currentRuns = 0;
let peak = 0;
const changed = Array.from({ length: 8 }, () =>
  changing(async () => {
    currentRuns++;
    peak = Math.max(peak, currentRuns);
    await tick();
    currentRuns--;
  }),
);
assert.equal(changing.activeCount, 1);
assert.equal(changing.pendingCount, 8);
changing.concurrency = 3;
await tick();
assert.equal(changing.concurrency, 3);
assert.ok(changing.activeCount <= 3 && changing.activeCount > 1);
releaseInitial();
await firstChange;
await Promise.all(changed);
assert.ok(peak >= 2 && peak <= 3);
assert.equal(changing.activeCount, 0);
assert.equal(changing.pendingCount, 0);
const shrinking = pLimit(3);
const frees = [];
const holds = Array.from({ length: 3 }, () =>
  shrinking(() => new Promise((resolve) => frees.push(resolve))),
);
await tick();
assert.equal(shrinking.activeCount, 3);
shrinking.concurrency = 1;
let resumed = 0;
const follow = shrinking(() => {
  resumed++;
});
frees[0]();
await tick();
assert.equal(resumed, 0);
frees[1]();
await tick();
assert.equal(resumed, 0);
frees[2]();
await Promise.all(holds);
await follow;
assert.equal(resumed, 1);

// New opt-in clear behavior; active work survives and every queued promise settles.
let unblock;
const next = pLimit({ concurrency: 1, rejectOnClear: true });
const first = next(
  () =>
    new Promise((resolve) => {
      unblock = resolve;
    }),
);
await tick();
let invoked = 0;
const waiting = Array.from({ length: 3 }, () =>
  next(() => {
    invoked++;
    return 9;
  }),
);
const outcomes = Promise.allSettled(waiting);
assert.equal(next.pendingCount, 3);
next.clearQueue();
assert.equal(next.pendingCount, 0);
next.clearQueue();
for (const outcome of await guard(outcomes)) {
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.reason.name, 'AbortError');
}
assert.equal(next.activeCount, 1);
assert.equal(invoked, 0);
unblock(4);
assert.equal(await first, 4);
assert.equal(await next(() => 6), 6);
console.log('RIFTY_CORPUS_PASS:queue-clear');
