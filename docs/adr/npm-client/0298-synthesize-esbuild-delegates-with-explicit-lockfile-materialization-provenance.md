# ADR 0298: Synthesize esbuild delegates with explicit lockfile materialization provenance

Status: Accepted
Date: 2026-07

> TL;DR: resolve the real public `esbuild@0.28.0` coordinate, materialize the
> builtin delegate from an immutable local recipe, and record that synthesis
> explicitly in each lockfile entry; never fetch or pretend to install the
> `@esbuild/wasi-preview1` alias tarball.

## Context

ADR-0249 moves executed esbuild WASM to an exact npm-proven runtime-asset
descriptor. The installed `@esbuild/wasi-preview1@0.28.0` package is now only a
trigger for ADR-0188's two-file `esbuild` overlay: its packument and tarball are
downloaded, then none of its package bytes execute.

The authoritative packed-consumer control uses a fresh temp consumer, empty npm
cache, 13 packed first-party plus 74 external packages, fresh Chromium context,
ephemeral Workbench with `memory-session` storage, the loopback STD-registry
origin `http://127.0.0.1:54321`, and the boundary cold open through preview plus
native same-document HMR readiness. It observed:

- `GET /@esbuild%2Fwasi-preview1`: 627 response-body bytes;
- `GET /-/tarballs/%40esbuild%2Fwasi-preview1-0.28.0.tgz`: 5,057,200
  response-body bytes;
- alias total: 5,057,827 response-body bytes.

This is fixture-specific evidence over the 10,029,632-byte
`vite-node-modules.json.gz` whose SHA-256 is
`7233a01db2259171e0607bbb9891ddc7efe78369f59077e44675300cccca7aa5`.
The validating registry repacks that snapshot, so its tarball SRI intentionally
differs from the official registry snapshot. The control's offline install,
typecheck, build, and real Chromium journey are GREEN, including
`cache-check -> fetch -> verify -> persist -> ready`. The after run uses the
same origin because the packument embeds its tarball URL. This evidence cannot
be quoted as official npm-registry bytes or as the narrower runtime-asset fill
cost.

Writing the delegate under the public name without marking the lockfile would
lie: npm's `resolved` and `integrity` fields mean registry tarball bytes, while
the installed files are a rifty recipe. The marker is public lockfile behavior,
and synthesis also changes public acquisition provenance.

## Decision

### Public selection, builtin synthesis

The active recipe id is
`rifty.shadow-substitution.esbuild-synthesized-delegate.v2`; its runtime adapter
remains `rifty.runtime-adapter.esbuild-vite.v1`.

For an `esbuild` request with no matching user override, npm-client uses its
ordinary public-packument version selection first. It does not filter the
packument to a rifty-supported version or silently pin an older version. The
selected version must be exactly `0.28.0` and satisfy the caller's range;
otherwise installation throws
`NotImplementedError('shadow-registry.esbuild@<selected-version>')`. Registry
failure remains the ordinary bounded registry error; it never falls back to a
hard-coded version.

For admitted `esbuild@0.28.0`, one generated immutable builtin recipe supplies:

- package name/version `esbuild@0.28.0`;
- empty dependencies, optional dependencies, peer dependencies, and bin map;
- byte-for-byte the current ADR-0188 overlay's `package.json` and
  `lib/main.cjs` files, including the single CJS import/require/default identity
  and the exact owner-published runtime-slot delegate.

`@riftydev/shadow-registry` root exports the recipe as clone-safe readonly data
(`builtinSyntheticPackageRecipes` plus its data type). Each row contains only
substitution/public/version/adapter identities and the closed materialization
data: kind, recipe digest, dependency/bin records, and package-relative UTF-8
files. It exports no constructor, callback, VFS handle, resolver node, or
adapter interface. npm-client alone applies it; Workbench and Eddy consume the
resulting plan/lockfile through their existing interfaces.

The package joins the normal resolved placement and `link()` write pass; it is
not a post-link overlay. No `esbuild` or `@esbuild/wasi-preview1` tarball is
requested or entered into the tarball cache, and no alias directory is written.
The public esbuild packument remains resolution evidence.

This is only the owner-prepared Vite 7 runtime contract. The recipe deliberately
has no `bin`: `which esbuild` is absent and direct shell invocation exits
nonzero as command-not-found. Importing the delegate outside owner Vite
preparation throws the existing exact invariant
`rifty invariant: esbuild runtime slot is not initialized`. Both are compat
❌, not implied capabilities of installing the public package name.

An explicit user override wins before this builtin, including a same-name
`esbuild` override. That request enters the ordinary verifying package path and
inherits its native/lifecycle gaps; when admitted, it downloads, records, and
replays normally. It emits no builtin applied trace and never gains builtin
runtime assets by installed-name coincidence.

The synthesis emits on fresh resolution and replay:

`npm: esbuild@<requested-range-or-*> → esbuild@0.28.0 (synthesized delegate from shadow registry, ADR-0298)`

It also emits the existing applied-substitution value with the new recipe id.

### Exact lockfile materialization record

The `node_modules/esbuild` v3 lockfile entry omits `resolved` and `integrity`:
those fields would falsely claim the upstream tarball supplied installed bytes.
It carries this exact namespaced record instead:

```json
{
  "rifty": {
    "materialization": {
      "protocol": "rifty.lockfile-package-materialization/v1",
      "kind": "synthesized-shadow-delegate",
      "substitutionId": "rifty.shadow-substitution.esbuild-synthesized-delegate.v2",
      "recipeSha256": "<64 lowercase hex digits>"
    }
  }
}
```

