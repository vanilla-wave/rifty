# Browser prerequisites before opening

`@riftydev/workbench` exports `checkSandboxSupport()`. It runs disposable browser
operations before a sandbox opens and reports two existing compositions:

- `modes.coi`: `openWorkbench`, with COI and its normal QuickJS runtime.
- `modes.nonCoi`: the SDK's shared-memory-free Workbench toolchain, default rewrite VM.

```ts
import { checkSandboxSupport } from '@riftydev/workbench';

const report = await checkSandboxSupport({
  probeBaseUrl: '/rifty-assets/',
  persistence: 'preferred', // required | preferred | ephemeral
  nonCoiVmEngine: 'rewrite', // rewrite | quickjs
  wasm: false, // true when non-COI workloads also need WASM
  timeoutMs: 5000,
});

console.log(report.modes.coi.conclusion, report.modes.coi.reasons);
console.log(report.modes.nonCoi.conclusion, report.modes.nonCoi.limitations);
for (const check of report.checks) console.log(check.id, check.status, check.reason);
console.log(report.cleanup.status, report.cleanup.reason);
```

## Host assets

Copy these files from the installed `@riftydev/workbench/dist/assets/` directory
to a same-origin HTTP(S) directory, preserving filenames:

- `support-worker.js`
- `support-child.js`
- `support-module.js`
- `support-service-worker.js`

Serve JavaScript MIME types. `probeBaseUrl` names that directory and ends in `/`;
it accepts relative URLs or absolute same-origin URLs, without query/fragment.
The SW probe is inert: no fetch handler, `clients.claim()` or `skipWaiting()`.
Keep that file unchanged; never substitute the application's SW.
An omitted directory leaves asset-dependent checks `incomplete`. It does not
guess host URLs or open a real sandbox. No new dependency is needed if the host
already imports Workbench.

## Reading the report

Checks are `passed`, `failed`, `incomplete` or `not-applicable`. Modes list their
`required` check IDs and conclude:

- `supported`: every required browser operation passed in this context.
- `unsupported`: at least one required operation failed; inspect its reason.
- `inconclusive`: no established required failure, but required evidence is missing.

`reason` describes what was observed. Native exceptions retain name/message;
empty Worker errors retain an unknown cause. Optional failures appear in
`limitations`. A positive mode result can coexist with an OPFS limitation under
`preferred`; `required` makes OPFS mandatory, `ephemeral` skips it. OPFS is tested
in a dedicated Worker using sync handles and replica write/read/delete operations,
not by looking for sync handles on Window.

Both compositions require cryptographic UUID generation. COI also requires
isolation, SAB/Atomics, a private Window Web Lock, nested module
Workers, JS eval, QuickJS WASM and SW registration. Non-COI has no COI/SAB gate,
uses rewrite by default, and reports SW/preview loss as optional limitations.
Selecting QuickJS or `wasm: true` makes WASM mandatory for non-COI too. JS eval
remains required for the host CJS/REPL path under either VM.

SW API presence, private classic/module registration + activation, and actual
deployment control are separate observations. `deployment-control` remains
`incomplete` even when the disposable registration succeeds; `openWorkbench`
still proves its real controlling SW during opening.

## CSP and evidence limits

Apply the CSP appropriate to your execution Workers to the probe Worker response
as well. The document must allow same-origin Worker/SW creation; Worker policy
must allow same-origin module imports and, for COI, nested Workers. The actual
runtime uses dynamic JavaScript evaluation (`unsafe-eval`); `wasm-unsafe-eval`
alone permits WASM but does not establish JS evaluation. WASM compilation is
tested separately. COI pages/Workers still need their normal COOP/COEP headers.

The report tests browser prerequisites with tiny assets, not every deployed
runtime file, header or configured URL. Different CSP on actual runtime assets,
network availability, SQLite's configured sync asset loading, package/runtime
bindings, future quota/durability and arbitrary npm program compatibility remain
unverified. It does not promise that another Workbench leaves the origin lease free.

Each call probes afresh. Probe work and cleanup each have the configured deadline;
timers can be delayed by suspended tabs. Only private Workers/ports/channels,
scratch data and SW scopes are removed. Native registration/file creation cannot
be canceled: late completion retains cleanup, and the returned immutable report
keeps `cleanup: incomplete` if removal was not observed before its deadline.
Cleanup failure is explicit; callers should inspect it alongside mode conclusions.

SDK `checkCapabilities()` remains a pure synchronous presence report for its
current realm. Its `sufficient` means Worker + ServiceWorker globals are present;
it proves neither startup nor the Worker realm's storage permissions.
