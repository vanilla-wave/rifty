# Independent decision: Vitest watch admission

2026-10-01. Read-only repo. Depth 1 / max 1 / no children.

## Verdict

Select finite, registry-owned installed-CLI capability admission at existing `preparePackageEntryRuntime`; reject unclaimed watch with `NotImplementedError('vitest.watch')`. No upstream source patch, owner command, new protocol, source-shape anchor, or change to user-owned goal. DEC-2 successor required for ADR-0174's preparation/command-semantics boundary. ADR-0384 owns the finite package-policy implementation.

I7 already authorizes and requires this negative behavior. Scope is exact Vitest 4.1.11 / Vite 8.0.16. This is an explicit admitted-capability restriction, not a fabricated absence of a Node API. Claimed commands continue through unmodified installed Vitest and its real parser/config/runner. No amendment is needed to deliver that destination.

## Evidence

- Read AGENTS.md; process README; DEC-1/2/5; whole goal including I7/rejected routes; ADR-0174/0155/0157/0230/0371/0384.
- `/tmp/vitest-real-negative.log`: real `npm install`; exact one Vite 8.0.16; forks/threads fail -> fix; npm test/verbose same outcomes. `vitest --watch` emits `DEV v4.1.11`, runs both tests successfully, then `PASS Waiting for file changes...`. Existing e2e RED: expected loud exit fails after 60s. This is real accepted-negative failure, not missing happy-path proof.
- Raw pinned package: `/tmp/rifty-vitest-native/node_modules/vitest/package.json`: version 4.1.11, declared bin `./vitest.mjs`; Vite manifest 8.0.16.
- Upstream `cli-api.CnMVyzaz.js:14611`: shortcuts only if `stdin.isTTY && ctx.config.watch`; `readline.emitKeypressEvents` lives inside shortcuts. `:14651`: `options.run` disables watch. `defaults.9aQKnqFk.js:48`: default watch also depends on stdin TTY.
- `packages/workbench/src/glue/child-terminal.ts:26` deliberately declares `stdinIsTTY:false`. ADR-0230 says flowing non-TTY stdin; changing it to force a ceiling would falsify established capability semantics.
- Upstream `cac.uFydS1Z4.js:2263-64`: watch/dev aliases. `:2311-17`: watch action sets watch; run action uses `!options.watch`. Flags/command action/prepareVitest interact: parser projection alone is not effective-mode authority.
- Native probes executed this session: Node v24.16.0; Vitest 4.1.11; Vite 8.0.16. Used pinned `vitest/node.parseCLI` plus direct subprocess CLI, no env inspection/overrides.

Native parser results:

| argv after vitest | parseCLI relevant result |
|---|---|
| run | run:true |
| --watch / -w / watch / dev | watch:true |
| run --watch | watch:true, run absent |
| run --watch=false / run --no-watch / run -w=false | watch:false, run:true |
| run --watch false | watch:false, run:true |
| run -- --watch | run:true; --watch only after delimiter |
| run --reporter watch | run:true; reporter:['watch'] |
| watch --run | watch:true AND run:true |

Actual native CLI (spawn Node with stdio ignore/pipe/pipe; terminate DEV after banner):

| argv | actual banner |
|---|---|
| --watch | DEV |
| watch --run | RUN |
| run --watch | DEV |
| run --watch=false | RUN |
| run -- --watch | RUN |

Commands:

```js
import { parseCLI } from '/tmp/rifty-vitest-native/node_modules/vitest/dist/node.js';
parseCLI(['vitest', ...args]);
// Effective mode discriminator:
spawn(process.execPath, ['node_modules/vitest/vitest.mjs', ...args], {
  cwd: '/tmp/rifty-vitest-native', stdio: ['ignore', 'pipe', 'pipe']
});
```

## Candidates

