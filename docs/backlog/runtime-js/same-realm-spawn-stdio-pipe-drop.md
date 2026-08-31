---
area: runtime-js
status: ready
title: Same-realm child console bypasses stdio 'pipe' — exit 0, empty child output, owner leak
created: 2026-08-26
why: worst failure shape — success with missing data; an agent/toolchain reading a child's stdout (linter, typechecker, codegen, test runner) silently concludes "no output" and proceeds; direct Fidelity violation (no silent stubs)
user_story: As a dev (or agent) running `spawn('node',['./lint.js'])` without COI and reading `child.stdout` to decide the next step, I want the child's output on the pipe like Node, but today the same-realm fallback closes with code 0 and an empty stdout — the output went to the parent realm's console instead.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, ADR-0011, ADR-0326, Node-v24.16.0-probe]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/builtins/console.ts]
---

## Context

The no-COI probe's `spawn('node',['./file.js'])` printed `2`: same-realm
closed 0 with stdout `""` and leaked `2` to the owner console; the Worker route
returned stdout `"2"`. Current-tree evidence below reproduces the defect
against Node v24.16.0.

Root cause: `execScript` gives evaluated code lexical `process`, timers and
globals, but no lexical `console`; unqualified `console.*` therefore resolves
the owner realm's global. `require('console'|'node:console')` returns the cached
root console module, not a child-bound instance. Direct child
`process.stdout.write`/`stderr.write` already enter `ProcessIO`, and
`spawnViaSameRealm` already forwards those streams through the resolved stdio
plan. The missing authority is one child-bound console, not another pipe.

## User scenario

On a non-COI host, an agent writes `lint.js`, calls
`spawn('node', ['./lint.js'], { stdio: 'pipe' })`, and waits for `close` while
collecting `child.stdout` and `child.stderr`. The child reports findings through
`console.log`/`console.error`, including from a timer. The agent receives the
exact Node bytes on the matching child pipes before close; neither output leaks
to the owner console nor to another overlapping child.

## Evidence

All current-rifty artifacts ran at
`b24ffc82f861e5acfd994bddb1a8f16edfe736ab`.

Evidence N24 — native routing and console identity:

```sh
node --version && node -e 'const{spawn}=require("node:child_process");const src=`console.log("L",{a:1});console.info("I");console.debug("D");console.warn("W");console.error("E");process.stdout.write("O");process.stderr.write("R")`;const c=spawn(process.execPath,["-e",src],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";c.stdout.on("data",x=>stdout+=x);c.stderr.on("data",x=>stderr+=x);c.on("close",code=>process.stdout.write(JSON.stringify({code,stdout,stderr})+"\\n"))' && node -e 'process.stdout.write(JSON.stringify({plain:console===require("console"),node:console===require("node:console"),aliases:require("console")===require("node:console")})+"\\n")'
# v24.16.0
# {"code":0,"stdout":"L { a: 1 }\nI\nD\nO","stderr":"W\nE\nR"}
# {"plain":true,"node":true,"aliases":true}
```

Evidence R24 — same-source seeded-process parity probe; `stdin: []` selects the
existing parity runner's real `NodeProcess` setup while rifty takes the
same-realm route:

```sh
node --version && pnpm --version && pnpm exec tsx -e 'import { runInNode } from "./tools/node-parity-runner/src/run-in-node.ts"; import { runInRifty } from "./tools/node-parity-runner/src/run-in-rifty.ts"; void(async()=>{const c={cwd:"/project",stdin:[],setup:{files:{"project/child.js":`console.log("L",{a:1});console.warn("W");process.stdout.write("ID="+String(console===require("node:console"))+"\\n")`}},code:`const{spawn}=require("node:child_process");const c=spawn("node",["child.js"],{stdio:"pipe"});let stdout="",stderr="";c.stdout.on("data",x=>stdout+=x);c.stderr.on("data",x=>stderr+=x);c.on("close",code=>console.log(JSON.stringify({code,stdout,stderr})));`}; const node=await runInNode(c); const rifty=await runInRifty(c); process.stdout.write(JSON.stringify({node,rifty})+"\\n");process.exit(0)})()'
# v24.16.0; pnpm 11.5.2; tsx 4.22.3
# {"node":"{\"code\":0,\"stdout\":\"L { a: 1 }\\nID=true\\n\",\"stderr\":\"W\\n\"}\n","rifty":"L { a: 1 }\n{\"code\":0,\"stdout\":\"ID=false\\n\",\"stderr\":\"\"}\n"}
```

Evidence R24-C — two overlapping timer children:

```sh
node --version && pnpm --version && pnpm exec tsx -e 'import { runInNode } from "./tools/node-parity-runner/src/run-in-node.ts"; import { runInRifty } from "./tools/node-parity-runner/src/run-in-rifty.ts"; void(async()=>{const c={cwd:"/project",stdin:[],setup:{files:{"project/a.js":`setTimeout(()=>{console.log("A");console.error("AE")},10)`,"project/b.js":`setTimeout(()=>{console.log("B");console.error("BE")},0)`}},code:`const{spawn}=require("node:child_process");function run(file){return new Promise(resolve=>{const c=spawn("node",[file],{stdio:"pipe"});let out="",err="";c.stdout.on("data",x=>out+=x);c.stderr.on("data",x=>err+=x);c.on("close",code=>resolve({code,out,err}))})}Promise.all([run("a.js"),run("b.js")]).then(([a,b])=>console.log(JSON.stringify({a,b})));`}; const node=await runInNode(c); const rifty=await runInRifty(c); process.stdout.write(JSON.stringify({node,rifty})+"\\n");process.exit(0)})()'
# v24.16.0; pnpm 11.5.2; tsx 4.22.3
# {"node":"{\"a\":{\"code\":0,\"out\":\"A\\n\",\"err\":\"AE\\n\"},\"b\":{\"code\":0,\"out\":\"B\\n\",\"err\":\"BE\\n\"}}\n","rifty":"B\nA\n{\"a\":{\"code\":0,\"out\":\"\",\"err\":\"\"},\"b\":{\"code\":0,\"out\":\"\",\"err\":\"\"}}\n"}
```

