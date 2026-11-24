# Legacy `node:url` / `node:querystring` owner (ADR-0574)

`generated/`: Node v24.16.0 `lib/url.js`, `lib/querystring.js`, `lib/internal/{querystring,constants}.js`
and `internal/url`'s protocol sets, unedited, with source hashes and license; generator only
(`tools/publishing/generate-url-legacy.mjs`, vendored text in `tools/publishing/node-url-legacy/vendor/`).
`bindings.ts`: what upstream reads from Node's internals — intrinsics, error classes, validators,
the active process, `bindingUrl.format` (named gap where an option changes the output).
`to-ascii.ts`: ada's `to_ascii` step — ASCII as is, else the load-time `URL` + ada's punycode round trip.
`inside-node-modules.ts`: DEP0169's 4-frame window over V8 CallSites (guest frame = `isEval()`).

No hand-written parsing, formatting or escaping. Proof: `../url-legacy-corpus.test.ts`,
`tests/browser-unit/url-legacy.spec.ts`, `packages/isolate-host/tests/url-legacy.test.ts`.
