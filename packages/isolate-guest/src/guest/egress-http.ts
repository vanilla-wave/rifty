/**
 * The guest's `node:http` and `node:https` (ADR-0557 §6, 2026-11-24): Node
 * v24.16.0's export lists in their order. Real: the data tables, header
 * validation, the parser-pool setter and `Agent` — construction, `getName`,
 * `destroy`, the session cache, `globalAgent` (ports of Node's `lib/_http_agent.js`,
 * `lib/https.js`); its socket pool is the gap. Requests, servers, messages: gaps.
 */
import { EventEmitter, Readable, Stream } from '@riftydev/io';
import { METHODS, STATUS_CODES, maxHeaderSize } from '@riftydev/net/node-data';
import { type Base, gap, loudClass, loudFunction, named } from './egress-gaps.ts';
import {
  nodeError,
  validateInteger,
  validateNumberAtLeast,
  validateOneOf,
} from './node-validators.ts';

const kOnKeylog = Symbol('onkeylog');
type Options = Record<string, unknown>;
interface AgentFields extends EventEmitter {
  options: Options;
  defaultPort: unknown;
  protocol: unknown;
  requests: Record<string, unknown[]>;
  sockets: Record<string, { destroy(): void }[]>;
  freeSockets: Record<string, { destroy(): void }[]>;
  keepAliveMsecs: unknown;
  keepAlive: unknown;
  maxSockets: unknown;
  maxFreeSockets: unknown;
  scheduling: unknown;
  maxTotalSockets: unknown;
  totalSocketCount: number;
  agentKeepAliveTimeoutBuffer: number;
  maxCachedSessions?: unknown;
  _sessionCache?: { map: Record<string, unknown>; list: string[] };
  [kOnKeylog]?: (this: unknown, keylog: unknown) => void;
  getName(options?: Options): string;
}
interface AgentCtor {
  (this: AgentFields | undefined, options?: Options): AgentFields | undefined;
  new (options?: Options): AgentFields;
  prototype: AgentFields;
  defaultMaxSockets: number;
}

const kEmptyObject: Options = Object.freeze({ __proto__: null }) as Options;

// lib/_http_common.js
const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

function validateHeaderNameImpl(name: unknown, label?: unknown): void {
  if (typeof name !== 'string' || !name || !tokenRegExp.test(name))
    throw nodeError(
      TypeError,
      'ERR_INVALID_HTTP_TOKEN',
      `${label || 'Header name'} must be a valid HTTP token ["${String(name)}"]`,
    );
}
function validateHeaderValueImpl(name: unknown, value: unknown): void {
  if (value === undefined)
    throw nodeError(
      TypeError,
      'ERR_HTTP_INVALID_HEADER_VALUE',
      `Invalid value "${String(value)}" for header "${String(name)}"`,
    );
  if (headerCharRegex.test(value as string))
    throw nodeError(
      TypeError,
      'ERR_INVALID_CHAR',
      `Invalid character in header content ["${String(name)}"]`,
    );
}
/** `hideStackFrames`: a `(...args)` wrapper carrying the bare function as `withoutStackTrace`. */
function hidden(impl: (...args: never[]) => void, name: string) {
  const wrapped = named(function (this: unknown, ...args: never[]): void {
    Reflect.apply(impl, this, args);
  }, name);
  return Object.assign(wrapped, { withoutStackTrace: impl });
}

function maybeEnableKeylog(this: AgentFields, eventName: unknown): void {
  if (eventName !== 'keylog') return;
  this.removeListener('newListener', maybeEnableKeylog);
  const agent = this;
  this[kOnKeylog] = function onkeylog(this: unknown, keylog: unknown): void {
    agent.emit('keylog', keylog, this);
  };
  for (const socket of Object.values(this.sockets))
    (socket as unknown as EventEmitter).on('keylog', this[kOnKeylog]);
}
named(maybeEnableKeylog, 'maybeEnableKeylog');

