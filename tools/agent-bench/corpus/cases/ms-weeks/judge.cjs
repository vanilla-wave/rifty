const assert = require('node:assert/strict');
const ms = require('./index.js');
// Semantic port of the retained upstream ms string/long/short test fixtures.
const parsed = [
  ['100', 100],
  ['1m', 60000],
  ['1h', 3600000],
  ['2d', 172800000],
  ['1s', 1000],
  ['100ms', 100],
  ['1.5h', 5400000],
  ['1   s', 1000],
  ['1.5H', 5400000],
  ['.5ms', 0.5],
  ['53 milliseconds', 53],
  ['17 msecs', 17],
  ['1 sec', 1000],
  ['1 min', 60000],
  ['1 hr', 3600000],
  ['2 days', 172800000],
  ['1.5 hours', 5400000],
];
for (const [value, expected] of parsed) assert.equal(ms(value), expected);
// biome-ignore lint/suspicious/noGlobalIsNan: retained upstream fixture treats undefined as invalid.
assert.ok(isNaN(ms('☃')));
const formatted = [
  [500, '500 ms', '500ms'],
  [1000, '1 second', '1s'],
  [10000, '10 seconds', '10s'],
  [60000, '1 minute', '1m'],
  [600000, '10 minutes', '10m'],
  [3600000, '1 hour', '1h'],
  [36000000, '10 hours', '10h'],
  [86400000, '1 day', '1d'],
  [864000000, '10 days', '10d'],
  [234234234, '3 days', '3d'],
];
for (const [value, long, short] of formatted) {
  assert.equal(ms(value, { long: true }), long);
  assert.equal(ms(value), short);
}
for (const [value, expected] of [
  [1200, '1 second'],
  [72000, '1 minute'],
  [4320000, '1 hour'],
  [103680000, '1 day'],
])
  assert.equal(ms(value, { long: true }), expected);
for (const [value, expected] of [
  ['1w', 604800000],
  ['2 weeks', 1209600000],
  ['1.5 WEEK', 907200000],
  ['.5w', 302400000],
  ['1   week', 604800000],
  ['0w', 0],
])
  assert.equal(ms(value), expected);
assert.equal(ms('1 month'), undefined);
console.log('RIFTY_CORPUS_PASS:ms-weeks');
