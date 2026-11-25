// Bridge candidate: a guest URL class whose parse and setters run in the host Node (ada) through one
// synchronous isolated-vm Callback, `__hostUrl(op, …)`; fields cross as an array of strings.
// Probe only: no searchParams, no inspect, no brand checks beyond a WeakMap.
const host = globalThis.__hostUrl;
// biome-ignore lint/performance/noDelete: probe input, deliberate
delete globalThis.__hostUrl;
const FIELDS = [
  'href',
  'origin',
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash',
];
const state = new WeakMap();
const fieldsOf = (u) => {
  const f = state.get(u);
  if (f === undefined) throw new TypeError('Illegal invocation');
  return f;
};
const parse = (input, base) =>
  host('parse', `${input}`, base === undefined ? undefined : `${base}`);
class URL {
  constructor(input, base) {
    // biome-ignore lint/style/noArguments: probe input, deliberate
    if (arguments.length === 0)
      throw Object.assign(new TypeError('The "url" argument must be specified'), {
        code: 'ERR_MISSING_ARGS',
      });
    const f = parse(input, base);
    if (f === null)
      throw Object.assign(new TypeError('Invalid URL'), {
        code: 'ERR_INVALID_URL',
        input: `${input}`,
      });
    state.set(this, f);
  }
  static canParse(input, base) {
    return parse(input, base) !== null;
  }
  static parse(input, base) {
    const f = parse(input, base);
    if (f === null) return null;
    const u = Object.create(URL.prototype);
    state.set(u, f);
    return u;
  }
  toString() {
    return fieldsOf(this)[0];
  }
  toJSON() {
    return fieldsOf(this)[0];
  }
  get searchParams() {
    throw new Error('url-bridge probe: searchParams not modelled');
  }
}
FIELDS.forEach((name, i) => {
  const descriptor = {
    get() {
      return fieldsOf(this)[i];
    },
    enumerable: true,
    configurable: true,
  };
  if (name !== 'origin')
    descriptor.set = function (value) {
      const f = host('set', fieldsOf(this)[0], name, `${value}`);
      if (f === null)
        throw Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' });
      state.set(this, f);
    };
  Object.defineProperty(URL.prototype, name, descriptor);
});
globalThis.URL = URL;