function createAgent(): AgentCtor {
  const Agent = named(
    function HttpAgent(this: AgentFields | undefined, options?: Options): AgentFields | undefined {
      if (!(this instanceof Agent)) return new Agent(options);
      (EventEmitter as unknown as (this: unknown) => void).call(this);
      this.options = { __proto__: null, ...options } as Options;
      this.defaultPort = this.options.defaultPort || 80;
      this.protocol = this.options.protocol || 'http:';
      if (this.options.noDelay === undefined) this.options.noDelay = true;
      this.options.path = null;
      this.requests = { __proto__: null } as unknown as Record<string, unknown[]>;
      this.sockets = { __proto__: null } as unknown as AgentFields['sockets'];
      this.freeSockets = { __proto__: null } as unknown as AgentFields['freeSockets'];
      this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
      this.keepAlive = this.options.keepAlive || false;
      this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
      this.maxFreeSockets = this.options.maxFreeSockets || 256;
      this.scheduling = this.options.scheduling || 'lifo';
      this.maxTotalSockets = this.options.maxTotalSockets;
      this.totalSocketCount = 0;
      const buffer = this.options.agentKeepAliveTimeoutBuffer;
      this.agentKeepAliveTimeoutBuffer =
        typeof buffer === 'number' && buffer >= 0 && Number.isFinite(buffer) ? buffer : 1000;
      const proxyEnv = this.options.proxyEnv;
      // Node parses a proxy config here, for the connections it will make.
      if (typeof proxyEnv === 'object' && proxyEnv !== null) throw gap('http.Agent.proxyEnv');
      validateOneOf(this.scheduling, 'scheduling', ['fifo', 'lifo']);
      if (this.maxTotalSockets !== undefined)
        validateNumberAtLeast(this.maxTotalSockets, 'maxTotalSockets', 1);
      else this.maxTotalSockets = Number.POSITIVE_INFINITY;
      // Node hands a released socket to the next request or the free pool.
      this.on('free', () => {
        throw gap('http.Agent.free');
      });
      this.on('newListener', maybeEnableKeylog);
      return undefined;
    } as unknown as AgentCtor,
    'Agent',
  );
  Object.setPrototypeOf(Agent.prototype, EventEmitter.prototype);
  Object.setPrototypeOf(Agent, EventEmitter);
  Agent.defaultMaxSockets = Number.POSITIVE_INFINITY;
  const proto = Agent.prototype as unknown as Record<string, unknown>;
  proto.createConnection = loudFunction('createConnection', 0, 'http.Agent.createConnection');
  proto.getName = named(function getName(options: Options = kEmptyObject): string {
    let name = (options.host as string) || 'localhost';
    name += ':';
    if (options.port) name += options.port as string;
    name += ':';
    if (options.localAddress) name += options.localAddress as string;
    if (options.family === 4 || options.family === 6) name += `:${options.family}`;
    if (options.socketPath) name += `:${options.socketPath}`;
    return name;
  }, 'getName');
  proto.addRequest = loudFunction('addRequest', 4, 'http.Agent.addRequest');
  proto.createSocket = loudFunction('createSocket', 3, 'http.Agent.createSocket');
  proto.removeSocket = loudFunction('removeSocket', 2, 'http.Agent.removeSocket');
  proto.keepSocketAlive = loudFunction('keepSocketAlive', 1, 'http.Agent.keepSocketAlive');
  proto.reuseSocket = loudFunction('reuseSocket', 2, 'http.Agent.reuseSocket');
  proto.destroy = named(function destroy(this: AgentFields): void {
    for (const set of [this.freeSockets, this.sockets])
      for (const key of Object.keys(set)) for (const socket of set[key] ?? []) socket.destroy();
  }, 'destroy');
  return Agent;
}

/** TLS fields of `https.Agent#getName`, in Node's order. */
const TLS_NAME_FIELDS = [
  'ca',
  'cert',
  'clientCertEngine',
  'ciphers',
  'key',
  'pfx',
  'rejectUnauthorized',
  'servername',
  'minVersion',
  'maxVersion',
  'secureProtocol',
  'crl',
  'honorCipherOrder',
  'ecdhCurve',
  'dhparam',
  'secureOptions',
  'sessionIdContext',
  'sigalgs',
  'privateKeyIdentifier',
  'privateKeyEngine',
] as const;
/** Fields Node appends when set (`!== undefined`), not when truthy. */
const DEFINED_FIELDS = new Set(['rejectUnauthorized', 'honorCipherOrder', 'secureOptions']);

