import assert from 'node:assert/strict';
import { createController } from './src/search-controller.mjs';
function selectionMembership(state) {
  const ids = state.selectedIds;
  assert.ok(ids && typeof ids !== 'string' && typeof ids[Symbol.iterator] === 'function');
  return [...new Set(ids)].sort();
}
function stateItems(state) {
  return [...state.items];
}
for (const selectedId of ['a', 'c']) {
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
    stateItems(c.state()).map((r) => r.id),
    ['b'],
  );
  assert.equal(c.state().total, 3);
  assert.equal(c.state().pending, false);
  c.select(selectedId);
  await c.search({ filter: 'Alpha', page: 1, pageSize: 1, sort: 'name-asc' });
  assert.deepEqual(selectionMembership(c.state()), [selectedId]);
  assert.deepEqual(
    stateItems(c.state()).map((r) => r.id),
    ['a'],
  );
  assert.equal(c.state().total, 1);
  await c.back();
  assert.equal(c.state().query.page, 2);
  assert.deepEqual(
    stateItems(c.state()).map((r) => r.id),
    ['b'],
  );
  const restored = createController(client);
  restored.restoreJson(c.exportJson());
  assert.deepEqual(restored.state().query, c.state().query);
  assert.deepEqual(selectionMembership(restored.state()), [selectedId]);
  // The external data changes: name order must not accidentally equal value order.
  rows = rows.map((r) => (r.id === 'a' ? { ...r, value: 5 } : r));
  await c.search({ filter: '', page: 1, pageSize: 3, sort: 'value-desc' });
  assert.deepEqual(
    stateItems(c.state()).map((r) => r.id),
    ['b', 'c', 'a'],
  );
  rows = rows.map((r) => (r.id === 'a' ? { ...r, value: 30 } : r));

  await c.search({ filter: '', page: 1, pageSize: 5, sort: 'name-asc' });
  const publicState = (s) => ({
    query: s.query && {
      filter: s.query.filter,
      page: s.query.page,
      pageSize: s.query.pageSize,
      sort: s.query.sort,
    },
    items: stateItems(s).map(({ id, name, value }) => ({ id, name, value })),
    total: s.total,
    pending: s.pending,
    selectedIds: selectionMembership(s),
  });
  const beforeFailure = structuredClone(publicState(c.state()));
  failNext = true;
  const failed = c.update('b', { value: 99 });
  assert.equal(stateItems(c.state()).find((r) => r.id === 'b').value, 99);
  try {
    await failed;
  } catch {}
  assert.deepEqual(publicState(c.state()), beforeFailure);
  assert.equal(stateItems(c.state()).find((r) => r.id === 'b').value, 20);
  assert.deepEqual(selectionMembership(c.state()), [selectedId]);
  await c.retry();
  assert.equal(stateItems(c.state()).find((r) => r.id === 'b').value, 99);
  const reload = createController(client);
  reload.restoreJson(c.exportJson());
  await reload.undo();
  assert.equal(rows.find((r) => r.id === 'b').value, 20);
  const stale = c.search({ filter: 'Alpha', page: 1, pageSize: 5, sort: 'name-asc' });
  await c.search({ filter: '', page: 1, pageSize: 5, sort: 'name-asc' });
  await c.update('b', { value: 77 });
  await stale;
  assert.equal(stateItems(c.state()).find((r) => r.id === 'b').value, 77);
}
console.log('RIFTY_CORPUS_PASS:async-search-2');
