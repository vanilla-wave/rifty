# Workbench sandbox support — refine evidence

Date: 2026-09-15. Baseline: `51440931aeb5e322ddfcab930e02068e7083922e`.

## Original request and answers

- User: «нужна возможность точно понять из workbench поддерживает браузер песочницу или нет + детализировать ответ, если можно. Как для coi так и для non coi режима».
- Round 1: «API @riftydev/workbench»; alternatives: API + Playground UI, UI only.
- Round 2: «До открытия песочницы»; alternatives: startup result, preflight + startup errors.
- Round 3: «Реальные пробы браузерных возможностей»; offered wording explicitly included temporary Worker/test data with cleanup. Alternatives: passive API presence without effects; full deployment files/settings verification.

## Dedup and current sources

- Related capture: `playground/capabilities-detection-e2e-logging` (2026-06-08),
  an unverified startup/e2e logging audit. Its logging obligation remains there;
  it does not supply a callable Workbench API before opening.
- `rg -n 'detectCapabilities|checkCapabilities' apps/playground/src packages/workbench/src packages/rifty/src tests -g '*.{ts,tsx,mjs}'`:
  SDK wrapper/boot/tests and Playground `playground-app.tsx:166` call it;
  no Workbench call found. Playground gates execution/UI at lines 1365/1458/1515
  and renders `CapabilitiesPanel` on insufficient capabilities. The first search
  omitted TSX; independent review caught and corrected its false no-Playground
  conclusion. Startup/e2e logging remains unverified.
- `packages/runtime-js/src/env/capabilities.ts`: current-realm globals;
  `sufficient` requires only Worker + ServiceWorker; no mode-specific verdict.
- `packages/workbench/src/workbench/public.ts`: no public support preflight.
- `packages/workbench/src/workbench/open-workbench.ts`: DOM/Worker/COI/Web Locks
  hard gate; real opening acquires origin lease, registers/proves SW, starts owner.
- `packages/rifty/src/sandbox.ts`: explicit non-COI toolchain uses the Workbench
  worker via SDK; generic SDK sandbox is a distinct composition. Toolchain
  startup awaits readiness; `capabilityReport` describes its existing limits.
- ADR-0007: feature detection; Chromium primary, other engines best-effort.
- ADR-0372: OPFS authority is the dedicated Worker; permission/durability are
  separate observations. Workbench COI gate remains.
- ADR-0375/0383/0419: non-COI admission, VM choice, configured storage/startup.
- Related, separate: `playground/project-compatibility-preflight` predicts
  project/package compatibility; `service-worker/cross-browser-compat-matrix`
  owns generated per-engine reporting. Neither supplies this callable API.
- Searched backlog titles/code/maps, traps, ADR index/Declined concepts. No
  declined match for support diagnostics. Existing declined non-COI Workbench
  project/terminal surface stays declined; diagnosis does not enable it.

## Executed browser discriminator

Command from repository root: `node /tmp/rifty-support-probe.mjs`.
Node `v24.16.0`; Playwright `1.60.0`; Chromium `148.0.7778.96`.
The script serves the actual detector after Node type stripping, uses fresh
browser contexts, real dedicated module Workers and native OPFS. No rifty
runtime/Worker API mocks. Source reproduced below; stdout also retained at
`/tmp/rifty-support-probe-output.json` during this session.

| Page | passive sufficient | page sync OPFS | Worker result | Worker sync OPFS | exact OPFS write/flush/read |
|---|---|---|---|---|---|
| COI | true | false | ready | true | true |
| non-COI | true | false | ready | true | true |
| COI, CSP worker-src none | true | false | error, empty message | unobserved | unobserved |
| non-COI, CSP worker-src none | true | false | error, empty message | unobserved | unobserved |

All pages: secure context, Worker, ServiceWorker and Web Locks present.
COI pages: SAB present; non-COI: absent. `Atomics.waitAsync` present throughout.
Inside both successful Workers: ServiceWorker absent, old detector
`sufficient: false`, despite successful storage probe. A page/Worker-wide AND
therefore cannot describe the composed runtime.

This proves presence checks can miss a real policy denial and that Window OPFS
absence cannot diagnose Worker storage. It does not prove rifty boot, arbitrary
packages, all deployment assets, other engines, or every failure cause.
The CSP header is known to the harness; the Worker error alone did not expose
it. A product report must not invent that cause from an empty error.

