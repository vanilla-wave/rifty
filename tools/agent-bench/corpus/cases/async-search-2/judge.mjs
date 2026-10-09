import assert from 'node:assert/strict';
import { createController } from './src/search-controller.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let rows = [
  { id: 'a', name: 'Alpha', value: 30 },
  { id: 'b', name: 'Beta', value: 20 },
  { id: 'c', name: 'Gamma', value: 10 },
];
let failNext = false;
// Controlled external data/clock boundary; controller and Node primitives are real.
const client = {
  async search(q) {
    const captured = structuredClone(rows);
    await wait(q.filter === 'Alpha' ? 70 : 5);
    const matched = captured.filter((r) => r.name.includes(q.filter));
    matched.sort(
      q.sort === 'value-desc'
        ? (a, b) => b.value - a.value
        : (a, b) => a.name.localeCompare(b.name),
    );
    return {
      items: matched.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: matched.length,
    };
  },
  async update(id, patch) {
    await wait(25);
    if (failNext) {
      failNext = false;
      throw Error('Service unavailable');
    }
    rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    return structuredClone(rows.find((r) => r.id === id));
  },
};
const c = createController(client);
const slow = c.search({ filter: 'Alpha', page: 1, pageSize: 1, sort: 'name-asc' });
const fast = c.search({ filter: '', page: 2, pageSize: 1, sort: 'value-desc' });
await Promise.all([slow, fast]);
assert.equal(c.state().query.page, 2);
assert.deepEqual(
  c.state().items.map((r) => r.id),
  ['b'],
);
assert.equal(c.state().total, 3);
assert.equal(c.state().pending, false);
c.select('a');
await c.search({ filter: 'Alpha', page: 1, pageSize: 1, sort: 'name-asc' });
assert.deepEqual(c.state().selectedIds, ['a']);
await c.back();
assert.equal(c.state().query.page, 2);
assert.deepEqual(
  c.state().items.map((r) => r.id),
  ['b'],
);
const restored = createController(client);
restored.restoreJson(c.exportJson());
assert.deepEqual(restored.state().query, c.state().query);
assert.deepEqual(restored.state().selectedIds, ['a']);

await c.search({ filter: '', page: 1, pageSize: 5, sort: 'name-asc' });
failNext = true;
const failed = c.update('b', { value: 99 });
assert.equal(c.state().items.find((r) => r.id === 'b').value, 99);
await assert.rejects(failed, /Service unavailable/);
assert.equal(c.state().items.find((r) => r.id === 'b').value, 20);
assert.deepEqual(c.state().selectedIds, ['a']);
await c.retry();
assert.equal(c.state().items.find((r) => r.id === 'b').value, 99);
const reload = createController(client);
reload.restoreJson(c.exportJson());
await reload.undo();
assert.equal(rows.find((r) => r.id === 'b').value, 20);
const stale = c.search({ filter: 'Alpha', page: 1, pageSize: 5, sort: 'name-asc' });
await c.search({ filter: '', page: 1, pageSize: 5, sort: 'name-asc' });
await c.update('b', { value: 77 });
await stale;
assert.equal(c.state().items.find((r) => r.id === 'b').value, 77);

console.log('RIFTY_CORPUS_PASS:async-search-2');
