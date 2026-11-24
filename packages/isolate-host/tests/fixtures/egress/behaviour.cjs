// The real (no-network) members of node:http, node:https, node:net, one line per observation;
// run by `node -e` and by the isolate guest, outputs compared exactly (egress-modules.test.ts).
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const util = require('node:util');
const out = [];
const show = (v) => {
  if (typeof v === 'function') return `fn ${v.name}`;
  if (typeof v === 'symbol') return String(v);
  if (typeof v === 'object' && v !== null) {
    const proto = Object.getPrototypeOf(v);
    return `${proto === null ? 'null-proto ' : ''}${JSON.stringify(v)}`;
  }
  return `${typeof v} ${String(v)}`;
};
const run = (label, f) => {
  try {
    out.push(`${label} -> ${show(f())}`);
  } catch (e) {
    // One line per row: a multi-line message (an inspected error) as JSON.
    const message = e.message.includes('\n') ? JSON.stringify(e.message) : e.message;
    out.push(`${label} -> throw ${e.name} ${e.code} ${message}`);
  }
};

// Parity case 2: IP grammar.
for (const s of [
  '1.2.3.4',
  '255.255.255.255',
  '256.1.1.1',
  '01.2.3.4',
  '1.2.3',
  '::',
  '::1',
  '1::',
  'fe80::1%eth0',
  '::ffff:1.2.3.4',
  '2001:db8::8a2e:370:7334',
  '1:2:3:4:5:6:7:8',
  '1:2:3:4:5:6:7:8:9',
  'g::1',
  '',
  ' 1.2.3.4',
  5,
  undefined,
  null,
  {},
  '1.2.3.4\n',
])
  run(`isIP ${JSON.stringify(s)}`, () => [net.isIP(s), net.isIPv4(s), net.isIPv6(s)].join());
run('isIP no args', () => net.isIP());

// Parity case 3: header validation, every code unit 0..255 and one beyond.
const nameOk = [];
const valueOk = [];
for (let c = 0; c <= 256; c++) {
  const ch = String.fromCharCode(c === 256 ? 0x3b1 : c);
  for (const [list, f] of [
    [nameOk, () => http.validateHeaderName(ch)],
    [valueOk, () => http.validateHeaderValue('x', `a${ch}b`)],
  ]) {
    try {
      f();
      list.push(1);
    } catch {
      list.push(0);
    }
  }
}
out.push(`header name ok ${nameOk.join('')}`);
out.push(`header value ok ${valueOk.join('')}`);
for (const n of [
  'x y',
  '',
  1,
  null,
  undefined,
  'Content-Type',
  'a'.repeat(12),
  `${'a'.repeat(11)} `,
])
  run(`validateHeaderName ${JSON.stringify(n)}`, () => http.validateHeaderName(n));
run('validateHeaderName label', () => http.validateHeaderName('a b', 'Label'));
// Node formats these messages with util.format's %s (ERR_INVALID_CHAR: a template literal).
for (const [label, name] of [
  ['{}', {}],
  ['null-proto', Object.create(null)],
  ['[]', []],
  ['[1,2]', [1, 2]],
  ['nested', { a: { b: { c: 1 } }, d: [1, [2]] }],
  ['1n', 1n],
  ['-0', -0],
  ['1.5', 1.5],
  ['symbol', Symbol('s')],
  ['function', function f() {}],
  ['own toString', { toString: () => 'custom' }],
  ['Date', new Date(0)],
  ['Map', new Map([[1, 2]])],
  ['class instance', new (class Foo {})()],
  [
    'class toString',
    new (class Bar {
      toString() {
        return 'bar';
      }
    })(),
  ],
  ['Symbol.toPrimitive', { [Symbol.toPrimitive]: () => 'prim' }],
  ['user class Request', new (class Request {})()],
  ['Number object', new Number(5)],
  ['nested null-proto', { a: Object.create(null) }],
  [
    'Error with stack, cause, code, subclass',
    (() => {
      class BadThing extends Error {}
      const e = new BadThing('boom', { cause: new Error('root') });
      e.code = 'E_BAD';
      e.stack = 'BadThing: boom\n    at fixed (fixed.js:1:1)';
      e.cause.stack = 'Error: root\n    at fixed (fixed.js:2:2)';
      return e;
    })(),
  ],
]) {
  run(`validateHeaderName name ${label}`, () => http.validateHeaderName(name));
  run(`validateHeaderName label ${label}`, () => http.validateHeaderName('bad name', name));
  run(`validateHeaderValue name ${label} undefined`, () =>
    http.validateHeaderValue(name, undefined),
  );
  run(`validateHeaderValue name ${label} bad char`, () => http.validateHeaderValue(name, '\n'));
}
run('validateHeaderName.withoutStackTrace', () => http.validateHeaderName.withoutStackTrace('a b'));
for (const v of [undefined, null, 5, 'a\nb', 'ok', ['a', 'b'], 'é'])
  run(`validateHeaderValue ${JSON.stringify(v)}`, () => http.validateHeaderValue('h', v));