function createHttpsAgent(HttpAgent: AgentCtor): AgentCtor {
  const Agent = named(
    function HttpsAgent(this: AgentFields | undefined, options?: Options): AgentFields | undefined {
      if (!(this instanceof Agent)) return new Agent(options);
      const opts = { __proto__: null, ...options } as Options;
      opts.defaultPort ??= 443;
      opts.protocol ??= 'https:';
      HttpAgent.call(this, opts);
      this.maxCachedSessions = this.options.maxCachedSessions;
      if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;
      this._sessionCache = { map: {}, list: [] };
      return undefined;
    } as unknown as AgentCtor,
    'Agent',
  );
  Object.setPrototypeOf(Agent.prototype, HttpAgent.prototype);
  Object.setPrototypeOf(Agent, HttpAgent);
  const proto = Agent.prototype as unknown as Record<string, unknown>;
  proto.createConnection = loudFunction('createConnection', 0, 'https.Agent.createConnection');
  proto.getName = named(function getName(this: AgentFields, options: Options = kEmptyObject) {
    let name = HttpAgent.prototype.getName.call(this, options);
    for (const field of TLS_NAME_FIELDS) {
      name += ':';
      const v = options[field];
      if (DEFINED_FIELDS.has(field) ? v === undefined : !v) continue;
      if (field === 'servername' && v === options.host) continue;
      name += field === 'sigalgs' ? JSON.stringify(v) : (v as string);
    }
    return name;
  }, 'getName');
  proto._getSession = named(function _getSession(this: AgentFields, key: string) {
    return this._sessionCache?.map[key];
  }, '_getSession');
  proto._cacheSession = named(function _cacheSession(
    this: AgentFields,
    key: string,
    session: unknown,
  ): void {
    const cache = this._sessionCache as NonNullable<AgentFields['_sessionCache']>;
    if (this.maxCachedSessions === 0) return;
    if (cache.map[key]) {
      cache.map[key] = session;
      return;
    }
    if (cache.list.length >= (this.maxCachedSessions as number)) {
      const oldKey = cache.list.shift() as string;
      delete cache.map[oldKey];
    }
    cache.list.push(key);
    cache.map[key] = session;
  }, '_cacheSession');
  proto._evictSession = named(function _evictSession(this: AgentFields, key: string): void {
    const cache = this._sessionCache as NonNullable<AgentFields['_sessionCache']>;
    const index = cache.list.indexOf(key);
    if (index === -1) return;
    cache.list.splice(index, 1);
    delete cache.map[key];
  }, '_evictSession');
  return Agent;
}

export function createHttp(netServer: Base): {
  http: Record<string, unknown>;
  https: Record<string, unknown>;
} {
  // Node's own http module re-exports these web globals (undici's); the guest's are its ceilings.
  const { WebSocket, CloseEvent, MessageEvent } = globalThis as unknown as Record<string, unknown>;
  const Agent = createAgent();
  let globalAgent = new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });
  const OutgoingMessage = loudClass('OutgoingMessage', 1, 'http.OutgoingMessage', Stream);
  const { setMaxIdleHTTPParsers } = {
    // Node sizes its idle parser pool; no connection here ever takes a parser.
    setMaxIdleHTTPParsers(max: unknown): void {
      validateInteger(max, 'max', 1);
    },
  };
  const http: Record<string, unknown> = {
    _connectionListener: loudFunction('connectionListener', 1, 'http._connectionListener'),
    METHODS: [...METHODS],
    STATUS_CODES: { ...STATUS_CODES },
    Agent,
    ClientRequest: loudClass('ClientRequest', 3, 'http.ClientRequest', OutgoingMessage),
    IncomingMessage: loudClass('IncomingMessage', 1, 'http.IncomingMessage', Readable),
    OutgoingMessage,
    Server: loudClass('Server', 2, 'http.Server', netServer),
    ServerResponse: loudClass('ServerResponse', 2, 'http.ServerResponse', OutgoingMessage),
    createServer: loudFunction('createServer', 2, 'http.createServer'),
    validateHeaderName: hidden(validateHeaderNameImpl, 'validateHeaderName'),
    validateHeaderValue: hidden(validateHeaderValueImpl, 'validateHeaderValue'),
    get: loudFunction('get', 3, 'http.get'),
    request: loudFunction('request', 3, 'http.request'),
    setMaxIdleHTTPParsers,
    setGlobalProxyFromEnv: loudFunction('setGlobalProxyFromEnv', 0, 'http.setGlobalProxyFromEnv'),
  };
  const accessor = (get: () => unknown, set?: (v: never) => void): PropertyDescriptor => ({
    get,
    set,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperties(http, {
    maxHeaderSize: accessor(() => maxHeaderSize),
    globalAgent: accessor(
      () => globalAgent,
      (value) => {
        globalAgent = value;
      },
    ),
    WebSocket: accessor(() => WebSocket),
    CloseEvent: accessor(() => CloseEvent),
    MessageEvent: accessor(() => MessageEvent),
  });
  const HttpsAgent = createHttpsAgent(Agent);
  const https = {
    Agent: HttpsAgent,
    globalAgent: new HttpsAgent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 }),
    // Node: tls.Server; rifty's tls stub is not Node-shaped (unit §Out of scope).
    Server: loudClass('Server', 2, 'https.Server', netServer),
    createServer: loudFunction('createServer', 2, 'https.createServer'),
    get: loudFunction('get', 3, 'https.get'),
    request: loudFunction('request', 0, 'https.request'),
  };
  return { http, https };
}
