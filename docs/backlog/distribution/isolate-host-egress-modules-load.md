---
area: distribution
status: ready
title: In the isolate guest node:http, node:https and node:net load with Node's shape and only their network use throws a named gap
created: 2026-11-24
why: Node loads these modules without touching the network; the guest throws at load, so a program that loads one and never uses the network (pptxgenjs on every write) works in Node and fails in the isolate.
user_story: As an agent backend running document libraries in an isolate sandbox, I want `pptx.writeFile()` to write the file as in Node, but today pptxgenjs's unawaited `import('node:https')` rejects with `NotImplementedError('isolate-host.https')` and the run exits 1.
sources: [ADR-0557, ADR-0568, ADR-0464, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-guest/src/guest/entry.ts]
---

## Context

`EGRESS_MODULES` (`packages/isolate-guest/src/guest/entry.ts`) registers `http`, `https`, `net`
as factories that throw `NotImplementedError('isolate-host.<module>')` (ADR-0557 §6 "at
require"). Probe 2026-11-24 (README row 2): pptxgenjs 4.0.1 `encodeSlideMediaRels`
(`dist/pptxgen.cjs.js:4842-4850`) starts `import('node:fs')` + `import('node:https')` per slide
and never awaits the first one; it calls `https.get` only for a media `path` starting `http`.
Precedent: `tls`/`dgram`/`http2` load and throw at use (`null-net-stubs.ts`, ADR-0464).

Manager decision 2026-11-24 (not the user's words, reversible): the three modules load with
Node's shape; a member that needs the network throws a named gap when called or constructed;
a member that does not is real with Node's values; no silent stubs; the no-egress invariant
(ADR-0557, ADR-0568) is unchanged.

Oracle: Node v24.16.0 (`node -e`), member classification per Node's export list and source
(`Function.prototype.toString` of each member):

| module | real (Node behaviour, no network) | loud (`isolate-host.<module>.<member>`) |
|---|---|---|
| http | `METHODS`, `STATUS_CODES`, `maxHeaderSize` (16384: no CLI options in the guest), `validateHeaderName`, `validateHeaderValue` (messages with Node's `%s`), `setMaxIdleHTTPParsers` (validates; no connection here takes a parser), `Agent` (constructor fields + listeners, `getName`, `destroy`, the keylog `newListener` hook), `globalAgent` (get/set; `new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 })`), `WebSocket`/`CloseEvent`/`MessageEvent` (the guest's globals) | `_connectionListener`, `request`, `get`, `createServer`, `setGlobalProxyFromEnv` given an http(s) proxy; construction of `ClientRequest`, `IncomingMessage`, `OutgoingMessage`, `Server`, `ServerResponse`; `Agent#createConnection`/`addRequest`/`createSocket`/`removeSocket`/`keepSocketAlive`/`reuseSocket`, an Agent's `'free'` event, `Agent` option `proxyEnv` naming an http(s) proxy |
| https | `Agent` (http's + `maxCachedSessions`, `_sessionCache`, `getName`, `_getSession`/`_cacheSession`/`_evictSession`), `globalAgent` | `request`, `get`, `createServer`; construction of `Server`; `Agent#createConnection` |
| net | `isIP`, `isIPv4`, `isIPv6`, `_normalizeArgs`, `getDefaultAutoSelectFamily`/`setDefaultAutoSelectFamily`, `getDefaultAutoSelectFamilyAttemptTimeout`/`setDefaultAutoSelectFamilyAttemptTimeout` | `connect` (= `createConnection`), `createServer`, `_createServerHandle`; construction of `Server`, `Socket` (= `Stream`), `BlockList`, `SocketAddress`; `BlockList.isBlockList`, `SocketAddress.isSocketAddress`, `SocketAddress.parse` |

## Challenge

challenge: 2026-11-24 — 4 problems (fresh reviewer, final written-result check): `proxyEnv` loud without a Decision and at load for an env with no proxy → ported, loud only for a usable proxy; the no-network loud constructors narrow the manager's rule → recorded as my decision, returned to the manager as a fork; Acceptance 3's `util.inherits` unproven → cases added; Acceptance 4's mask looser than stated → only `docProps/core.xml` masked.

## User scenario

pptxgenjs 4.0.1 in the state of `createSandbox({ snapshot })`; `sandbox.exec('gen/pptx.cjs',
{ args: ['out/probe.pptx'] })` with the probe's canonical generator (text, shape, `data:` image,
table, chart; `pptx.writeFile`). Today: exit 1, stderr `NotImplementedError: Not implemented:
isolate-host.https`. Node over the same files: exit 0, `wrote out/probe.pptx`, a valid pptx.

## Acceptance

1. `require('node:http'|'node:https'|'node:net')` in the guest (`runCode`; a sandbox file loads them in Acceptance 3/5) returns a module whose shape equals live `node -e`: own names in order, descriptor kinds and flags, `typeof`, function `name`/`length`/`prototype` presence, class statics, prototype chains (`EventEmitter`, `Readable`, `Duplex`, legacy `Stream`, `net.Server`, `http.Agent`, `http.OutgoingMessage`), identities (`net.Stream === net.Socket`, `net.createConnection === net.connect`, `http.WebSocket === WebSocket`), data values. Proof: `packages/isolate-host/tests/egress-modules.test.ts` → ADR-0557
2. Every real member of the table equals Node on Parity cases 2–7 (same test file) → ADR-0557
3. Every loud member of the table throws `NotImplementedError` with feature `isolate-host.<module>.<member>` when called or constructed, also through a subclass declared with `class extends` / `util.inherits`; `require`, `import()`, property reads and subclass declaration throw nothing. `egress.test.ts` stays unchanged and green → ADR-0568
4. The probe's canonical `gen/pptx.cjs`, byte for byte, run by `sandbox.exec` over pptxgenjs 4.0.1's installed closure: exit 0, stdout equal to `node gen/pptx.cjs` over the same files, every OOXML part equal to Node's once `docProps/core.xml` timestamps are masked; no `unhandledRejection` listener, `process.release` untouched. The same for an image added by `path` (a PNG file in the state) → scenario
5. `import('node:http'|'node:https'|'node:net')` from a CommonJS file: the namespace's keys and `default` identity equal Node's; `node -e`'s lazy `http`/`https`/`net` globals return the same modules as `require` → ADR-0557
6. `docs/public/compat/isolate-host.md` network row states loads-✅ / use-❌ with the loud list; ADR-0557 §6 carries a dated manager-decision correction (no longer "at require") → ADR-0557
7. Warm `runCode('console.log(1)')` p50 measured before and after (`packages/isolate-host/scripts/measure.mjs`), reported in the PR; modules are built on first `require`, so a run that loads none pays only the bundle bytes → ADR-0563

## Reference contract

- Oracle: Node v24.16.0 (`process.execPath` of the test run), `lib/_http_agent.js`, `lib/https.js`, `lib/net.js`, `lib/_http_common.js` as printed by `Function.prototype.toString`.
- Mechanism: per-member port of Node's own JS for the real members; data tables shared with `@riftydev/net` (identical to Node v24.16.0, checked by parity).

## Parity cases

1. Shape dump (Acceptance 1) for each of the three modules: `runCode` output = `node -e` output, exact → ADR-0557
2. `net.isIP`/`isIPv4`/`isIPv6` over IPv4/IPv6/zone/mapped/invalid strings and non-strings (`5`, `undefined`, `{}`) → ADR-0557
3. `http.validateHeaderName` (with and without `label`) and `validateHeaderValue` for every code unit 0–255 and a non-Latin-1 one, `''`, non-strings, `undefined` value: return or error `name`/`code`/`message` → ADR-0557
4. `net._normalizeArgs` for `[]`, `[80]`, `[80, 'h']`, `['/tmp/s']`, `['80']`, `[{port: 1}]`, `[80, cb]`: result JSON, callback slot type, `Symbol(normalizedArgs)` present → ADR-0557
5. `net.get/setDefaultAutoSelectFamily(AttemptTimeout)`: defaults (`true`, `250`), round trip, clamp to 10, every validation error (`ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`); `http.setMaxIdleHTTPParsers` errors → ADR-0557
6. `new http.Agent(opts)` (incl. `proxyEnv` without a usable proxy, a `\n` in one) / `https.Agent(opts)` without `new` / subclass by `class extends` and `util.inherits` + `Agent.call(this)`: non-EventEmitter own fields and values, `options` null prototype, `'free'`/`'newListener'` listener counts, the keylog hook removing itself, `scheduling`/`maxTotalSockets` errors, `getName` (http, https with TLS options), `destroy()`, https session cache ops; `http.globalAgent`/`https.globalAgent` the same fields; `http.globalAgent = x` read back → ADR-0557
7. `import()` namespace keys + `default` of the three modules from a CJS file; `node -e` globals `http`/`https`/`net` `=== require(...)` → ADR-0557
8. pptx canonical generator and image-by-path generator: guest file = Node file per part (Acceptance 4) → scenario

## Out of scope

- Everything in the loud column above: `NotImplementedError('isolate-host.<module>.<member>')`, compat ❌ (no network, ADR-0557 §6).
- Own prototype members of the loud-constructed classes (`http.Server.prototype.listen`, `ServerResponse.prototype.setHeader`, `net.Socket.prototype.write`, …): absent; the chain is Node's, so inherited EventEmitter/stream members exist. Reachable only without the constructor (`Object.create(<Class>.prototype)`, `Reflect.construct(Base, [], <Class>)`, the prototype itself): a read is a silent `undefined` (`Object.create(http.IncomingMessage.prototype).headers`, Node `{}`), a call `TypeError … is not a function`, compat ⚠️.
- Node's argument validation before a loud member's throw (`http.request(1)`: Node `ERR_INVALID_ARG_TYPE`, guest the named gap), compat ⚠️.
- `https.Server.prototype` chains to the guest's `net.Server.prototype`, not `tls.Server.prototype` (rifty's `tls` stub, `null-net-stubs.ts`, is not Node-shaped), compat ⚠️.
- A null-prototype argument in a header-validation message prints `{}` (rifty's `util.inspect`): `backlog/runtime-js/inspect-null-prototype-prefix`, compat ⚠️.
- EventEmitter instance internals on an Agent (`_events`, `_eventsCount`, `_maxListeners`, `Symbol(shapeMode)`, `Symbol(kCapture)`): rifty's EventEmitter keys — `backlog/runtime-js/events-prototype-shape`.
- `node:zlib`, `node:child_process`, `node:worker_threads` (`HOST_CEILING_MODULES`): the next unit.
- `import()` in `node -e` code: still ends the run (`isolate-host.dynamic-import`, ADR-0557 §5).
- Browser hosts: their modules are `@riftydev/net`'s, unchanged.

## Decisions

- Agent construction is real: Node's constructor opens nothing, and `globalAgent` must be an Agent on read; the pool use (`addRequest`, `createConnection`, `'free'`) is the loud part. Differs from browser hosts (ADR-0464 §4: construction loud there) because no request can silently ignore an agent here — every request is loud.
- Narrows the manager's "no network → real" rule, taken by me, returned to the manager as a fork: construction of `IncomingMessage`/`OutgoingMessage`/`ServerResponse`/`http.Server`/`https.Server`/`net.Server`/`net.Socket` is loud although Node's constructor opens no connection (their real behaviour is Node's whole message/stream/server machinery, which the guest does not have; consumer: light-my-request 6.8.0 `lib/response.js:10` `http.ServerResponse.call(this, req)`, i.e. `fastify.inject`); `BlockList`/`SocketAddress` likewise (no network, Node backs them in C++, no rifty implementation on any host; `SocketAddress.parse` needs `URL`, a guest ceiling). All named gaps, compat ❌ — never a stub; their message names that reason (`Node's HTTP message, server and socket objects are not in the rifty isolate host`; `not implemented in the rifty isolate host (Node backs it natively)`), not "no network". Manager confirmed (а) 2026-11-24: stays loud; real messages without a connection are not started (they hinge on Web APIs in the isolate, the user's call).
- `Agent` option `proxyEnv`: Node's `parseProxyConfigFromEnv` ported (no proxy for the protocol → `null` config, `\r`/`\n` → `ERR_PROXY_INVALID_CONFIG`); a usable http(s) proxy URL is the route the Agent's connections take (and Node's `ProxyConfig` parses a `URL`, a guest ceiling) → the gap.
- Config setters that only network code reads are real: `setDefaultAutoSelectFamily*` validate and store (their getters read it back), `setMaxIdleHTTPParsers` validates (Node's pool size has no reader without a connection).
- `setGlobalProxyFromEnv`: Node's own check of the env ported (`validateObject`, `parseProxyUrl`); no http(s) proxy → Node's no-op restore, a proxy → the gap (it reroutes the global agents and fetch).
- Data tables (`METHODS`, `STATUS_CODES`, `maxHeaderSize`) and the IP grammar come from `@riftydev/net` through a side-effect-free subpath (`@riftydev/net/node-data`): one copy; the rest of `@riftydev/net` stays out of the guest bundle (browser transports, `EventTarget` at load).
- Modules are built on first `require` and once per realm, so identities hold (`https.Agent` extends this realm's `http.Agent`).
- Acceptance 4 runs real pptxgenjs 4.0.1 as an `@riftydev/isolate-host` devDependency, its installed closure copied into the sandbox state and into the oracle's temp dir — the same files on both sides.
