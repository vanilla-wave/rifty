# ADR 0371: Registry twins carry substituted runtime bytes in the installed tree

Status: Accepted
Date: 2026-08

> TL;DR: substituted runtime bytes use the same exact registry-twin install
> path as every other substituted package; a small attested package-path
> descriptor activates the owner-bundled adapter from the installed tree.

## Context

The Pattern-2 runtime-asset chain has one member:
`esbuild-wasm@0.28.0/package/esbuild.wasm` (13,918,738 bytes,
SHA-256 `9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b`).
It owns a separate CAS, pointer/receipt/object persistence, a read/cancel
MessagePort protocol, kernel `WorkerEntryDescriptor.capabilityPorts`, and
owner/child lifecycle wiring. ADR-0321 already counted its protocol as the
ninth correlation engine. No second Pattern-2 package landed.

ADR-0313's forcing constraint was that 13.9 MB did not fit the 1 MiB sync-RPC
ring or clone metadata. Registry-recipe v2 subsequently shipped Pattern-1:
LightningCSS and Sass acquire exact upstream twins into the ordinary installed
tree, then overlay their synthetic public package. Once esbuild uses that path,
the Worker reads the admitted bytes from its existing `FsSync`; it transfers
neither bytes nor a port. The original forcing constraint is gone, so
`docs/process/fault-classes.md` §Class-kill requires deletion.

Alternatives:

1. **Selected, minimal:** exact `esbuild-wasm@0.28.0` registry acquisition,
   ordinary in-tree bytes, and one clone-safe `{adapterId, packagePath}` binding.
2. Keep the CAS/port/kernel chain for profile-wide dedup. Rejected: the user
   accepted per-project bytes, it preserves an N=1 mechanism, and cold offline
   instant restore remains broken.
3. Move the generated 135 KB ADR-0226 client into the twin. Rejected: the raw
   upstream browser client lacks rifty's guest-VFS patches; this needs a new
   published artifact, install-time patcher, or large inline recipe content.
   Each adds a second delivery mechanism and violates the data-only catalog
   invariant.

## Decision

- The esbuild recipe acquires exact `esbuild-wasm@0.28.0` through the existing
  registry-recipe path with an exact empty dependency projection. The acquired
  package stays at its ordinary effective `node_modules/esbuild-wasm` path;
  the synthetic `esbuild@0.28.0` facade overlays its sibling materialization
  path. Fresh installs use the normal packument/tarball path; lock replay uses
  its normal integrity-keyed tarball cache and exact recipe trace.
- Catalog recipe bindings contain only an executable adapter id. npm-client
  derives a frozen runtime binding from the attested substitution:
  `{adapterId, packagePath}`, where `packagePath` is the registry acquisition's
  effective installed path. No source URL, member bytes, callback, or host
  executable enters catalog data.
- Workbench package admission prefixes the path with the admitted tree root and
  carries runtime bindings in the existing Node-entry/dev-server bootstrap
  metadata while the existing package reservation freezes that tree. It does
  not introduce a new channel, handshake, correlation id, lifecycle owner, or
  public SPI. Unknown and duplicate adapter ids loud-throw before guest import.
- The esbuild adapter reads `${packagePath}/esbuild.wasm` from the entry's
  existing `FsSync`, verifies exact size and SHA-256, compiles it, starts the
  ADR-0226 runtime, and publishes the exact CJS outer before guest import.
  Missing or drifted bytes loud-throw; there is no host, network, or fallback
  source at activation.
- The hash-derived ADR-0226 client remains the single named Workbench-bundle
  exception. Recipe/catalog content remains provenance and stub-sized facade
  data only. A second derived client in that bundle is refused absent a new
  decision.
- Delete the runtime-asset catalog model/projection, npm-client manager/store,
  source and port protocol, Workbench ensure/serve/consume wiring, and kernel
  `capabilityPorts` public surface. Ordinary registry/tarball cache and
  package-tree persistence remain their sole existing authorities.
- Per-project duplication of the 13.9 MB member and loss of cross-project CAS
  dedup are accepted. If measured quota pressure later warrants dedup, it
  belongs below ordinary package-tree semantics, not in a package-specific
  delivery path.
- Supersedes ADR-0313, ADR-0318, ADR-0320, and ADR-0321 completely. Corrects
  ADR-0311's manager/capability/CAS clauses to the exact installed twin and
  local hash verification; its no-host-source and single-runtime-authority
  clauses stand. Corrects ADR-0346's separate-runtime-CAS clause; snapshot-v3
  tree/tarball-cache fidelity stands. Corrects ADR-0361's concrete
  esbuild/runtime-binding and kernel-port clauses; its recipe, admission,
  registry, trace, bin, and replay authorities stand. ADR-0344 and ADR-0226
  D1–D5 stand.

## Consequences

- Cold offline instant restore succeeds from its baked installed tree with no
  npm install and zero esbuild registry requests. A from-scratch cold install
  still makes exactly the ordinary esbuild-wasm packument and tarball requests.
- Every substituted dependency uses one byte-delivery path. Adding another
  wasm-bearing native substitution adds recipe/binding data and its finite
  adapter, not a cache, protocol, kernel API, or owner lifecycle.
- Project copies and archives grow by the upstream member/tarball size; shared
  acquisition caches still amortize network bytes, but storage is intentionally
  project-local like real Node `node_modules`.