Evidence G24 — preservation pins on Node v24.16.0 / Vitest 2.1.9:

```sh
pnpm vitest run tests/conformance/builtins/child_process.test.ts packages/runtime-js/src/builtins/child_process-ceiling.test.ts packages/runtime-js/src/builtins/child_process-worker-identity.test.ts --reporter=dot
# Test Files 3 passed (3); Tests 22 passed (22)
pnpm test:parity console
# 2 case(s): console-class + dirxml; all cases match
```

## Reference contract

- Oracle: Node v24.16.0 native `child_process.spawn` and global/default
  `node:console` (Evidence N24). `log`/`info`/`debug` write stdout;
  `warn`/`error` write stderr; formatting/newlines are exact; both console
  module aliases are the global console object.
- ADR-0011 keeps `new Function` same-realm execution as the non-SAB fallback;
  its consequence says that fallback must remain correct for non-isolated
  environments. This goal deliberately promotes that route to the no-COI tier.
- ADR-0326 requires Worker and same-realm claimed surfaces to consume the same
  validated stdio plan. This slice corrects console's producer binding only;
  `resolveWorkerStdio` remains the plan authority.
- Existing `Console` behavior is the `node:console` differential suite in
  Evidence G24. No second formatter is permitted.

## Acceptance

- Add RED-first same-source parity under `child_process`: with rifty forced onto
  same-realm and `stdio:'pipe'`, child `console.log`/`info`/`debug` bytes equal
  Node stdout, `warn`/`error` bytes equal Node stderr, exit is 0, and all bytes
  arrive before `close`.
- In that child, `console === require('console') === require('node:console')`;
  the object is the existing Node-compatible `Console` bound to that child's
  stdout/stderr. Direct `process.stdout.write`/`stderr.write` retain FIFO with
  same-stream console calls.
- Owner console observes none of the child's frames. Two overlapping
  same-realm children whose timer callbacks log concurrently each receive only
  their own stdout/stderr; no cross-routing or shared-console mutation.
- Existing stdio-plan, stdin, process identity, lifecycle, Worker-route and
  `node:console` parity tests remain green unmodified (Evidence G24).

## Parity cases

1. Piped sync console + aliases: child logs formatted stdout/stderr, verifies
   both module aliases equal global console, then returns naturally; Node bytes,
   identity and exit are exact. Artifact: Evidence N24 oracle and Evidence R24
   current RED, Node v24.16.0 / pnpm 11.5.2 / tsx 4.22.3.
2. Console method families: `log`/`info`/`debug` join stdout while
   `warn`/`error` join stderr, with direct writes preserving FIFO and formatting.
   Artifact: Evidence N24 exact native output; Evidence G24 existing console
   formatter parity on Node v24.16.0.
3. Overlapping async children: A/B timer callbacks log to their own two pipes;
   parent output contains only the final aggregate. Artifact: Evidence R24-C
   same-source Node green/current-rifty RED, version-pinned above.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `sibling-drift` × global console / `console` aliases / direct process writes | one child console authority; aliases share identity; stdout/stderr bytes match Node | Evidence N24 + R24 + G24; Parity 1–2 |
| `concurrent-same-key` × two overlapping same-realm child callbacks | no shared global mutation; each lexical child console writes only its own pipes | Evidence R24-C, current RED against Node v24.16.0; Parity 3 |
| `observable-order` × final console write then natural close | all admitted bytes are observable on the pipe before `close(0,null)` | Evidence R24 current missing-byte RED; Evidence G24 existing lifecycle pins; Parity 1 |

## Out of scope

- `same-realm-child-async-throw-ownership`: timer/IPC/signal callback throws
  escaping to the owner remain that sibling's recorded fork and contract.
- Worker-backed spawn transport/output sequencing: unchanged and already green;
  this slice selects no new Worker or MessagePort mechanism.
- New stdio descriptor forms or changes to `ignore`/`inherit`/custom targets:
  `resolveWorkerStdio` remains binding; only the dropped `pipe` producer is new.
- `execSync`/`spawnSync`, spawn warn-once, capability report and CPU reporting:
  mapped siblings own them; existing loud gaps stay loud.
- New console formatting/API surface. Existing `Console` implementation and
  its declared gaps remain the authority.

## Decisions

review: checkpoints — Node parity plus overlapping same-realm child routing.

- Node v24.16.0 settles the observable fork: child global console and both
  console-module aliases are one child-bound object; owner-console leakage is
  never an accepted degradation.
- Carrier: instantiate the existing `Console` per `execScript` over
  `writeStdout`/`writeStderr`, inject it lexically into evaluated child code,
  and return that same object for `console`/`node:console`. Do not mutate the
  shared realm's global console; overlapping children then need no lock/epoch.
- Reuse `builtins/console.ts`; no duplicate formatter, public API, dependency,
  coordination mechanism or ADR.
- Test carrier: the existing parity runner's seeded-process mode (`stdin: []`)
  reaches the production same-realm path and needs no new harness mode.
- REVERSIBLE: correction behind the existing `child_process.spawn` surface.