First attempt: localhost bind rejected by sandbox (`listen EPERM`); rerun with
sandbox escalation succeeded. First script revision read after write without
resetting the native file cursor; corrected both offsets to zero and reran.
That discarded probe error was not a rifty defect.

Reference corroboration, accessed 2026-09-15:

- [MDN worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src): policy governs Worker/SW script loads.
- [MDN createSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle): dedicated Worker and secure context; permission failures remain possible.

## Early Challenge

Reviewer: `/root/support_premise`; fresh context, read-only, no children.
Verbatim verdict before user scope answers:

> `challenge: 2026-09-15 — 1 problem`
>
> Ценность подтверждена: существующий `sufficient` проверяет только Worker/ServiceWorker; он не определяет возможность запуска Workbench. Но отдельный preflight пока не обоснован: исходный запрос не требует ответа до запуска. Более дешёвый прямой маршрут — структурированный результат существующей попытки запуска с причинами отказа и ограничениями. Вопрос «пассивная проверка или активный preflight» преждевременно исключает этот вариант.

Resolution: Round 1 selected the public API; Round 2 explicitly selected a
result before opening, rejecting startup-only diagnosis. Round 3 then selected
real browser probes, rejecting passive-only presence and broader deployment
verification. Early Challenge is not the final written-result check.

## Scope closure after Round 3

| Source | Observable consequence | Authority |
|---|---|---|
| Original COI/non-COI request, ADR-0372/0375 | Separate named compositions; no new non-COI openWorkbench topology | User outcome + existing mode contracts |
| Round 1 / Round 2 | Public Workbench API before sandbox opening; host renders details | Explicit user answers |
| Round 3 + actual CSP/OPFS probe | Real bounded Worker/memory/storage probes, temporary-resource cleanup | Explicit chosen option; exact checks/carriers agent-owned at PICKUP |
| Round 3 alternatives | Browser prerequisites only; actual deployment/package success unproven | User chose browser probes over deployment verification |
| ADR-0372/0419 | Storage result reflects owner realm and persistence policy; optional loss is not unconditional rejection | Existing storage contract |
| Original inspection action, repeated calls or already-open session | No project mutation, no host isolation change; no stale results or false browser-incompatibility claim from contention | Inspection scope + Fidelity |
| Worker error with empty message, stalled probe/cleanup denial | Failed/unfinished check visible; unproved cause stays unknown; cleanup failure visible | Executed probe + Fidelity, reachable fault model |

One diagnostic outcome fits a standalone item. No user fork currently remains;
public signature, probe URLs/worker carrier, per-mode requirement inventory,
bounded settlement/cleanup mechanism and browser test coverage belong to PICKUP.
The probe is browser evidence, not a shipped API or a complete RED suite.
Prior final review certified the earlier unresolved capture only; new final
review must examine the actual post-answer result.

## Feedback reception

Source: user-provided `/tmp/wrap-up-pr340-plan-objections-2026-09-15.md`.
Checked against current source and a [new native CSP discriminator](workbench-sandbox-support-csp-evidence.md).

| Point | Reception |
|---|---|
| 1, incomplete inventory | Valid. Owner-child path uses kernel `makeKernelWorker`; dynamic import, JS evaluation, conditional WASM and Web Locks must enter the boot-derived mapping. Existing probe already imports a module, but does not cover the whole composition. |
| 2, legacy sufficient | Valid documentation ambiguity; the flag computes presence correctly. ADR-0071 D5 keeps the pure API; it must not promise successful startup. No sync-to-async breaking replacement prescribed. |
| 3, SW | Valid evidence distinction; no data supports «most frequent fail». Registration capability and actual deployment control differ; unknown required checks block a positive prerequisite verdict. |
| 4, OPFS | Future collision/cleanup cases are valid; no observed live-session collision. Disposable script uses fresh contexts, not an open Workbench. Its fixed filename is not a production carrier. |
| 5, bounded | Outcome does not choose a timer or new coordination. Class-kill applies before adding a mechanism; record sweep at PICKUP. |
| 6, owner module | Real dependency constraint, agent-owned at PICKUP; SDK lacks Workbench dep, layer order permits SDK→Workbench. No duplicate probe or new dependency mandated. |
| 7, process bulk | Removed repeated hashes/check transcripts; preserve concise independent identity/revision records required by RDY-6/REV-8. |
| 8, CSP | No host/probe CSP guidance found in docs/public or traps. Source grep is not empty: net preview/header code contains CSP. Add targeted consumer guidance with implementation. |