run('validateHeaderValue.withoutStackTrace', () => http.validateHeaderValue.withoutStackTrace('h'));

// Parity case 4: _normalizeArgs.
for (const args of [
  [],
  [80],
  [80, 'h'],
  ['/tmp/s'],
  ['80'],
  [{ port: 1 }],
  [80, () => {}],
  [null],
  ['h', 80],
])
  run(`_normalizeArgs ${JSON.stringify(args)}`, () => {
    const r = net._normalizeArgs(args);
    return `${JSON.stringify(r)} cb=${typeof r[1]} symbols=${Object.getOwnPropertySymbols(r).map(String)} same=${r[0] === args[0]}`;
  });

// Parity case 5: config setters.
run('getDefaultAutoSelectFamily', () => net.getDefaultAutoSelectFamily());
run('getDefaultAutoSelectFamilyAttemptTimeout', () =>
  net.getDefaultAutoSelectFamilyAttemptTimeout(),
);
for (const v of [1, 'true', undefined, false, true])
  run(`setDefaultAutoSelectFamily ${JSON.stringify(v)}`, () => net.setDefaultAutoSelectFamily(v));
run('getDefaultAutoSelectFamily after', () => net.getDefaultAutoSelectFamily());
for (const v of [0, 1.5, '1', -1, 2 ** 31, Number.NaN, 5, 300])
  run(`setDefaultAutoSelectFamilyAttemptTimeout ${String(v)}`, () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(v);
    return net.getDefaultAutoSelectFamilyAttemptTimeout();
  });
for (const v of [0, 1.5, '1', 2 ** 53, 5])
  run(`setMaxIdleHTTPParsers ${String(v)}`, () => http.setMaxIdleHTTPParsers(v));
run('maxHeaderSize', () => http.maxHeaderSize);
run('Agent.defaultMaxSockets', () => http.Agent.defaultMaxSockets);

// Parity case 6: Agents.
const EE_KEYS = new Set(['_events', '_eventsCount', '_maxListeners', '_listenersMap', '_warned']);
const fields = (a) =>
  Object.keys(a)
    .filter((k) => !EE_KEYS.has(k))
    .map((k) => `${k}=${show(a[k])}`)
    .join(' ');
const agent = (label, make) =>
  run(label, () => {
    const a = make();
    return `${a.constructor.name} ${a instanceof http.Agent} ${a instanceof https.Agent} ${a instanceof require('node:events')} ${fields(a)} free=${a.listenerCount('free')} newListener=${a.listenerCount('newListener')}`;
  });
agent('http.globalAgent', () => http.globalAgent);
agent('https.globalAgent', () => https.globalAgent);
agent('new http.Agent()', () => new http.Agent());
agent('http.Agent() no new', () => http.Agent({ keepAlive: true }));
agent(
  'new http.Agent(opts)',
  () =>
    new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 5,
      maxSockets: 3,
      maxFreeSockets: 2,
      maxTotalSockets: 9,
      scheduling: 'fifo',
      timeout: 7,
      noDelay: false,
      defaultPort: 8080,
      protocol: 'x:',
      agentKeepAliveTimeoutBuffer: 3,
    }),
);
agent('new http.Agent(bad buffer)', () => new http.Agent({ agentKeepAliveTimeoutBuffer: -1 }));
agent('new https.Agent(opts)', () => new https.Agent({ maxCachedSessions: 0, keepAlive: true }));
agent('https.Agent() no new', () => https.Agent());
run('new http.Agent scheduling', () => new http.Agent({ scheduling: 'x' }));
run('new http.Agent scheduling long', () => new http.Agent({ scheduling: 'x'.repeat(140) }));
run('new http.Agent maxTotalSockets 0', () => new http.Agent({ maxTotalSockets: 0 }));
run('new http.Agent maxTotalSockets str', () => new http.Agent({ maxTotalSockets: '1' }));
run('new http.Agent maxTotalSockets NaN', () => new http.Agent({ maxTotalSockets: Number.NaN }));
class Sub extends http.Agent {
  constructor() {
    super({ keepAlive: true });
    this.extra = 1;
  }
}
agent('class extends http.Agent', () => new Sub());
class SubS extends https.Agent {}
agent('class extends https.Agent', () => new SubS());
function Old() {
  http.Agent.call(this, { maxSockets: 4 });
}
util.inherits(Old, http.Agent);
agent('util.inherits http.Agent', () => new Old());
const g = new http.Agent();
for (const o of [
  undefined,
  {},
  { host: 'h', port: 1, localAddress: 'l', family: 4, socketPath: '/s' },
  { family: 5 },
  { family: 6 },
  { host: 'h', port: 2, family: 6 },
])
  run(`http getName ${JSON.stringify(o)}`, () => g.getName(o));
