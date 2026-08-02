# Sass 1.100.0 / sass-embedded 1.100.0 Node differential

Recorded 2026-08-02 on Node v24.16.0, Darwin arm64, against exact public npm
packages `sass@1.100.0`, `sass-embedded@1.100.0`, and selected platform package
`sass-embedded-darwin-arm64@1.100.0`. The complete normalized results are:

- `tools/shadow-registry/src/fixtures/sass-1.100.0-contract.json` — SHA-256
  `bf29a8ac815b5ca72571e02bbfc24b670d50c2a982cee5114117f7c36c82d424`;
- `tools/shadow-registry/src/fixtures/sass-embedded-1.100.0-contract.json` —
  SHA-256
  `13740911f6ab5a9d3dc256f8f7a037986e1c4e48114dc52ad99866f514cafe8d`;
- `tools/shadow-registry/src/fixtures/sass-1.100.0-node-oracle-environment.json`
  — SHA-256
  `742255bb8a4a0aac7797dc157744b90197f7cd90b5960625f6d18cee51737d2e`;
- `tools/shadow-registry/src/fixtures/sass-1.100.0-async-importer-deadlock.json`
  — SHA-256
  `c7c8833a3541aceda8a034b9c8c7ee153faae549ba22aab956553732cd99b3c2`.

The shared nine-row probe SHA-256 is
`5cd76232178b084b00b09e954ea93cd3969d00ac13c1eebcb35baa3ecc9ca740`.
Generator SHA-256 is
`b47a1eb333d670e0fce1b4cc1f26132982cde48ddb59debd9301548725610556`.
The isolated deadlock probe SHA-256 is
`941c5abda4013bf0bdeba9b88558932b0415a48b179364cdc192ad5c11e4677b`.

## Reproduce

```sh
node --version
npm --version

repo_root=$PWD
oracle_root=$(mktemp -d)
cd "$oracle_root"
npm init -y
npm install --save-exact --ignore-scripts \
  --registry=https://registry.npmjs.org \
  sass@1.100.0 sass-embedded@1.100.0
cd "$repo_root"

pnpm tsx tools/shadow-registry/tools/generate-sass-contract-oracles.ts \
  --check "$oracle_root"
node tools/shadow-registry/tools/sass-async-importer-deadlock-probe.mjs \
  --check "$oracle_root"
```

The environment artifact pins package integrity plus package.json and CJS/ESM
entry bytes. It records:

- `sass@1.100.0` integrity
  `sha512-B5j0rYMlinhhOo9tjQebMVVn0TfyXAF+wB3b2ggZUuJ/is/Y+7+JGjirAMxHZ9Z3hIP98NPfamlAkBHa1lAaXQ==`;
- `sass-embedded@1.100.0` integrity
  `sha512-Ut8wlQSk19tm7jMK6mz6cF1+e+E7tUnW2tM02zQDPnOTcVbV8qCQG8UWxZkkNlY50+hV3hqP24OOkUlMz8xBpw==`;
- `sass-embedded-darwin-arm64@1.100.0` integrity
  `sha512-1PVlYi61POo93IT/FfrG1mc1tAHxeSTyUALF2aOFmXGWjVXr3bQzEQiBGCOvQbj/ix+5hNyXFXcEMEyKvtUJJA==`.

## Nine rows

| row | exact relation |
|---|---|
| CJS/ESM module shape | DIFF: embedded removes pure Sass CJS dead keys `cli_pkg_main_0_`, `load`, `loadParserExports_` and ESM `parser_`; its ESM namespace instead carries undefined type-only `CalculationOperator` |
| sync/async compile | MATCH: CSS, `loadedUrls`, absent sourceMap |
| source map | MATCH: CSS and byte-identical normalized JSON including mappings, sources, and sourcesContent |
| compiler lifecycle | MATCH through two compiles and disposal; DIFF only post-dispose messages, which embedded prefixes with `Compiler caused error: Sync|Async` |
| modern importers | MATCH: sync importer and promised async importer under async compile, including `containingUrl`, call order, CSS, and loaded URLs |
| logger | MATCH: `@warn`, slash-div deprecation id/message/stack/span, and CSS |
| errors | DIFF: embedded prefixes `Error: ` in message/toString; syntax-error `span.url` is undefined instead of pure Sass null; sassMessage, sassStack, coordinates, text, and missing-use URL match |
| info | DIFF: pure Dart/dart2js identity versus exact `sass-embedded\t1.100.0` |
| legacy renderSync | MATCH CSS/stats keys; DIFF: embedded sends legacy-js-api deprecation to stderr and reports the warning stack as `-`, while pure Sass sends the deprecation through the logger and reports `stdin` |

The committed JSON files contain every input result, URL, warning, error
field, source coordinate, compiler-disposal result, and export-identity list;
the table is only an index.

## Sync compile plus async importer

This row never runs in-process. The probe starts each implementation in its own
detached process group, waits 2,000 ms, and sends `SIGKILL` to the whole group
on timeout so the Dart child cannot survive. It runs each branch twice.

Both pure-Sass runs exit 0 after throwing the exact synchronous-contract error:

```text
The canonicalize() function can't return a Promise for synchronous compile functions.
  ╷
1 │ @use 'tokens';
  │ ^^^^^^^^^^^^^
  ╵
  - 1:1  root stylesheet
```

Both real sass-embedded runs emit no stdout/stderr and remain stuck until the
2,000 ms timeout; the process group exits via `SIGKILL`. The facade therefore
preserves pure Sass's loud throw and records this one behavior as compat ⚠,
never as a parity match.