Fresh read-only critic `/root/feedback_scope_critic`:
`challenge: 2026-09-15 — clear` — «обязательность full disposable boot не
подтверждена; нового пользовательского выбора не выявлено».
Safe SW carrier and public ownership are PICKUP choices; no existing host
registration/controller may change. Refine's chosen browser-probe scope stands.

## Independent review history

- `/root/support_final` @ `e6b81be582263f86d12982efe96cf1457a741409`: FIX (missed TSX source; retained logging audit). Corrected.
- `/root/support_final_clean` @ `a23a6700c72393c12b7d89f3d475024ee5e5bf99`: [PASS for unresolved draft](workbench-sandbox-support-final-green.json).
- `/root/support_settled_review` @ `5634648d3190ed1dba34e80eeddcc5d031cd0163`: [PASS after R3](workbench-sandbox-support-round3-final-green.json), docs-only pr:check 20/20. These records precede feedback amendments.

- `/root/feedback_final_review` @ `a29aeb024e6f02d8b8b440be917e053efdf841bf`: [PASS after feedback](workbench-sandbox-support-feedback-final-green.json), docs-only pr:check 20/20; original feedback, code/ADRs and both native probe artifacts verified. No remaining user fork. Product readiness remains with PICKUP.

## Disposable probe source

Save this block as `/tmp/rifty-support-probe.mjs`; run from repository root.

```js
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('package.json'));
const { chromium } = require('@playwright/test');
const detector = stripTypeScriptTypes(await readFile('packages/runtime-js/src/env/capabilities.ts', 'utf8'));
const workerSource = `import { detectCapabilities } from '/capabilities.js';
const result = { capabilities: detectCapabilities(), secure: isSecureContext };
try {
  const root = await navigator.storage.getDirectory();
  const name = 'rifty-disposable-support-probe';
  const file = await root.getFileHandle(name, { create: true });
  const handle = await file.createSyncAccessHandle();
  try {
    const bytes = new Uint8Array([37, 91, 255]);
    handle.write(bytes, { at: 0 }); handle.flush();
    const actual = new Uint8Array(3); handle.read(actual, { at: 0 });
    result.opfsRoundtrip = [...actual].join(',') === [...bytes].join(',');
  } finally { handle.close(); await root.removeEntry(name); }
} catch (error) { result.storageError = { name: error.name, message: error.message }; }
postMessage(result);`;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('coi')) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  if (url.searchParams.has('blocked')) res.setHeader('Content-Security-Policy', "worker-src 'none'");
  if (url.pathname === '/capabilities.js' || url.pathname === '/worker.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(url.pathname === '/capabilities.js' ? detector : workerSource);
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disposable support probe</title>'); }
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true });
  const output = { node: process.version, playwright: require('@playwright/test/package.json').version, chromium: browser.version(), cases: [] };
  for (const query of ['?coi', '', '?coi&blocked', '?blocked']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    const result = await page.evaluate(async (query) => {
      const { detectCapabilities } = await import('/capabilities.js');
      const passive = detectCapabilities();
      const active = await new Promise((resolve) => {
        let worker;
        const finish = (value) => { clearTimeout(timer); worker?.terminate(); resolve(value); };
        const timer = setTimeout(() => finish({ outcome: 'timeout' }), 3000);
        try {
          worker = new Worker('/worker.js' + query, { type: 'module' });
          worker.onmessage = (event) => finish({ outcome: 'ready', ...event.data });
          worker.onerror = (event) => { event.preventDefault(); finish({ outcome: 'error', message: event.message ?? '' }); };
        } catch (error) { finish({ outcome: 'throw', name: error.name, message: error.message }); }
      });
      return { query, secure: isSecureContext, webLocks: typeof navigator.locks?.request === 'function', passive, active };
    }, query);
    output.cases.push(result);
    await context.close();
  }
  await writeFile('/tmp/rifty-support-probe-output.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
```
