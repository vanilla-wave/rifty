# ADR 0301: Exact ESM module lexical bindings are path-and-byte attested

Status: Accepted
Date: 2026-07

> TL;DR: one Node-entry loader may give host values to one ESM artifact as
> lexical factory parameters only after exact path, raw-byte, and module-kind
> attestation; no value or bearer enters source text, globals, or launch metadata

## Context

Vite's installed bundled-config loader needs a client for an owner-private
generated-module cache (ADR-0302). A source bearer or `globalThis` hook would
make that authority guest-observable and copyable. Path-only selection would
give replaced bytes authority; byte-only selection would give a copied module
authority. Preparing the binding after guest entry would also let earlier code
replace parser, decoder, collection, or `Function` primordials.

runtime-js has no host-import seam. Adding one changes a public cross-package
loader interface and therefore requires an explicit provenance contract. This
is the implementation inflection that replaces the provisional "no public
API" assumption in `playground/vite-temp-install-claim-churn`: a package-private
Workbench→runtime-js friend seam would violate import boundaries or become a
hidden global/bootstrap protocol. Cache ownership and its bearer remain private;
only the generic exact-artifact binding contract is public.

## Decision

- `ModuleLoaderOptions.exactEsmModuleBinding` and
  `RunNodeEntryOptions.exactEsmModuleBinding` accept at most one descriptor:
  absolute normalized path, attested raw source bytes, and identifier-to-value
  imports. Names must be own data properties and safe non-reserved JS
  identifiers; malformed or colliding descriptors fail during loader creation.
- Loader creation snapshots bytes and values, decodes and transforms the exact
  source, and constructs its factory through captured primordials before guest
  execution. Values become direct factory arguments; they never enter source,
  a runtime global, or a worker bootstrap field.
- Selection requires the same normalized resolved path, every raw byte, ESM
  classification, and package root. Classification is re-read through captured
  primordials, without guest-poisonable resolver caches, before evaluation.
  Drift fails before static imports or module body execution.
- Ordinary modules retain the existing loader path and wrapper line offsets.
  This is one exact descriptor, not an import map or plugin API.

Rejected: source bearer plus global hook; path-only or byte-only selection;
late validation followed by ordinary transform; a Vite-specific runtime-js
callback.

## Consequences

- One audited installed module can receive a host-only service without creating
  a guest capability namespace.
- Each bound loader pays one eager decode, AST transform, and factory creation.
- Supporting multiple exact artifacts needs a successor decision with collision
  and lifecycle evidence.

Cites ADR-0261 (whole-tree trust), ADR-0300 (one-shot entry capabilities), and
ADR-0302 (Vite config-cache owner).
