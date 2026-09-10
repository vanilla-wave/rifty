# Issues #325 + #326 — refine evidence, 2026-09-10

## Original sources

User request: `$rifty-refine issues #325 + #326`.

- [#325](https://github.com/vanilla-wave/rifty/issues/325): `issue325-source.json` records the original body/comments, obtained with `gh issue view 325 --json number,title,body,url,comments`.
- [#326](https://github.com/vanilla-wave/rifty/issues/326): `issue326-source.json`, same command for 326. Both had no comments.
- Both issues describe a static audit of published 0.7.0. No published-tarball runtime reproduction is asserted here.
- Source audit and research tests below: `2c7f9bbf4c88c34c40ac4d83411ba2dda27eafae`; Node v24.16.0, pnpm 11.5.2, Vitest 2.1.9.

## Dedup

Scanned backlog titles/code refs, epic maps/child links, traps and ADR Declined
concepts for no-COI, RuntimeFs, structured results, command cancellation,
runBin, root/readonly policy and preview.

- `distribution/public-api-ai-agent-exec-preview` already owns streamed agent execution; update that record, retain its separate legacy preview question. No duplicate exec item.
- No existing item owns expanded no-COI public FS methods. `distribution/no-coi-project-files` captures #325.
- `distribution/workbench-controllers`, ADR-0275/0280/0319/0341 own COI project/files/terminal behavior. Evidence/reuse candidates, not a replacement runtime topology.
- `shell/background-job-model` is legacy shell job-control work, not no-COI SDK invocation settlement. Current `Shell` supports trailing background jobs; do not infer behavior from the old draft alone.
- `public-api-ai-agent-contract-snapshot-restore` remains a separate general snapshot/fork promise; #326 needs honest cancellation effects, not that API.
- Declined broad exec *inside the previous build tier* was a scope deferral: its recorded reason calls shell/streaming/cancellation independent scope. #326 explicitly requests that independent work. No revival of COI Workbench, eval globals, new Worker per call, hidden queues/retries or crash-atomic recovery.

## Current source facts

| Source | Fact / consequence |
|---|---|
| `packages/runtime-js/src/host.ts`, `worker-fs-rpc.ts` | Raw FS has read/write only. Paths anchor at `/`; write creates parents, invalidates loader and awaits supplied flush; errors serialize name/message/code/path. |
| `packages/runtime-js/src/worker-entry.ts` `handleEval`; `protocol.ts` `EvalResult` | Value is printed to stdout; successful result has `value: undefined` despite unknown-typed value. No programmatic result or cancel option. |
| `packages/rifty/src/sandbox.ts` | `runBin` accepts cwd/binPath/args, returns exitCode; events global. Restart replaces the whole Worker and reports pending public writes; resident preview is another lifecycle. |
| `packages/workbench/src/workers/no-coi-toolchain-worker.ts` | One finite-operation busy slot; run waits for drain/flush; install/open/runBin while a resident exists throws `sandbox.toolchain.resident-concurrency`. |
| `packages/shell/src/shell.ts` | Existing per-run chunks/signal; default abort may return before handler settles, `awaitAbortSettlement` can retain ownership. Shell object retains cwd/env. It is not a public no-COI Worker composition. |
| `packages/workbench/src/workers/project-terminal-namespace.ts` | Existing rooted FsSync and mutation-policy translation; its COI child setup is not usable unchanged without SAB. |
| `packages/workbench/src/workbench/project-files.ts` | Rich versioned ProjectFiles exists; its owner receipts/snapshots/session authority are not the raw RuntimeFs API. |

## Research runs

```
pnpm exec vitest run packages/shell/tests/shell-signal.test.ts packages/shell/tests/mutation-guard.test.ts packages/workbench/src/workers/project-terminal-namespace.test.ts
Test Files 3 passed (3)
Tests 79 passed (79): cancellation 19, mutation guard 23, namespace 37
Duration 695ms; Vitest 2.1.9; Node v24.16.0
```

These prove existing building blocks only; not packed SDK acceptance or
complete no-COI cancellation/persistence. Initial install was interrupted after
sandbox DNS denial; `pnpm install --frozen-lockfile` then succeeded with network
access. No lockfile change.

Disposable native browser probe, executable from the repository with Node:

```sh
node <<'NODE'
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async () => {
      const source = `onmessage = ({data}) => {
        if (data === 'busy') { postMessage('entered'); while (true) {} }
        postMessage(data);
      }`;
      const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
      const worker = new Worker(url), messages = [];
      const entered = new Promise(resolve => worker.onmessage = event => {
        messages.push(event.data); if (event.data === 'entered') resolve();
      });
      worker.postMessage('busy'); await entered; worker.postMessage('stop');
      await new Promise(resolve => setTimeout(resolve, 100));
      const beforeTerminate = [...messages]; worker.terminate();
      const next = new Worker(url);
      const response = new Promise(resolve => next.onmessage = event => resolve(event.data));
      next.postMessage('next'); const nextResult = await response;
      next.terminate(); URL.revokeObjectURL(url);
      const examples = {object:{a:[1,'x']}, bytes:new Uint8Array([0,255]),
        bigint:2n, map:new Map([['a',1]]), fn:()=>1};
      const cloning = Object.fromEntries(Object.entries(examples).map(([name,value]) => {
        try { return [name, Object.prototype.toString.call(structuredClone(value))]; }
        catch (error) { return [name,error.name]; }
      }));
      return {crossOriginIsolated,beforeTerminate,nextResult,cloning};
    });
    console.log(JSON.stringify({node:process.version,chromium:browser.version(),result},null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
NODE
```

Observed Node v24.16.0 / Chromium 148.0.7778.96:
`crossOriginIsolated:false`, `beforeTerminate:["entered"]`, `nextResult:"next"`;
clone object→Object, bytes→Uint8Array, bigint→BigInt, map→Map,
function→`DataCloneError`. Executed via the same script saved as a temporary
`.cjs`; Chromium needed sandbox escalation for macOS MachPort launch.

The finite wait observes no Stop acknowledgement; it does not prove a mutation
did not apply. The [HTML Worker specification](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)
permits terminating current script execution. The
[structured serialization specification](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
rejects non-serializable values. Neither proves project preservation or an SDK
result-size limit. No clone API is selected for delivery.

## Material assumptions — source → consequence → authority

| Action/source | Consequence | Authority / owner |
|---|---|---|
| #325 ordinary filesystem tools | Typed list/stat/mkdir/rename/remove, alongside read/write; no control files | Original requested outcome/acceptance |
| #325 either structured evaluation or explicit console-oriented contract | Clarify eval; FS and command results satisfy supplied scenarios; general JS-value API not required | Explicit alternative in #325; early Challenge |
| Existing RuntimeFs relative path, then guest cwd changes | Raw path still VFS-rooted; project mapping additive | ADR-0131 + current documented baseline |
| File tool and ordinary Node CLI write configured readonly path | Same policy effect; readonly is not limited to Shell builtins | #326 consistent file/shell policy; disclaimer excludes hostile-JS security, not ordinary guest FS |
| Stop during write/build, then next call | Terminal or old Worker death before reuse; effects/flush uncertainty explicit; no rollback/retry | #326 acceptance + ADR-0376/0377 |
| New command while resident Vite exists | Existing explicit resident-concurrency failure retained; coexistence not promised by these issues | Existing baseline + ADR-0377; preview is legacy separate scope |
| Host prohibits background work | Prohibition must work before background launch; if allowed, ownership cannot end while late job effects/output escape | #326 execution policy and per-invocation settlement |
| Stop hard-kills single Worker | Realm replacement and uncertain writes must be visible; preview reload/memory recovery retain existing limits | #326 expressly allows necessary replacement; ADR-0377 |
| `cd src`; next independent command | Persistent cwd/env or explicit per-call state changes target execution | User round 1 pending; no default inferred |
| Policy updates mid-call, exact API shape, serialization, owner admission mechanics | Agent designs scoped options and admission using existing authorities; no second scheduler prescribed | PICKUP, DEC-1, fault-classes Class-kill |

## Early Challenge

Fresh read-only reviewer `/root/sdk_scope_critic`, no author conversation;
received original issue snapshots, authorities, proposed direction and forks.
Verbatim verdict:

> challenge: 2026-09-10 — 1 problems
>
> 1. **Срок жизни shell-state не выбран.** Действие: `cd src`, затем отдельный `pwd` / `npm run build`. Результат: cwd/env сохраняются между вызовами либо задаются заново для каждого. Это меняет файлы и команды следующего действия агента. `Shell` сохраняет cwd (`shell.ts:285–305`); Workbench сохраняет cwd/env до settlement (ADR-0278); `runBin` получает обязательный cwd. #326 просит новую SDK composition, но не выбирает её семантику. Нужен пользовательский выбор; способ реализации — агентский.

Other critic findings verified in the assumption table: value/direct route,
optional generic eval, existing resident rejection, ordinary guest readonly
reach and background ownership. Early Challenge is not the final draft check.

## User answers

Round 1 asks whether separate calls preserve shell cwd/env or receive explicit
per-call cwd/env, with the latter recommended for independent agent actions.
Answer pending. Dependent command semantics remain draft.

## Preparation checks

`pnpm backlog:check` and `git diff --check`: PASS.
`pnpm build:libs`: PASS (outputs required by the legacy-retirement gate).
`pnpm pr:check`: docs-only 20/20 PASS; skipped source lanes: typecheck,
build:libs, check:arch, test:run, test:parity. The separate building-block tests
and native browser probe above are research, not product acceptance.

Initial gate failures: source JSON formatting (fixed), sandbox `tsx` IPC EPERM
(rerun with escalation), missing build outputs (built). No criterion weakened.

## Final written-result check

Fresh read-only `/root/sdk_refine_final`, no inherited author/critic context:
docs Final+GREEN PASS at `f2bb7365e3f305c857dd7180b85c2de65d3b784b`.
Record: `issues325-326-refine-final-green.json`; `blockers.mjs` exit 0.
The reviewer checked original issues, the full final draft set and evidence.
This certifies accurate preparation, not settled cwd/env scope, ready contracts
or shipped SDK behavior. The user question remains pending.
