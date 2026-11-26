# Node v24.16.0 stream core (ADR-0575)

`generated/`: Node's `lib/stream.js`, `lib/stream/promises.js`, `lib/internal/streams/*.js` (17),
`lib/internal/fs/streams.js`, `internal/{assert,events/abort_listener,webstreams/adapters}` whole, and
the statements of `internal/{errors,validators,util,fs/utils,url}` the others read; generator only
(`tools/publishing/generate-node-streams.mjs`, vendored text `tools/publishing/node-streams/vendor/`,
`pnpm check:node-streams-drift`). `bindings.ts`: what that code reads outside itself — primordials,
`internalBinding`, the `require` ids it does not carry, `process` — each as Node's binding does.
`zlib-constants.ts`: `internalBinding('constants').zlib`'s data.

Belongs: the generated core and its bindings. Not: wiring into `@riftydev/io`/`node:stream`/`fs`
(unit 8c, `runtime-js/stream-core-node-sources`), fixes of the rifty modules it binds to (their units).
No product module imports this directory until 8c (`check:arch`
`node-stream-core-has-no-production-importer`).

Proof: `tests/integration/node-streams-differential.test.ts` (the core on Node's bindings = live
Node, and = the core on these bindings but pinned rows), `packages/io/tests/node-stream-bindings.test.ts`,
`tools/checks/node-streams-generator.test.ts`.
