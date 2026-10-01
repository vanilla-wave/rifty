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

## node-semver validRange discrimination (7.8.4, bundled with npm 11.17.0)

Probed 2026-10-01 (`semver.validRange`) to pin which bare forms are ranges in
npm at all, cross-checked against what rifty's `semver.ts` `matchesRange`
evaluates correctly:

```
"8.0.16" → "8.0.16"                     "x.1" / "8.x.2" → null (not ranges)
"^8" / "8.x" / "8" / "v8" / "=8" → ranges   "1.2-beta" / ">=1.2-beta" → null (tags)
"*" / "x" → "*"                          "latest" / "bcryptjs" → null (tags/names)
"1.2.3-beta" → "1.2.3-beta"              "8.0.0 - 8.9.9" → range (hyphen)
"<8.x" / "^8.x" / "~1.x" / "=8.x" → ranges (operator + wildcard base)
"1.2+build" → ">=1.2.0 <1.3.0-0"         ">=8.0.0 <9" → range
```

Rifty classifier = npm-range ∧ rifty-evaluates-correctly. npm-valid forms
rifty mis-evaluates (operator+wildcard, hyphen, partial+build) stay on the
loud packument-404 path; npm-invalid forms (non-terminal wildcard,
partial+prerelease, names/tags) keep name semantics.

Second probe (same semver 7.8.4), pinning partial-base operator and grammar
edges:

```
"<=8" → "<9.0.0-0"   "=8" → ">=8.0.0 <9.0.0-0"   ">8" → ">=9.0.0"   (npm zero-fills UP)
">=8" → ">=8.0.0"    "<8" → "<8.0.0-0"           (rifty's down-fill agrees)
"<=8.0.16" / "=8.0.16" / ">8.0.16" → exact comparator (both agree)
"8 ||" / "|| 8" / "8 || || 9" → "*"   (empty branch = match-all)
"8.0.16-01" → null (leading-zero prerelease)   "8.0.16+01" → valid (build allows zeros)
"8.0.16-beta..1" → null (empty prerelease identifier)
```

Third probe (same semver 7.8.4 + npa 13.0.2), pinning version-core numeric
bounds — node-semver rejects leading zeroes, >16-digit components, and values
≥ `Number.MAX_SAFE_INTEGER`:

```
validRange: "08" / "08.0.16" / "08.x" / "00" → null   "0" / "0.0" / "0.0.0" → valid
validRange: "12345678901234567" / "9999999999999999" / "9007199254740991" → null
validRange: "9007199254740990" → ">=9007199254740990.0.0 <9007199254740991.0.0-0"
npa type:   "08"/"00" → range   "08.0.16"/"8.0.16-01" → version (loose)
npa type:   "12345678901234567" / "9999999999999999" / "9007199254740991" → tag
```

npm-pick-manifest RESOLVES the loose forms: `"08"` → `>=8.0.0 <9.0.0-0` →
picks 8.0.16; `"08.0.16"` → exact 8.0.16 (probed 2026-10-01 against npm
11.17.0's bundled npm-pick-manifest). node-semver's length bound: the SemVer
constructor rejects >256 chars, but range parsing strips build metadata
first (BUILDSTRIPRE) — `"8.0.16-" + "a"*250` (257) → null, `"8.0.16+" +
"b"*300` (307) → valid `"8.0.16"`.

Rifty excludes every out-of-bounds form from the range classifier
conservatively (loud replacement-name path), including the loose-resolvable
leading-zero forms and `"8.0.16-01"` — recorded divergences from npm
resolution, not npm failures.

## rifty today (main 0c4c1b07)

`overrides.ts` `parseTarget("8.0.16")` → `{name: "8.0.16", range: null}` →
packument fetch for "8.0.16" → 404 (evidence §I1). Bare non-range values
(`"bcryptjs"`) resolve as a REPLACEMENT package — diverges from npm's
same-name dist-tag reading; recorded, not claimed by this unit.
