# ADR 0138: node:vm direct eval not intercepted (permanent compat divergence)

Status: Accepted (M11)
Date: 2026-06

> TL;DR: `node:vm` runs context code in the HOST realm via `with(proxy) + eval(rewritten)`; a direct `eval(...)` inside that code runs UNREWRITTEN, so writes to undeclared names inside it leak to the host realm. Faithful interception is impossible in this design — accepted as a permanent divergence, kept loud in the compat note rather than half-intercepted.

## Context

`node:vm` is a compatibility property bag, not a security sandbox (`docs/public/compat/modules.md`). Context code is executed in the host realm: `new Function('ctx','src','helper','with (ctx) { return eval(src) }')`, where `src` is the user code after an acorn AST rewrite that redirects writes to undeclared names onto the context object (`helper.x = …`).

The write-leak class was closed for ordinary syntax (assignments incl. compound/update/logical/destructuring, `var`/function declarations, for-in/of targets, `delete`), and the M11 close of the `runtime-js/vm-sandbox-residual-gaps` backlog item (deleted on close — git history) further fixed top-level function hoisting, declaration-statement completion values, statement-position `var` destructuring patterns, and post-run persistence of context `var` bindings.

One gap is structurally unfixable in this design: a **direct `eval(...)`** call inside vm code. The rewrite operates on the OUTER source acorn can see; the string passed to a nested `eval` is opaque at rewrite time and is evaluated by the engine's own (host-realm) direct-eval semantics. So `vm.runInNewContext('eval("leaked = 1")', sandbox)` writes `leaked` to the HOST global, where real Node — running the code in a genuinely separate realm — writes it to the sandbox.

Options considered:

1. **Re-parse + rewrite the eval argument when it is a string literal.** Only helps the literal-argument case; `eval(buildSource())` (dynamic argument) is still opaque, and direct-eval scope semantics (the nested eval seeing the caller's lexical bindings) cannot be reproduced by re-feeding a string to a fresh rewrite. Half-interception that silently works for some inputs and leaks for others is worse than an honest, predictable divergence.
2. **Realm-level execution** (a real separate global) — would fix eval and remove the whole rewrite, but needs an isolated realm primitive (ShadowRealm / iframe / Worker global) the browser runtime does not give synchronously, and is a different architecture, not a patch.
3. **Accept and document.** Keep `eval` a helper binding so the `with` proxy never shadows the host `eval` the rewritten code itself calls, and document the leak loudly.

## Decision

**Direct `eval(...)` inside `node:vm` context code is NOT intercepted — a permanent, documented divergence for the host-realm `with(proxy) + eval` design.** Writes to undeclared names inside a direct `eval` leak to the host realm instead of the context. We do not attempt partial (string-literal-only) interception. `eval` stays in `HELPER_BINDINGS` so the proxy's `has` trap reports it absent and the rewritten code resolves the real host `eval`.

Read-side fall-through to host globals (a name absent from the context resolves to the host) is likewise BY DESIGN — these are compat property bags, not isolation boundaries.

## Consequences

- Honest, predictable behaviour: the divergence is one named construct (`eval`), documented in the compat matrix, not a silent partial fix that leaks on dynamic arguments.
- `vm` consumers that run trusted config/template code (the actual use case) are unaffected — they do not `eval` into undeclared host names.
- Closes the `runtime-js/vm-sandbox-residual-gaps` backlog item: the four fixable gaps are fixed (this PR); `eval` is recorded here as permanent, as the backlog required ("eval interception, if ever attempted, gets its own decision record").
- This ADR is about the `eval` write-leak only. A SEPARATE divergence class — the context is a plain-object property bag without a real vm global object's property attributes / lexical intrinsics / strict semantics (`var undefined`/`NaN` no-ops, non-configurable `delete`, lexical `undefined`, writable `globalThis`, `var eval` shadowing, `"use strict"` undeclared-write `ReferenceError`s) — is NOT closed by this PR; it is captured in `docs/backlog/runtime-js/vm-context-global-object-fidelity.md`. The "write-leak is closed" claim above is about writes reaching the context vs. the HOST realm, not about property attributes.
- Follow-up (only if a real consumer needs it): true realm isolation via ShadowRealm/iframe/Worker would supersede the rewrite entirely and gets its own ADR.

## References

- `docs/public/compat/modules.md` — the loud compat note for `node:vm`.
- `packages/runtime-js/src/builtins/vm.ts` — `HELPER_BINDINGS` (keeps host `eval` reachable), the AST rewrite.
- `tools/node-parity-runner/cases/vm/sandbox-residual-gaps.case.ts`, `tests/conformance/builtins/vm.test.ts` — the fixed-gap coverage.
