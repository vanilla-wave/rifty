const assert = require('node:assert/strict');
const stringify = require('./index.js');
// Retained test/str.js, nested.js, cmp.js and to-json.js semantic fixtures.
assert.equal(stringify({ c: 6, b: [4, 5], a: 3, z: null }), '{"a":3,"b":[4,5],"c":6,"z":null}');
assert.equal(stringify({ a: 3, z: undefined }), '{"a":3}');
assert.equal(stringify({ a: 3, z: null }), '{"a":3,"z":null}');
assert.equal(
  stringify({ a: 3, b: Number.NaN, c: Number.POSITIVE_INFINITY }),
  '{"a":3,"b":null,"c":null}',
);
assert.equal(stringify([4, undefined, 6]), '[4,null,6]');
assert.equal(stringify({ a: 3, z: '' }), '{"a":3,"z":""}');
assert.equal(stringify([4, '', 6]), '[4,"",6]');
const nested = { c: 8, b: [{ z: 6, y: 5, x: 4 }, 7], a: 3 };
assert.equal(stringify(nested), '{"a":3,"b":[{"x":4,"y":5,"z":6},7],"c":8}');
assert.equal(
  stringify(nested, (a, b) => (a.key < b.key ? 1 : -1)),
  '{"c":8,"b":[{"z":6,"y":5,"x":4},7],"a":3}',
);
const one = { a: 1 };
const two = { a: 2, one };
one.two = two;
assert.throws(() => stringify(one), { name: 'TypeError' });
assert.equal(stringify(one, { cycles: true }), '{"a":1,"two":{"a":2,"one":"__cycle__"}}');
const shared = { x: 1 };
assert.equal(stringify({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
assert.equal(
  stringify({
    one: 1,
    two: 2,
    toJSON() {
      return { one: 1 };
    },
  }),
  '{"one":1}',
);
assert.equal(
  stringify({
    toJSON() {
      return 'one';
    },
  }),
  '"one"',
);
assert.equal(
  stringify({
    toJSON() {
      return ['one'];
    },
  }),
  '["one"]',
);
for (const value of ['hello', '', 'Ж😀', 'a"b\\c\n']) {
  assert.equal(stringify(new String(value)), JSON.stringify(value));
  assert.equal(
    stringify({ z: new String(value), a: [new String(value)] }),
    JSON.stringify({ a: [value], z: value }),
  );
}
assert.equal(
  stringify({ b: 2, a: new String('v') }, (a, b) => (a.key < b.key ? 1 : -1)),
  '{"b":2,"a":"v"}',
);
console.log('RIFTY_CORPUS_PASS:stringify-boxed');
