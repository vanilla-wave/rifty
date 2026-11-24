/**
 * `node:http`, `node:https`, `node:net` in the isolate guest (unit
 * `backlog/distribution/isolate-host-egress-modules-load`, ADR-0557 §6 correction
 * 2026-11-24): Node's shape and real no-network members, against live `node`;
 * every network member a named gap at use, never at load.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSandbox, runCode } from '../src/index.ts';
import { nodeEval, nodeSequence } from './support.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/egress/${name}`, import.meta.url), 'utf8');

/** Declared shape deviations (unit §Out of scope): Node's line → the guest's. */
const DECLARED_SHAPE: Readonly<Record<string, string>> = {
  // rifty's `tls` stub is not Node-shaped: https.Server chains to net.Server.
  'https.Server value ECW fn name=Server length=2 prototype=true proto->tls.Server.prototype ctor->tls.Server statics=':
    'https.Server value ECW fn name=Server length=2 prototype=true proto->net.Server.prototype ctor->net.Server statics=',
};

describe('module shape equals live node -e (Acceptance 1)', () => {
  it('http, https, net: names, descriptors, kinds, chains, identities, data', async () => {
    const code = fixture('shape.cjs');
    const oracle = nodeEval(code);
    expect(oracle.code, oracle.stderr).toBe(0);
    const expected = oracle.stdout
      .split('\n')
      .map((line) => DECLARED_SHAPE[line] ?? line)
      .join('\n');
    const result = await runCode(code);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(expected);
    expect(result.exitCode).toBe(0);
  });
});

/**
 * Declared behaviour deviations: rifty's `util.inspect` prints a null-prototype
 * object as `{}` (Node `[Object: null prototype] {}`), and Node's %s inspects
 * one — `backlog/runtime-js/inspect-null-prototype-prefix`.
 */
const NULL_PROTO = '[Object: null prototype] {}';
const declaredBehaviour = (line: string): string =>
  line.includes(' null-proto ') ? line.split(NULL_PROTO).join('{}') : line;

describe('real members equal live node -e (Acceptance 2, parity cases 2–6)', () => {
  it('IP grammar, header validation, _normalizeArgs, config setters, Agents', async () => {
    const code = fixture('behaviour.cjs');
    const oracle = nodeEval(code);
    expect(oracle.code, oracle.stderr).toBe(0);
    expect(oracle.stdout).toContain(NULL_PROTO);
    const result = await runCode(code);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(oracle.stdout.split('\n').map(declaredBehaviour).join('\n'));
    expect(result.exitCode).toBe(0);
  });
});

const NO_NETWORK = 'no network in the rifty isolate host, ADR-0557';
/** Loud although Node's constructor opens nothing (unit Decisions, manager-confirmed): its own reason. */
const NOT_IN_GUEST: Readonly<Record<string, string>> = Object.fromEntries([
  ...[
    'http.IncomingMessage',
    'http.OutgoingMessage',
    'http.Server',
    'http.ServerResponse',
    'https.Server',
    'net.Server',
    'net.Socket',
  ].map((f) => [
    f,
    "Node's HTTP message, server and socket objects are not in the rifty isolate host, ADR-0557",
  ]),
  ...[
    'net.BlockList',
    'net.BlockList.isBlockList',
    'net.SocketAddress',
    'net.SocketAddress.isSocketAddress',
    'net.SocketAddress.parse',
  ].map((f) => [f, 'not implemented in the rifty isolate host (Node backs it natively), ADR-0557']),
]);

