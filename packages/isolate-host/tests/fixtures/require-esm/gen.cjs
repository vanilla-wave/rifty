// Each verdict on a generator, an async, a plain and an arrow function.
const fns = [function* g() {}, async function a() {}, function f() {}, () => {}];
for (const name of ['is-generator-function', 'is-async-function']) {
  const is = require(name);
  console.log(name, ...fns.map((fn) => is(fn)));
}
