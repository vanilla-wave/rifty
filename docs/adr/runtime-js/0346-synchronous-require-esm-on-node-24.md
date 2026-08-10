# ADR 0346: Synchronous require(ESM) on Node 24

Status: Accepted
Date: 2026-08

> TL;DR: one loader-owned ESM job links a graph before synchronously evaluating
> `require(ESM)`; Node 24 defines its result, errors, cache, cycles, and resolver
> conditions.

## Context

ADR-0164 made Node 24 the compatibility oracle, but ADR-0004 and the loader still
reject every `require(ESM)`. Node 24 enables the operation when the complete ESM
graph is synchronous. A local guard removal is wrong: the current async wrapper
can execute graph prefixes before discovering transitive top-level `await`, and
its promise cannot return a namespace synchronously.

The contract is Node v24.16.0's
[`require(ESM)` algorithm](https://github.com/nodejs/node/blob/v24.16.0/doc/api/modules.md#loading-ecmascript-modules-using-require)
and
[`module-sync` conditions](https://github.com/nodejs/node/blob/v24.16.0/doc/api/packages.md#conditional-exports).

## Decision

1. **One job per ESM record.** Import and require converge on a loader-owned job
   containing link, evaluation, cached-error, namespace, and CJS-facing-result
   state. Repeat callers never evaluate a module twice. Evaluation errors retain
   object identity across `require()` and `import()`; resolution, parse, and link
   failures remain retryable.
2. **Link before sync evaluation.** Synchronous require resolves and transforms
   every reachable static ESM dependency, publishes cycle-visible namespaces,
   reaches a fixed point for statically known direct/star exports (including
   ambiguity), validates named edges, preserves binding TDZ, and detects
   top-level `await` before executing any body. Any reachable TLA throws
   `ERR_REQUIRE_ASYNC_MODULE` with zero graph side effects. Instantiation also
   preserves Node binding initialization: functions are callable and `var` is
   `undefined` before dependency evaluation; lexical/class bindings stay TDZ.
   CJS names and re-export edges come from pinned `cjs-module-lexer@2.2.0`,
   initialized synchronously from its embedded Wasm. The loader resolves that
   static graph before evaluation, primes the same namespace object with those
   names, and excludes runtime-computed keys. A token-preserving second lexer
   pass recovers independently assigned names that the package filters after an
   unsafe `Object.defineProperty` overwrite; standalone unsafe getters stay
   absent, matching Node 24. Builtin names come from the enumerable keys of
   their synchronously materialized rifty runtime object: validation covers the
   delivered subset, not a speculative full Node export table. Thus CJS/builtin
   named imports and ordinary CJS re-exports use the same missing/ambiguity
   validation as ESM edges. A detected CJS re-export whose target is itself ESM
   stays a directed `module-loader.cjs-static-named-exports` ceiling. Vite 7/8's
   observed `node:child_process.execFile` edge is admitted only with its real
   spawn-owned callback/error/timeout/maxBuffer contract and Node custom
   promisified `{ stdout, stderr }` result; link-only placeholders are forbidden.
3. **A real synchronous body.** The AST transform remains shared, but plain JS
   gets a non-async factory when its linked graph has no TLA. Dynamic `import()`
   remains promise-returning. ADR-0052's Promise transform hook is unchanged:
   `.ts`/`.tsx`/`.jsx` ESM cannot enter the synchronous path and fails loudly.
4. **Node result selection.** After evaluation, an own `"module.exports"`
   export is returned directly. Otherwise a module with `default` and no own
   `__esModule` gets a cached namespace facade with enumerable
   `__esModule: true`; all other modules return the shared namespace.
5. **Node graph guards.** ESM↔ESM cycles expose in-progress live namespaces.
   A direct static ESM edge that closes a CJS→ESM cycle, or require re-entry
   into an evaluating ESM job, throws `ERR_REQUIRE_CYCLE_MODULE`; ordinary CJS
   partial-cache back-edges remain valid. A known TLA graph remains
   `ERR_REQUIRE_ASYNC_MODULE` even when its async evaluation reaches such a
   back-edge. Other require calls against an async import job throw
   `ERR_REQUIRE_ESM_RACE_CONDITION`.
6. **Require resolution is Node resolution.** The shared package
   `exports`/`imports` condition-tree activates `module-sync` for import and
   require, while conditional-object declaration order wins. Require's legacy
   fallback searches `.js`/`.json`/`.node`, never `.mjs`, `.cjs`, TS-family
   suffixes, or their directory indexes, and ignores the nonstandard package
   `module` field. Explicit `.mjs`, `"type":"module"` `.js`, and
   syntax-detected `.js` are eligible. ADR-0053's TS-aware extension fallback
   remains on import resolution only; explicit transformed TS/JSX still hits
   the loud synchronous ceiling above. Package-map targets are exact URLs and
   never enter legacy suffix/directory fallback. Package self-reference is
   outside this decision; this changes the already-owned `exports`/`imports`
   chokepoint.
7. **Keep replaceable `.js` dispatch outermost.** A non-default
   `require.extensions['.js']` owns a separate cached CJS projection for the
   same path, even when its ESM job is loaded or in flight. Calling the captured
   default hook delegates back to that ESM job; direct hook exports never
   replace the import namespace. Coherent loader invalidation drops both.
8. **Advertise only the delivered seam.** The runtime process exposes
   `process.features.require_module === true`. This does not claim support for
   Node's CLI opt-out/trace flags or the still-unimplemented `require.cache`
   surface.

The acceptance boundary is real Node 24 parity, not an implementation-shaped
unit test. It covers namespace identity/live binding reads, star/value-TDZ
cycles, `"module.exports"`, CJS/builtin static names and ordinary CJS
re-exports, transitive TLA ordering and sibling concurrency, evaluation-error
identity, both cycle classes, replaceable `.js` dispatch, and require resolver
positives/negative fallbacks.

## Consequences

- `require()` entry points, static imports, and dynamic imports share evaluation
  authority instead of carrying three divergent ESM guards.
- A non-default `.js` hook retains Node's independent CJS cache projection;
  this is the narrow exception to shared ESM evaluation authority.
- Linking retains a prepared graph for the job lifetime; this is the minimum
  state needed for zero-side-effect TLA rejection and exact error identity.
- `cjs-module-lexer@2.2.0` plus the narrow unsafe-getter differential is the
  browser-capable static CJS-surface authority; metadata is cached with loader
  invalidation and pinned to Node v24.16.0.
- Namespace exotic reflection remains outside this decision: descriptor-driven
  operations such as `Object.keys()` over an uninitialized binding still follow
  the tracked CJS→ESM reflection gap.
- Plain-JS modules get both async-import and sync-require wrappers from one AST
  transform. Promise-based TS/JSX transformation remains async-only and loud.
- ADR-0004's `require(ESM)` hard-error clause and ADR-0009's unconditional async
  wrapper assumption are corrected by this ADR; their remaining decisions stay
  active.

## Fault matrix

| Boundary / fault | Required observable result | Proof |
|---|---|---|
| Same id via repeat require + import | one evaluation; stable require result | namespace + error-cache parity |
| Import completes before require | cached namespace/error identity; no second evaluator | import-first parity |
| Require while async import is in flight | `ERR_REQUIRE_ESM_RACE_CONDITION`; import settles once | race parity |
| TLA in a transitive dependency | error before every graph side effect | transitive-TLA parity |
| `for await` import evaluation | suspension signal preserves the iterable/value semantics | TLA parity |
| Failed TLA require, then import | import evaluates once; later require still gets a fresh async error | TLA recovery parity |
| Resolution / parse / link failure | no poisoned job; repaired input retries successfully | Node-oracle-derived retry regression¹ |
| Concurrent roots share dependency; one link fails | bad root rolls back alone; valid root completes shared job | lifecycle parity |
| Async-prepared plain dependency + sibling require | synchronous caller adopts the same sync-capable job; no duplicate/race | Node-oracle-derived job regression |
| ESM cycle / CJS back-edge | star surface/ambiguity + function/var/TDZ initialization / live cycle / exact cycle error | cycle parity |
| Missing ESM/CJS/builtin named edge | link-time `SyntaxError`; zero body side effects | evaluation-error parity |
| Async sibling branches | a sibling starts while another is suspended on TLA | lifecycle parity |
| Synchronous ESM/CJS siblings | no host-microtask checkpoint between dependency bodies | lifecycle parity |
| Known TLA + CJS back-edge | async-module error wins over cycle error | TLA parity |
| Static CJS namespace + later import | primed binding is `undefined` before CJS evaluation, then hydrates with one namespace identity | cycle + lifecycle parity |
| Named/star edge through CJS | static names/re-exports link before bodies; same/distinct origins retain/omit; computed keys stay absent | cycle + evaluation-error parity |
| Independently established CJS name overwritten by unsafe getter | name remains; one snapshot Get; throw becomes `undefined`; standalone getter remains absent | in-flight CJS parity |
| Static CJS metadata invalidation | source/name/re-export graph is recomputed; old namespace generation is not reused | loader invalidation regression |
| Import/require condition siblings | exports + imports share `module-sync`/key order | condition parity |
| Require fallback siblings | `.js`/`.json`/`.node` only; no `.mjs`/`.cjs`/TS or `module` field | resolution parity |
| Package-map target without suffix | exact miss; no legacy `.js` fallback | resolution parity |
| Import loaded/in-flight + replaced `.js` | hook-owned CJS result; ESM import remains independent | lifecycle parity |

¹ The parity runner intentionally gives guest `node:fs` a separate mirror from
the module VFS, so a case cannot repair its own module graph. The in-process
regression mutates the real loader VFS; its outcomes were independently checked
against Node v24.16.0.
