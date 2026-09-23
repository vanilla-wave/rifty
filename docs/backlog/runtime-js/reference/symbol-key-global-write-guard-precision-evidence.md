# Symbol-key global writes — 2026-09-23

## Node artifact

Command, executed on Node v24.16.0:

```sh
node --import tsx --input-type=module <<'NODE'
import cjs from './tools/node-parity-runner/cases/modules/symbol-global-writes-cjs.case.ts';
import esm from './tools/node-parity-runner/cases/modules/symbol-global-writes-esm.case.ts';
import {runInNode} from './tools/node-parity-runner/src/run-in-node.ts';
console.log(process.version);
for (const [kind, testCase] of [['cjs', cjs], ['esm', esm]]) console.log(kind, JSON.stringify(await runInNode(testCase)));
process.exit(0);
NODE
```

```text
v24.16.0
cjs "assign 1\nupdate 4\ndefine 5\ndescriptors 6\nreflect 8\nobject 9\ngetter 10\ninline 11\norder key,value 12\nmutable 13\nshadow 14\ndelete true true\n"
esm "assign 1\nupdate 4\ndefine 5\ndescriptors 6\nreflect 8\nobject 9\ngetter 10\ninline 11\norder key,value 12\nmutable 13\nshadow 14\ndelete true true\n"
```

## RED / retained safety baseline

`node --import tsx tools/node-parity-runner/src/cli.ts symbol-global-writes`:
2 failures, named `module-loader.{cjs,esm}-global-function-assignment`.

`pnpm test:run packages/runtime-js/src/module-loader/symbol-global-writes.test.ts`:
Initial baseline: 28 tests; 8 expected RED (const, inline, closure, global alias × CJS/ESM),
20 safety controls GREEN (strings, mutable keys, parameter/block shadows,
default-initializer bypass, coercible object, mixed descriptor maps,
previously monkeypatched `Symbol.for`).

The monkeypatch control mutates the real host method before loading guest
source, then restores descriptors in `finally`. A string-returning factory
has no lexical shadow or guest-source mutation for a spelling-only checker
to detect. No sibling package or tested implementation is mocked.

## Root / class

`sibling-drift` at owned in-process policy/graph projection:
`esm.ts:1258` and `cjs.ts:1446` treat every non-static computed write as a
Function write. Mutation dispatchers `esm.ts:1441`, `cjs.ts:1633` repeat the
same rule through duplicated `propertyMayBeFunction` and
`objectMayContainFunctionKey` helpers. The latter governs `Object.assign`
and `Object.defineProperties`; other siblings are Object/Reflect
define/set/delete and legacy accessor helpers. Transport loss, duplicate
delivery and reorder are physically excluded on this boundary.

## Carrier finding / selected policy

- No Symbol intrinsic rewrite: CJS factory injects routed Function,
  WebAssembly and dynamic import; ESM factory likewise. Substituting native
  Symbol would silently ignore a user's actual mutable binding.
- A name-global symbol set would leak past parameter, import, block, catch,
  loop and class-static shadowing. Const destructuring/defaults are not proof
  of the runtime value. The selected runtime validator needs no binding sets.
- A shared runtime key validator can check `typeof key === 'symbol'`
  before a dynamic-key mutation, evaluating the original key once. Static
  Function keys and opaque maps/spreads retain parse-time ceilings. This adds a helper
  injection seam in `esm-job-types.ts`, `esm-job-preparation.ts`,
  `esm-job-evaluation.ts` and `cjs.ts`; no `source-maps.ts` change is needed.
- Unlike today's parse-time rejection, an admitted but monkeypatched
  factory would run preceding source effects before the runtime ceiling.
  ADR-0444 supplements ADR-0171 with this policy; independent Contract+RED
  precedes implementation. No source fix shipped.

## Final Contract+RED preparation

The Node artifact above was rerun after adding dynamic-key evaluation order
and actual symbols from mutable/shadowed bindings. Both native runs exit 0.
Rifty parity remains 2/2 RED with the original mutation ceilings.

Dedicated unit suite now: 36 tests, 16 RED + 20 GREEN. Added REDs: actual
mutable/shadowed symbols (4), runtime rejection timing/no coercion (4). Timing control
expects `['before', 'key']`, actual parse-time ceiling leaves `[]`; neither
object coercion, assignment RHS nor the host Function mutation may occur.

ADR allocation used `pnpm adr:new runtime-js "Validate symbol keys before
guarded global mutations"`: sandbox lock write initially EPERM; normal
shared-state allocation succeeded with authorized escalation, ADR-0444.

`pnpm exec biome check --write` on the three new test/case files: pass.