`recipeSha256` is SHA-256 over the recipe row's canonical clone-safe
tree-affecting data, excluding the digest field itself. One generator in
shadow-registry owns the generated export, canonical digest, runtime
materializer input, and drift fixture; replay does not implement a second
digest or recipe.
The lockfile row's version, top-level ADR-0295 applied trace, recipe ledger, and
entry marker must agree exactly before any file write.

One package-private deep materialization module owns the closed registry versus
synthesized union, canonical key, recipe admission, marker encode/decode,
package bytes, lockfile projection, and acquisition-provenance projection.
Registry fetch/cache and builtin recipe are its two real adapters at that seam;
no adapter interface becomes public. `install()` is the external test surface,
while strict marker decoding remains an internal fault-test seam.

Matching replay regenerates the same files without registry or cache reads. A
known historical recipe that is no longer active makes lockfile coverage
diverge and forces an ordinary live resolve plus lockfile rewrite. An unknown
protocol/kind/id throws
`NotImplementedError('npm-client.lockfile.packageMaterialization')`; malformed
fields, a wrong digest under the active id, duplicate evidence, or trace/entry
disagreement throws `EBROKENLOCK` with delete-and-reinstall recovery. It never
falls through as an ordinary tarball.

Placement, scheduled-visit dedupe, fetch/materialization single-flight, and
acquisition-provenance dedupe use a package-private materialization key in
addition to name/version. Registry and synthesized `esbuild@0.28.0` are not the
same package bytes: when a parent-scoped user override makes both reachable,
one occupies the flat slot and the other nests under its requesting parent.
They never collapse because their public coordinates match. Provenance retains
both rows with their distinct transports; the synthetic row still emits no
tarball progress event.

ADR-0295's recipe ledger remains append-only. It retains
`rifty.shadow-substitution.esbuild-wasi-preview1.v1 →
@esbuild/wasi-preview1` and adds the v2 synthesized `esbuild` marker rule.
Missing-trace ambiguity therefore continues to scan both historical names.
Trusted or snapshot bytes carrying the old recipe cannot be reinterpreted as
the new plan; the changed install artifact identity sends them through normal
re-acquisition.

### Provenance and Eddy

`PackageTransport` adds `synthesized`. The esbuild row always reports that
transport, including an Eddy-backed install; `registry`, `cache`, and `eddy`
would each falsely describe its installed bytes. Live selection still reports
resolution `metadata`; a matching lockfile replay reports `lockfile`. The
tarball-oriented `onPackage` hook emits no event for the synthesized row. A
mixed user/synthetic same-coordinate tree reports both acquisition rows rather
than deduping them by the lossy name/version pair.

Eddy carries only user-authored `overrides` in its request. The builtin recipe
is shared policy, never serialized as a user override. Eddy's server uses the
same npm-client resolution/materialization path and writes the same marker.
Its bundle harvester and completeness gate require the exact marker and omit a
tarball member only for that proven synthesized entry. The client validates the
marker before adoption and uses the same materializer on replay.

An unsupported, historical, corrupt, or recipe-drifted marker makes Eddy
decline visibly to STD before staging the lockfile; it cannot return
`source:'eddy'` and then fetch registry bytes for the synthesized entry. The
marker participates in canonical closure hashing, so learned pins and immutable
bundle keys change with the recipe evidence.

### Tree identity and measurement

The install-artifact recipe includes the full synthesized package recipe,
protocol/kind/id, and removes the old esbuild baked override and alias-keyed
shim. Those changes regenerate `installArtifactIdentity` and dependency
snapshots. A delegate file, package metadata, materialization rule, adapter
binding, or recipe id change flips tree identity and must mint a new
substitution id. Asset source/member/SRI/cap changes only the independent
required-set digest; they do not relink the tree.

The after measurement repeats the fixed control origin, transport, cache,
Chromium, storage class, and end-to-end boundary. It must record zero alias
requests and zero alias response bytes, retain an audited list of every
registry response, and report both the exact total response-body delta and its
component URLs. A latency delta is reportable only from these matched runs.
The fixed-control alias total is not itself the net delta if replacement
response bodies differ.

## Consequences

- Vite receives the same package-facing delegate and exact runtime asset while
  cold install stops transferring the unused alias response bodies.
- Fresh, lockfile, snapshot, and Eddy paths have one explicit materialization
  truth; npm-compatible readers may ignore the namespaced field but rifty never
  mistakes it for registry integrity.
- The public provenance union gains one honest value and lockfiles gain a
  rifty-specific per-entry extension.
- Shadow-registry gains one readonly declarative recipe-data export; executable
  application remains inside npm-client's package-private deep module.
- Other baked redirects and external synthetic recipes are unchanged. A
  generic public synthesis registry or plugin interface requires another ADR.
- This narrowly corrects ADR-0188's builtin-esbuild redirect trigger and
  post-link alias-overlay clauses; its rollup/lightningcss, user-override,
  version-gate, and visible-provenance decisions stand.

## Rejected alternatives

- Keep upstream `resolved`/`integrity` on the synthesized row: false byte
  provenance.
- Encode synthesis in a custom `resolved:` URL: overloads npm's tarball field
  and routes replay through the network/cache fetch chokepoint.
- Infer synthesis from package name, version, top-level trace, or missing
  integrity: ambiguous with user overrides and corrupt lockfiles.
- Select 0.28.0 directly from the caller range without public metadata: silently
  diverges when real npm would select a newer satisfying public version.
- Fetch either public esbuild or the old alias tarball and overwrite it: keeps
  measured network bytes nobody executes.
- Classify synthesized bytes as `cache`, `registry`, or `eddy`: provenance lie.