/** [what the guest does, the feature its gap names]. */
const LOUD: readonly (readonly [string, string])[] = [
  ['http._connectionListener({})', 'http._connectionListener'],
  ["http.request('http://example.com/')", 'http.request'],
  ["http.get('http://example.com/')", 'http.get'],
  ['http.createServer()', 'http.createServer'],
  [
    "http.setGlobalProxyFromEnv({ HTTP_PROXY: 'http://proxy.invalid:1' })",
    'http.setGlobalProxyFromEnv',
  ],
  [
    "http.setGlobalProxyFromEnv({ https_proxy: 'https://proxy.invalid' })",
    'http.setGlobalProxyFromEnv',
  ],
  ["new http.ClientRequest('http://example.com/')", 'http.ClientRequest'],
  ['new http.IncomingMessage()', 'http.IncomingMessage'],
  ['new http.OutgoingMessage()', 'http.OutgoingMessage'],
  ['new http.Server()', 'http.Server'],
  ['http.Server()', 'http.Server'],
  ['new http.ServerResponse({})', 'http.ServerResponse'],
  ['new (class extends http.Server {})()', 'http.Server'],
  ['new (class extends http.IncomingMessage {})()', 'http.IncomingMessage'],
  [
    "new http.Agent().createConnection({ host: 'example.com', port: 80 })",
    'http.Agent.createConnection',
  ],
  ["http.globalAgent.addRequest({}, { host: 'example.com' })", 'http.Agent.addRequest'],
  [
    "new http.Agent().createSocket({}, { host: 'example.com' }, () => {})",
    'http.Agent.createSocket',
  ],
  ['new http.Agent().removeSocket({}, {})', 'http.Agent.removeSocket'],
  ['new http.Agent().keepSocketAlive({})', 'http.Agent.keepSocketAlive'],
  ['new http.Agent().reuseSocket({}, {})', 'http.Agent.reuseSocket'],
  ["new http.Agent().emit('free', {}, {})", 'http.Agent.free'],
  ["new http.Agent({ proxyEnv: { HTTP_PROXY: 'http://proxy.invalid:1' } })", 'http.Agent.proxyEnv'],
  [
    "new https.Agent({ proxyEnv: { https_proxy: 'https://proxy.invalid' } })",
    'http.Agent.proxyEnv',
  ],
  ['function S() { http.Server.call(this) } util.inherits(S, http.Server); new S()', 'http.Server'],
  [
    'function R(req) { http.ServerResponse.call(this, req) } util.inherits(R, http.ServerResponse); new R({})',
    'http.ServerResponse',
  ],
  ['function K() { net.Socket.call(this) } util.inherits(K, net.Socket); new K()', 'net.Socket'],
  ["https.request('https://example.com/')", 'https.request'],
  ["https.get('https://example.com/')", 'https.get'],
  ['https.createServer()', 'https.createServer'],
  ['new https.Server()', 'https.Server'],
  [
    "https.globalAgent.createConnection({ host: 'example.com', port: 443 })",
    'https.Agent.createConnection',
  ],
  [
    "new (class extends https.Agent {})().addRequest({}, { host: 'example.com' })",
    'http.Agent.addRequest',
  ],
  ["net.connect(80, 'example.com')", 'net.connect'],
  ["net.createConnection({ host: 'example.com', port: 80 })", 'net.connect'],
  ['net.createServer()', 'net.createServer'],
  ['net._createServerHandle()', 'net._createServerHandle'],
  ['new net.Server()', 'net.Server'],
  ['new net.Socket()', 'net.Socket'],
  ['new net.Stream()', 'net.Socket'],
  ['new (class extends net.Socket {})()', 'net.Socket'],
  ['new net.BlockList()', 'net.BlockList'],
  ['net.BlockList.isBlockList({})', 'net.BlockList.isBlockList'],
  ["new net.SocketAddress({ address: '127.0.0.1' })", 'net.SocketAddress'],
  ['net.SocketAddress.isSocketAddress({})', 'net.SocketAddress.isSocketAddress'],
  ["net.SocketAddress.parse('127.0.0.1:80')", 'net.SocketAddress.parse'],
];

describe('network use is a named gap; load, reads and subclassing are not (Acceptance 3)', () => {
  it('require, import(), every property read and every subclass declaration throw nothing', async () => {
    const code = `
      const mods = { http: require('http'), https: require('https'), net: require('net') };
      const seen = [];
      for (const [m, mod] of Object.entries(mods)) for (const k of Object.getOwnPropertyNames(mod)) {
        const v = mod[k];
        if (typeof v === 'function' && v.prototype) { class Sub extends v {} seen.push(Sub.name); }
      }
      Promise.all(['node:http', 'node:https', 'node:net'].map((s) => import(s)))
        .then(() => console.log('loaded', seen.length));`;
    const [oracle] = nodeSequence([{ files: { 'load.cjs': code }, run: ['load.cjs'] }]);
    expect(oracle?.stdout).toMatch(/^loaded \d+\n$/);
    const sb = await createSandbox();
    try {
      await sb.writeFile('load.cjs', code);
      expect(await sb.exec('load.cjs')).toEqual({
        stdout: oracle?.stdout,
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  });

  it('each network member throws NotImplementedError naming itself, at use', async () => {
    const result = await runCode(`
      const http = require('http'), https = require('https'), net = require('net'), util = require('util');
      const out = [];
      for (const [expr, feature, hint] of ${JSON.stringify(LOUD.map(([expr, feature]) => [expr, feature, NOT_IN_GUEST[feature] ?? NO_NETWORK]))}) {
        try { new Function('http', 'https', 'net', 'util', expr)(http, https, net, util); out.push(expr + ' REACHED'); }
        catch (e) {
          const ok = e instanceof Error && e.name === 'NotImplementedError' &&
            e.message === 'Not implemented: isolate-host.' + feature + ' (' + hint + ')';
          out.push(expr + ' ' + (ok ? 'loud' : 'WRONG ' + e.name + ': ' + e.message));
        }
      }
      console.log(out.join('\\n'));`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${LOUD.map(([expr]) => `${expr} loud`).join('\n')}\n`);
  });
});

describe('import() from CommonJS and node -e globals (Acceptance 5, parity case 7)', () => {
  it('namespace keys and default identity equal node <file>', async () => {
    const code = `const ids = ['http', 'https', 'net'];
      Promise.all(ids.map((id) => import('node:' + id))).then((nss) => console.log(nss
        .map((ns, i) => ids[i] + ' ' + Object.keys(ns).sort().join(',') + ' ' + (ns.default === require(ids[i])))
        .join('\\n')));`;
    const [oracle] = nodeSequence([{ files: { 'ns.cjs': code }, run: ['ns.cjs'] }]);
    const sb = await createSandbox();
    try {
      await sb.writeFile('ns.cjs', code);
      expect(await sb.exec('ns.cjs')).toEqual({
        stdout: oracle?.stdout,
        stderr: '',
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  });

  it('the lazy http/https/net globals are the required modules', async () => {
    const code =
      "console.log(http === require('http'), https === require('node:https'), net === require('net'), typeof http.STATUS_CODES, net.isIP('::1'))";
    const oracle = nodeEval(code);
    expect(await runCode(code)).toEqual({
      stdout: oracle.stdout,
      stderr: oracle.stderr,
      exitCode: oracle.code,
    });
  });
});
