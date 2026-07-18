# ADR 0294: Node-compatible require.extensions suffix dispatch

Status: Accepted
Date: 2026-07

> TL;DR: explicit CJS files use Node's cache-first, longest registered suffix
> dispatch, then the current `.js` fallback.

## Context

ADR-0269 established one loader-owned `require.extensions` table and real
`module._compile`, but execution consulted only `.js`. Registered `.ts`,
compound, JSON, and text suffixes were ignored; unknown suffixes always used
the original source path. The TypeScript loud-gap guard also ran before the
module cache, so extending dispatch there would make a cached module depend on
later hook mutations.

Node first returns a cached module, then publishes a fresh loading module before
reading the extension table. It scans only the basename, from the earliest
non-leading dot, selecting the longest truthy registered suffix; otherwise it
invokes the current `.js` hook. Fault classes: `sibling-drift` (one public
table, separate hard-coded dispatcher), `observable-order` (table reads before
loading-cache publication), and `frozen-assumption` (calling through a hook's
user-owned `.call` property).

## Decision

- `createModuleLoader` owns one mutable null-prototype extension table. Every
  local `require` and `createRequire` view shares it.
- A loaded or loading record returns before extension discovery. A fresh
  loading record and module object exist before any extension-table read. Any
  discovery or hook failure removes that record before retry.
- For an explicit CJS-classified filename, scan basename suffixes longest
  first, skipping a leading dot. The first truthy registered entry wins;
  otherwise use the table's current `.js` entry.
- The table starts with callable `.js`, `.json`, and `.node` entries in Node
  order. The default `.node` entry loudly throws
  `NotImplementedError('module-loader.native-addon')`; replacing it works like
  any other hook.
- Resolver-owned text modules keep raw-text behavior only while the loader-owned
  default `.js` is the unregistered-suffix fallback. Replacing `.js` owns text.
- A registered hook runs before built-in JSON or text handling, with the shared
  table as `this`. Invocation never reads the hook's own `.call`; non-functions
  fail loudly.
- The loader-owned default `.js` hook compiles resolver source. Its existing
  synchronous TypeScript/JSX ceiling remains loud only when no suffix hook is
  registered and that default is still selected. Replacing `.js` gives the
  replacement ownership of otherwise unregistered suffixes.
- `_compile(source, filename)` executes replacement source on the same module
  object. Relative resolution and source identity use `filename`.
- A hook's exact thrown value escapes and the failed record is removed, so a
  retry performs a fresh dispatch.

This does not change resolver classification. Dynamically registered suffixes
do not become extensionless resolution candidates; `.mjs` and files classified
as ESM do not route through CJS hooks.

Rejected: detached tables per `require`; copying hook state between wrappers;
dispatch before the cache; suffix or path special cases outside Node's table.

## Consequences

- (+) Package loaders can use standard suffix hooks without platform knowledge
  of the source language or tool.
- (+) Cache identity, hook receiver, fallback mutation, and failure cleanup
  match the real Node oracle.
- (=) `require.extensions` remains a partial compatibility surface because
  resolver/ESM classification is unchanged; the compatibility matrix stays
  warning-level rather than claiming full support.
