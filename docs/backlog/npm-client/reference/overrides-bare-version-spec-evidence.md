# Evidence — npm-client/overrides-bare-version-spec

Pickup probes, 2026-10-01, host macOS, Node v24.16.0, npm 11.17.0
(npm-package-arg 13.0.2 — the parser arborist's OverrideSet resolves every
override value through, `npa.resolve(keyName, value)`).

## npa resolve discrimination (override value forms)

```
$ node -e '
const npa = require(".../npm/node_modules/npm-package-arg");
for (const [name, spec] of [["vite","8.0.16"],["vite","^8"],["vite","bcryptjs"],["vite","vite@8.0.16"],["vite","npm:bcryptjs@2.x"],["vite","$dep"],["vite","latest"],["vite","8.x"]])
  ... npa.resolve(name, spec, "/tmp") ...'
npm 11.17.0 npa 13.0.2
{"spec":"8.0.16"}  → type "version", name "vite", fetchSpec "8.0.16"
{"spec":"^8"}      → type "range",   name "vite", fetchSpec "^8"
{"spec":"8.x"}     → type "range",   name "vite", fetchSpec "8.x"
{"spec":"bcryptjs"}→ type "tag",     name "vite", fetchSpec "bcryptjs"   (same-name dist-tag, NOT a different package)
{"spec":"latest"}  → type "tag",     name "vite", fetchSpec "latest"
{"spec":"vite@8.0.16"}    → EINVALIDTAGNAME   (rifty's name@range spelling is a rifty extension, not npm)
{"spec":"npm:bcryptjs@2.x"} → type "alias"
{"spec":"$dep"}    → EINVALIDTAGNAME at npa level (arborist handles `$ref` before npa)
```

Reads: a bare value that parses as a semver range binds to the KEYED package
(same name, that range). A bare non-range value is a dist-tag on the keyed
package — also same-name. `$ref` is an arborist feature above npa.

## End-to-end oracle (npm 11.17.0, registry.npmjs.org)

`docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md` §Oracle:
manifest `devDependencies {vitest 4.1.11}` + `overrides {"vite": "8.0.16"}` →
`npm install --package-lock-only` produces exactly one vite entry
`node_modules/vite@8.0.16` satisfying vitest's `^6.0.0 || ^7.0.0 || ^8.0.0`
edge.

## rifty today (main 0c4c1b07)

`overrides.ts` `parseTarget("8.0.16")` → `{name: "8.0.16", range: null}` →
packument fetch for "8.0.16" → 404 (evidence §I1). Bare non-range values
(`"bcryptjs"`) resolve as a REPLACEMENT package — diverges from npm's
same-name dist-tag reading; recorded, not claimed by this unit.