const gs = new https.Agent();
for (const o of [
  undefined,
  {
    host: 'h',
    port: 1,
    ca: 'c',
    cert: 'ce',
    ciphers: 'x',
    key: 'k',
    pfx: 'p',
    rejectUnauthorized: false,
    servername: 's',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    secureProtocol: 'sp',
    crl: 'crl',
    honorCipherOrder: true,
    ecdhCurve: 'e',
    dhparam: 'd',
    secureOptions: 0,
    sessionIdContext: 'sic',
    sigalgs: ['a'],
    privateKeyIdentifier: 'pki',
    privateKeyEngine: 'pke',
    clientCertEngine: 'cce',
  },
  { host: 'h', servername: 'h' },
])
  run(`https getName ${JSON.stringify(o)}`, () => gs.getName(o));
run('destroy fresh agent', () => g.destroy());
run('https session cache', () => {
  const a = new https.Agent({ maxCachedSessions: 2 });
  a._cacheSession('a', 1);
  a._cacheSession('b', 2);
  a._cacheSession('a', 3);
  a._cacheSession('c', 4);
  const got = [a._getSession('a'), a._getSession('b'), a._getSession('c')];
  a._evictSession('c');
  a._evictSession('zz');
  return `${got} ${JSON.stringify(a._sessionCache)}`;
});
run('https session cache disabled', () => {
  const a = new https.Agent({ maxCachedSessions: 0 });
  a._cacheSession('a', 1);
  return JSON.stringify(a._sessionCache);
});
for (const [label, make] of [
  ['empty', () => new http.Agent({ proxyEnv: {} })],
  ['other protocol', () => new http.Agent({ proxyEnv: { https_proxy: 'http://p:1' } })],
  ['ftp proxy', () => new http.Agent({ proxyEnv: { http_proxy: 'ftp://p' } })],
  ['protocol x:', () => new http.Agent({ protocol: 'x:', proxyEnv: { http_proxy: 'http://p' } })],
  ['https, http proxy only', () => new https.Agent({ proxyEnv: { HTTP_PROXY: 'http://p' } })],
  ['crlf', () => new http.Agent({ proxyEnv: { http_proxy: 'http://p\n' } })],
])
  run(`proxyEnv ${label}`, () => {
    const a = make();
    return Object.getOwnPropertySymbols(a)
      .filter((s) => String(s) === 'Symbol(kProxyConfig)')
      .map((s) => String(a[s]))
      .join();
  });
run('proxyEnv non-string proxy', () => new http.Agent({ proxyEnv: { HTTP_PROXY: 5 } }));
for (const [label, env] of [
  ['empty', {}],
  ['other variables', { PATH: '/bin', no_proxy: 'x' }],
  ['empty strings', { http_proxy: '', HTTPS_PROXY: '' }],
  ['number', 5],
  ['null', null],
  ['array', []],
  ['crlf', { http_proxy: 'http://p\r' }],
  ['https crlf', { HTTPS_PROXY: 'http://p\n' }],
])
  run(`setGlobalProxyFromEnv ${label}`, () => {
    const before = [http.globalAgent, https.globalAgent];
    const restore = http.setGlobalProxyFromEnv(env);
    const kept = http.globalAgent === before[0] && https.globalAgent === before[1];
    const r = restore();
    return `${typeof restore} name=${JSON.stringify(restore.name)} length=${restore.length} prototype=${'prototype' in restore} kept=${kept} restore=${r}`;
  });
run('setGlobalProxyFromEnv default env', () => typeof http.setGlobalProxyFromEnv());
run('net.BlockList() without new', () => net.BlockList());
run('net.SocketAddress() without new', () => net.SocketAddress());
run('keylog hook', () => {
  const a = new http.Agent();
  const before = a.listenerCount('newListener');
  a.on('other', () => {});
  const mid = a.listenerCount('newListener');
  a.on('keylog', () => {});
  return `${before} ${mid} ${a.listenerCount('newListener')} ${a.listeners('newListener').map((f) => f.name)}`;
});
run('free listener name', () =>
  JSON.stringify(new http.Agent().listeners('free').map((f) => f.name)),
);
run('newListener name', () =>
  JSON.stringify(new http.Agent().listeners('newListener').map((f) => f.name)),
);
run('globalAgent setter', () => {
  const before = http.globalAgent;
  const x = new http.Agent({ maxSockets: 1 });
  http.globalAgent = x;
  const r = `${http.globalAgent === x} ${http.globalAgent === before}`;
  http.globalAgent = before;
  return r;
});
run('globalAgent stable', () => {
  const first = http.globalAgent;
  return first === http.globalAgent && https.globalAgent === require('node:https').globalAgent;
});
run('https.globalAgent.options proto', () => Object.getPrototypeOf(https.globalAgent.options));
console.log(out.join('\n'));