1. Generic reachable Node ceiling — killed for this observation. Readline/raw-input ceilings exist but watch correctly bypasses them on non-TTY input. VFS watcher/lifecycle machinery already lets watch reach waiting. No demonstrated generic missing call currently forces the accepted negative. Do not damage fs.watch/readline/TTY semantics globally to manufacture failure. A newly proven generic missing contract could independently enter observed-defect route, but it cannot substitute for demonstrated watch rejection now.
2. Minimal finite capability admission — selected. Existing entry-preparation has exact entry, untouched argv and installed FsSync; registry already owns finite launch compatibility. Reject unsupported capability before real CLI starts. No persistent state/new coordination/API/general plugin framework. Preserve all admitted real parser behavior; do not rewrite arguments.
3. Per-Vitest source patch / owner fake command — killed. Contradicts rejected source-shape route and ADR-0174 installed-bin ownership; hides native parser/config behavior. Admission throws without editing or substituting upstream executable bytes.
4. Amend I7 to document watch as unspecified/partial/working — killed within current authorization. Destination is user-owned RDY-6. A request for amendment is unnecessary while candidate 2 can deliver current invariant.

## Implementation constraints

- Resolve identity from installed tree and declared bin; not a substring/basename-only guard on arbitrary user files. Match exact supported package version/pair as appropriate; direct canonical installed bin entry must not accidentally bypass if advertised as same supported CLI route. Generic user programs remain generic.
- Name the ceiling `vitest.watch` (or explicit named CLI capability ceiling). Do not claim this is `readline.emitKeypressEvents`: that call is never reached on the observed path.
- A naive `args.includes('--watch')`, prefix regex, or only literal `watch` command is insufficient: aliases, flags, booleans, `--`, value-taking options, native action precedence and help/version must discriminate using pinned matrix.
- Config-selected/default watch also matters if those invocations remain admitted. The smallest complete admission envelope may positively admit exact run actions plus information-only actions and loud-reject unclaimed action modes. Under `run`, upstream forces watch off unless a native watch override wins. If choosing this envelope, explicitly record the extra mode restriction as finite policy; do not assert every rejected non-run command necessarily selects watch. Help/version stay native, including watch help. Do not add a handmade TS-config interpreter merely to deny watch.
- If retaining bare `vitest`/other actions, prove config `test.watch:true` is also denied before claiming the entire watch negative. Recognizing argv alone does not establish that proof. This is a required completeness check for chosen implementation, not a request to broaden the accepted destination.
- Unsupported modes must not run tests successfully first. Real browser e2e must observe named throw + nonzero exit; claimed forks/threads/TS-config/reporter proof stays green. No source grep or mock closes acceptance.

## Exact ADR relationship

New short successor ADR: "Installed CLI capability admission before native execution".

Partially supersede ADR-0174 Decision bullet 4's sentence "It is environment plumbing, not command semantics; the installed Vite entry still performs arg/config/subcommand behavior" only insofar as it categorically excludes package-specific capability admission from registry preparation. New rule: finite explicit compatibility admission may refuse an unsupported installed-CLI mode with a named ceiling before execution; admitted modes still run unchanged installed CLI with native parser/config/behavior. No owner-registered callback or source patch is authorized by this exception. Existing Vite modes remain admitted as today; no new Vite denial policy.

Preserve ADR-0174 installed-bin dispatch, real args/config/subcommand ownership for admitted paths, server-capable generic child lifecycle, observation-only UX, and all later corrections. Old ADR remains active; add dated `## Corrections (active)` note pointing to successor. Do not remove/graft existing decisions.

Cite ADR-0384 D1/D3 as registry-owned finite adaptation/launch policy authority; extension, not supersession. ADR-0155 arbitrary-entry/lifecycle and ADR-0157 seeded mutable process/stdin remain unchanged: admission does not alter loader/process/TTY authority. ADR-0230 non-TTY stdin also unchanged.

## Route

Observed-defect route: existing accepted I7 baseline -> captured real browser RED -> repair -> independent Final+GREEN (README; REV-12; RDY-8). No new Contract+RED stage merely because carrier is a new guard: negative promise already exists, current real run disproves it. This independent DEC-2 decision is pre-implementation evidence for the newly selected policy, not a replacement for RED or Final+GREEN. Add boundary regression/effective-mode matrix before product edit as needed; preserve recorded old RED. Replacing incorrect expected diagnostic `readline.emitKeypressEvents` with promised named admission ceiling is justified by unchanged I7 authority and this decision; do not weaken nonzero/loud requirements.

Status: decision/evidence complete. Product unchanged. Guard implementation and browser GREEN not checked here.
