# Sass 1.100.0 / sass-embedded 1.100.0 Node differential

Recorded 2026-08-02 on Node v24.16.0, Darwin arm64, against exact public npm
packages `sass@1.100.0`, `sass-embedded@1.100.0`, and selected platform package
`sass-embedded-darwin-arm64@1.100.0`. The complete normalized results are:

- `tools/shadow-registry/src/fixtures/sass-1.100.0-contract.json` — SHA-256
  `7b1aab818e3e20e876f6c951c4d15e46cb131fb2674e7a6d3c93546dcf17f6fa`;
- `tools/shadow-registry/src/fixtures/sass-embedded-1.100.0-contract.json` —
  SHA-256
  `9052e0b4d90617d8fa1bb5eccd53eb69444fb0a0ac0628248bdcca0cd6de0abd`;
- `tools/shadow-registry/src/fixtures/sass-1.100.0-node-oracle-environment.json`
  — SHA-256
  `742255bb8a4a0aac7797dc157744b90197f7cd90b5960625f6d18cee51737d2e`;
- `tools/shadow-registry/src/fixtures/sass-1.100.0-async-importer-deadlock.json`
  — SHA-256
  `c7c8833a3541aceda8a034b9c8c7ee153faae549ba22aab956553732cd99b3c2`.

The fixtures were generated from the shared nine-row probe at commit
`266dfd38cef279090a4c724157fa9c2edf7bba14`, SHA-256
`8badbdfd4db4fb499fee71cc80aaa4eaefff27399c24de043206d37b040656a3`.
The lifecycle row includes initialized-instance prototype/constructor identity
and stable public method identity/name/arity. The module row includes the four
compiler lifecycle accessor exports. `sassFacadeContract()` derives only
rifty's two selected direct-constructor gap fields; it does not rewrite those
external oracle facts.
Generator SHA-256 is
`8200db6834c892acc413c71c041d61b0bb7c3a77f023e5cb1de29a16aa9f5864`.
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
| CJS/ESM module shape | DIFF: embedded removes pure Sass CJS dead keys `cli_pkg_main_0_`, `load`, `loadParserExports_` and ESM `parser_`; its ESM namespace instead carries undefined type-only `CalculationOperator`; CJS and ESM-default compiler lifecycle exports are enumerable configurable accessors |
| sync/async compile | MATCH: CSS, `loadedUrls`, absent sourceMap |
| source map | MATCH: CSS and byte-identical normalized JSON including mappings, sources, and sourcesContent |
| compiler lifecycle | MATCH through two `compile(path)` and two string compiles per sync/async compiler; public method identities are stable in both; DIFF: embedded initialized instances have the exported length-one constructor as direct prototype constructor while pure Sass returns an internal subclass, embedded methods retain exact names/arity on that prototype, embedded prefixes direct-construction and both post-dispose method errors with `Compiler caused error: ...`, and async dispose resolves `undefined` where pure Sass resolves `null` |
| modern importers | MATCH: sync importer and promised async importer under async compile, including `containingUrl`, call order, CSS, and loaded URLs |
| logger | MATCH: `@warn`, slash-div deprecation id/message/stack/span, and CSS |
| errors | DIFF: embedded prefixes `Error: ` in message/toString; syntax-error `span.url` is undefined instead of pure Sass null; under one TTY pure Sass defaults message/toString color on while embedded defaults it off; sassMessage, sassStack, coordinates, text, and missing-use URL match |
| info | DIFF: pure Dart/dart2js identity versus exact `sass-embedded\t1.100.0` |
| legacy renderSync | MATCH CSS/stats keys; DIFF: embedded sends legacy-js-api deprecation to stderr and reports the warning stack as `-`, while pure Sass sends the deprecation through the logger and reports `stdin` |

The schema-two JSON files contain every input result, URL, warning, error field,
source coordinate, compiler-disposal result, export identity, initialized
compiler prototype/constructor identity, and public-method stability fact.
Lifecycle path compilation uses a real caller-created SCSS file and normalizes
only its exact URL to `file:///contract/compiler.scss`; the table is only an
index.

## Same-PTY alert color

A supplemental raw probe ran both exact packages inside one BSD `script` PTY
(`stdout.isTTY === true`, `TERM=dumb`). For the same syntax error it counted ESC
bytes without rewriting the fields:

| package | default message / toString | `alertColor:false` | `alertColor:true` | sassStack |
|---|---:|---:|---:|---:|
| `sass@1.100.0` | 12 / 12 | 0 / 0 | 12 / 12 | 0 |
| `sass-embedded@1.100.0` | 0 / 0 | 0 / 0 | 12 / 12 | 0 |

Reproduce from the exact tree above with `script -q /dev/null`, require each
package, call `compileString('a { color: red;', options)` for omitted, false,
and true `alertColor`, then count `\x1b` in `message`, `String(error)`, and
`sassStack`. The facade therefore supplies only the embedded default
`alertColor:false`; explicit caller values remain authoritative.

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
