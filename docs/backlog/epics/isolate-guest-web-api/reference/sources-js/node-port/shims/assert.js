function assert(v, m) {
  if (!v) throw new Error(m ?? 'Assertion failed');
}
assert.ok = assert;
assert.fail = (m) => {
  throw new Error(m);
};
module.exports = assert;
