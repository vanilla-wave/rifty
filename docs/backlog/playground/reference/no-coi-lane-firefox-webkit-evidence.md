<!-- Evidence for playground/no-coi-lane-firefox-webkit, vfs/opfs-createwritable-capability-gate, vfs/opfs-root-unavailable-loud-throw; verbatim run report 2026-09-16 + probes 2026-09-27 -->

# rifty non-COI lane × 3 browser engines — empirical run

Re-emitted from the session transcript after `/tmp` was wiped. The run report is verbatim except for two dated notes marked **Correction 2026-09-27**. The original `/tmp` scripts and JSON reports are gone; the discriminating scripts are inlined in §Appendix.

- Date of runs: 2026-09-16 23:51 → 2026-09-17 00:47 CEST (sequential, never concurrent)
- Repo: rifty worktree, branch `t3code/research-browser-support`
- git HEAD: `4f94a0584770869cadd8b4f3a692ef7e1c852744`
- Playwright: `1.60.0` (`playwright-core@1.60.0`), browsers from `~/Library/Caches/ms-playwright`
- Engine versions as reported by `browser.version()`:
  - chromium `148.0.7778.96` (chromium-1223)
  - firefox `150.0.2` (firefox-1522)
  - webkit `26.4` (webkit-2287)
- Lane: `tests/no-coi` (19 spec files, 100 tests), `workers: 1`, `fullyParallel: false`, `retries: 0`, timeout 900 s
- Only the non-COI lane was run. No COI lane was touched. No product code was modified. No specs/fixtures were patched (see §Local patches).

## Headline

| engine | result | wall time |
| --- | --- | --- |
| chromium 148.0.7778.96 | **100 / 100 passed** | 4.5 m |
| firefox 150.0.2 | **99 / 100 passed**, 1 failed | 6.2 m |
| webkit 26.4 | **41 / 100 passed**, 57 failed + 2 timed out | 20.6 m |

- Firefox's single failure is a spec that hard-pins `browser.version()` to Chrome 148, so Firefox has **zero** product failures in this lane.
- WebKit's 59 failures collapse to **one** root cause plus two unrelated singletons. The root cause is a *harness* fact, not a WebKit product gap: **Playwright's ephemeral WebKit context provides no OPFS at all**, because `navigator.storage.getDirectory()` itself rejects. This was proven by a direct probe and by re-running two WebKit canaries against a **persistent** WebKit profile, where the rifty no-COI OPFS paths produce byte-exact Chromium-expected results.

## Prerequisite

CI runs `pnpm test:client-bundles` before `pnpm test:no-coi`. It was run once before the engine runs and **passed**: the `main`/`sw`/`generic`/`toolchain` bundle budgets were OK, with 15 first-party + 72 external tarballs. `packages/*/dist` were already present for all 15 packages. The no-COI lane itself serves source through the Vite dev server (`apps/playground/vite.no-coi.config.ts`), so it needs no extra workbench asset build. There were no port conflicts on 5411/5412/5413 at start.

## Spec × engine

Each cell is the per-test tally for that file. ✅ passed, ❌ failed, ⏱ timed out, ⏭ skipped.

| spec (tests) | chromium 148 | firefox 150 | webkit 26.4 |
| --- | --- | --- | --- |
| `no-coi-agent-installed-cli.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| `no-coi-agent-network.spec.ts` (1) | ✅1 | ✅1 | ✅1 |
| `no-coi-agent-sdk.spec.ts` (5) | ✅5 | ✅5 | ❌3 ⏱1 ✅1 |
| `no-coi-configured-startup.spec.ts` (6) | ✅6 | ✅6 | ❌4 ✅2 |
| `no-coi-dev-hmr.spec.ts` (17) | ✅17 | ✅17 | ❌2 ✅15 |
| `no-coi-install-dedup.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| `no-coi-layout-notice.spec.ts` (4) | ✅4 | ✅4 | ❌4 |
| `no-coi-memory-descriptor.spec.ts` (2) | ✅2 | ❌1 ✅1 | ❌1 ✅1 |
| `no-coi-opfs-reload.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| `no-coi-persistence.fault.spec.ts` (2) | ✅2 | ✅2 | ❌2 |
| `no-coi-pi-agent.spec.ts` (4) | ✅4 | ✅4 | ❌1 ✅3 |
| `no-coi-preload-failure.spec.ts` (2) | ✅2 | ✅2 | ❌2 |
| `no-coi-resident-exit.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| `no-coi-sandbox-build-loop.spec.ts` (21) | ✅21 | ✅21 | ❌2 ⏱1 ✅18 |
| `no-coi-saved-access.spec.ts` (5) | ✅5 | ✅5 | ❌5 |
| `no-coi-snapshot-application.spec.ts` (12) | ✅12 | ✅12 | ❌12 |
| `no-coi-stream-visibility.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| `no-coi-warm-open.spec.ts` (13) | ✅13 | ✅13 | ❌13 |
| `replica-storage.spec.ts` (1) | ✅1 | ✅1 | ❌1 |
| **total** | **100 ✅** | **99 ✅ / 1 ❌** | **41 ✅ / 57 ❌ / 2 ⏱** |

The Chromium column is taken from `/tmp/no-coi-chromium.log` (all 100 lines `✓`, `100 passed (4.5m)`). A later `--list` invocation without `RIFTY_ENGINE` set overwrote `/tmp/no-coi-chromium.json` with a list-only report. The Firefox and WebKit columns come from their JSON reports.

## Failure triage

### Firefox — 1 failure

| # | spec:line | class | evidence |
| --- | --- | --- | --- |
| F1 | `tests/no-coi/no-coi-memory-descriptor.spec.ts:136` | **test-infra** | `expect(browser.version()).toBe('148.0.7778.96')` → `Expected: "148.0.7778.96" / Received: "150.0.2"`. The test is an oracle recording *Chrome 148's* native `WebAssembly.Memory` descriptor read order. The version gate is line 1 of the body, so no product code runs on any other engine. Product behavior on SpiderMonkey is **unobserved**, not failing. The other test in the same file passes on Firefox. |

There were no other failures. No OPFS, worker, stack-format, stream or timing difference surfaced on Firefox across all 19 specs.

### WebKit — 59 failures, 4 classes

**W-A. 55 × `test-infra`: Playwright's ephemeral WebKit context has no OPFS root.**

The native error is identical everywhere (WebKit's `UnknownError` DOMException):

```
UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).
```

Direct probe (`/tmp/opfs-probe.mjs`, module Worker on `http://127.0.0.1`, secure context true):

```
webkit 26.4: FAIL storage.getDirectory :: {"name":"UnknownError","message":"The operation failed for an unknown transient reason (e.g. out of memory)."}
  caps: syncProto=function writableProto=function DecompressionStream=function toSorted=function randomUUID=function
chromium 148 / firefox 150: OK storage.getDirectory, OK createSyncAccessHandle, OK createWritable, OK removeEntry
```

Discriminator (`/tmp/opfs-probe2.mjs`, inlined as Appendix C): same WebKit build, same URL, same worker.

```
webkit 26.4 ephemeral newContext : window {"ok":false,"name":"UnknownError",...}  worker {"ok":false,...}  estimate quota 1048576000
webkit 26.4 launchPersistentContext: window {"ok":true,"brand":"[object FileSystemDirectoryHandle]"} worker {"ok":true,...} estimate quota 20615843021
webkit 26.4 headed ephemeral      : window {"ok":false,...}  worker {"ok":false,...}
```

So WebKit 26.4 *does* implement OPFS (sync access handles and writable streams). It refuses to hand out a storage root when the session has no on-disk backing store, which is exactly what `webkit.launch()` + `newContext()` gives. Capability detection inside rifty is unaffected and reports `opfsSyncSupported: true, opfsAsyncSupported: true, detected: "opfs"`. Only the actual operation rejects. rifty then degrades to the memory backend, and that fallback is what most of these assertions catch.

Sub-groups (all one root):

- 18 tests fail with the raw `UnknownError` out of a `page.evaluate`: `no-coi-configured-startup.spec.ts:40,135,159(×2)`, `no-coi-preload-failure.spec.ts:6`, `no-coi-saved-access.spec.ts:6` (×5), `no-coi-warm-open.spec.ts:171` (×7), `replica-storage.spec.ts:5` (at `replica-storage.spec.ts:10:29`).
  - **Correction 2026-09-27 (unverified per test):** some of these raw throws originate in *test-fixture* page-realm OPFS access, not in rifty. For example, `no-coi-configured-startup.spec.ts:40` calls `accessNativeReplica(page, …)` and `navigator.storage.getDirectory()` in the page before `createSandbox`. Per-test attribution was not done.
- 13 tests fail with `NotImplementedError: Not implemented: sandbox.toolchain.worker (toolchain Worker crashed during handshake: UnknownError: The operation failed for an unknown t…)`: `no-coi-layout-notice.spec.ts:65`, `no-coi-snapshot-application.spec.ts:62,118,201(×8),254,276`. Probe P2 below reproduces this exact text on Chromium for `persistence: 'required'`.
- 8 tests fail with the bare `UnknownError`: `no-coi-layout-notice.spec.ts:4` (×3), `no-coi-preload-failure.spec.ts:50`, `no-coi-warm-open.spec.ts:90,171,247,276`.
- 16 downstream assertion failures, all of the shape "expected the OPFS/native path, got the memory fallback":
  - `no-coi-opfs-reload.spec.ts:62` received `{"error":"UnknownError: …","initChoice":null,"ok":false,"syncHandlesClosed":false}` while `facts` still said `opfsSyncSupported:true, opfsAsyncSupported:true, detected:"opfs"`.
  - `no-coi-sandbox-build-loop.spec.ts:1252` (at `:1318:23`): `publicBackend: "memory"` instead of `"opfs"`.
  - `no-coi-dev-hmr.spec.ts:1272`: `Expected "opfs" / Received "memory"`. `:1401`: `["opfs","memory","opfs"]` vs `["memory",…]`.
  - `no-coi-agent-sdk.spec.ts:82,156(×2)` and `no-coi-agent-installed-cli.spec.ts:3`: `persistence: "flushed"` expected, `"memory"` received.
  - `no-coi-persistence.fault.spec.ts:7` (×2, at `:66:20`): expected a rejection containing `"native quota probe"`, got `{"resolved":true}`. The native persistence fault cannot be injected because the native path never engages.
  - `no-coi-warm-open.spec.ts:227` (×2): `expect(...).rejects.toThrow()` → `Received promise resolved instead of rejected`.
  - `no-coi-install-dedup.spec.ts:6`: `Expected true / Received false`.
  - `no-coi-stream-visibility.spec.ts:25`: `stream probe failed: {"id":2,"ok":false,"error":{"name":"UnknownError",…}}`.
  - `no-coi-pi-agent.spec.ts:79`: `VfsError: ENOENT: /agent-stop`. `no-coi-resident-exit.spec.ts:3`: `VfsError: ENOENT: /resident/node_modules/.bin/local-server` (project bytes never persisted).

**Counter-proof that the product path works on WebKit.** Both hazards named in the brief were re-run against `webkit.launchPersistentContext()` on the real no-COI Vite host (`http://127.0.0.1:5411`), using the same fixtures the specs use:

- `replica-storage.spec.ts` body (`tests/browser-unit/fixtures/replica-persistence-worker.ts`, `kind: 'configured'`) returned `{"backend":"opfs","segmented":true,"isolated":false,"text":"old-a"}`. That is **exactly** the Chromium expectation; `crossOriginIsolated: false`.
- `no-coi-opfs-reload.spec.ts:62` body (`tests/browser-unit/fixtures/opfs-no-coi-policy-worker.ts`, write → `page.reload()` → read; inlined as Appendix D) returned:
  - write `{"ok":true,"initChoice":"opfs","backend":"opfs","flushResult":{"total":0,"failures":[]},"syncHandlesClosed":true,"publicAsyncBackend":"opfs","crossSurfaceActual":[0,1,2,127,128,254,255,13,10]}`
  - read `{"ok":true,"initChoice":"opfs","backend":"opfs","actual":[0,1,2,127,128,254,255,13,10],"syncHandlesClosed":true}`, with distinct `workerId`s.

  So the feared hazard #1 (exclusive `writer.lock` sync-access-handle not released across reload) **does not reproduce on WebKit 26.4**: the lock is released and the exact bytes survive the reload.

**W-B. 1 × `test-infra`: Chrome-version-pinned oracle.**

`tests/no-coi/no-coi-memory-descriptor.spec.ts:136`: `Expected: "148.0.7778.96" / Received: "26.4"`. This is the same spec as F1.

**W-C. 1 × `engine-behavior`: WebKit ignores `Cross-Origin-Embedder-Policy: credentialless`.**

`tests/no-coi/no-coi-sandbox-build-loop.spec.ts:2341` ("build parity: headerless SDK dist equals live COI product bytes — designed RED") fails with `page.evaluate: Error: Workbench requires cross-origin isolation`. The error comes from its `runCoiProduct(coiPage)` step, which is the COI *oracle* half of this non-COI spec. That half is served with these headers from `apps/playground/vite.config.ts:67-69`:

```
'Cross-Origin-Opener-Policy': 'same-origin',
'Cross-Origin-Embedder-Policy': 'credentialless',
'Cross-Origin-Resource-Policy': 'cross-origin',
```

Probe (`/tmp/coi-probe.mjs`, plain node http server, both `127.0.0.1` and `localhost`):

| COEP value | chromium 148 | firefox 150 | webkit 26.4 |
| --- | --- | --- | --- |
| `require-corp` | `crossOriginIsolated:true`, `SharedArrayBuffer:function` | true / function | **true / function** |
| `credentialless` | true / function | true / function | **false / undefined** |

Mechanism: WebKit implements only `COEP: require-corp`. It treats `credentialless` as no COEP, so the document is not isolated and `SharedArrayBuffer` is absent. Nothing in the non-COI product path is involved; the non-COI half of that spec is blocked by W-A anyway. This is recorded because the brief asked for the mechanism and code path. Acting on it belongs to the COI lane, which was not touched here.

**W-D. 2 × `timeout/flake`: deterministic hang, no diagnostic.**

Both were re-run in isolation (`--project=webkit <spec>:<line> --timeout=180000`) and **reproduced**. Neither is a flake, and neither emitted an error.

| spec:line | in-suite | isolated re-run | pending Playwright call at timeout (from trace) |
| --- | --- | --- | --- |
| `no-coi-agent-sdk.spec.ts:8` "Stop retains an applied mutation through the pending native flush" | ⏱ 120 s | ⏱ 120 s | `page.evaluate` of `createSandbox({ requireCrossOrigi… })` with the native-replica probe, after `context.route('**/agent-flush-barrier')` and `goto /no-coi-harness.html` |
| `no-coi-sandbox-build-loop.spec.ts:2698` "host stays interactive while admitted install and run wait at network boundaries" | ⏱ 900 s | ⏱ 180 s | (page snapshot shows the harness still at `headerless SDK harness`; no error surfaced) |

These were judged "almost certainly downstream of W-A (both wait on a native/OPFS flush that can never settle)", but that was inference. The run produced no diagnostic, so they were classified as timeouts rather than folded into W-A. Their `error-context.md` contains only the page snapshot.

- **Correction 2026-09-27:** the agent-sdk:8 "pending call" cell above is wrong. In the trace that `page.evaluate` was *completed*. The test waited Node-side at `await request` (`tests/no-coi/no-coi-agent-sdk.spec.ts:54`), and no Playwright call was pending. Probe P2 (below) shows both flows settle on Chromium with the fault and on WebKit itself. Reclassification: agent-sdk:8 → **test-infra (unbounded spec-side wait)**; build-loop:2698 → **unknown, spec-side**.

## Bonus — `checkSandboxSupport()` per engine

Test: `tests/browser-unit/sandbox-support.spec.ts:131` (`real COI …` and `real non-COI prerequisites, owner OPFS, cleanup and evidence limits`), run via:

```
pnpm exec playwright test --config playwright.browser-unit.config.ts --browser=<engine> tests/browser-unit/sandbox-support.spec.ts -g "prerequisites, owner OPFS"
```

**Firefox 150.0.2: both tests passed.** Verbatim, non-COI host:

```
"nonCoi":{"composition":"sdk-toolchain","conclusion":"supported",
 "required":["window","secure-context","crypto","module-worker","module-import","message-port","js-eval","opfs"],
 "unmet":[],"limitations":[]}
"coi":{...,"conclusion":"unsupported","unmet":["cross-origin-isolated","shared-memory"],"limitations":[]}
"cleanup":{"id":"cleanup","status":"passed","reason":"Probe Workers/ports/channels terminated and every owned native resource removed"}
"limits":["Only tested browser prerequisites in the current context: actual deployment assets, CSP differences and controlling Service Worker configuration remain unverified.",
 "No guarantee of arbitrary npm package compatibility, future storage availability or durability, or an available Workbench origin lease.",
 "Non-COI describes the SDK toolchain composition; openWorkbench still requires COI."]
```

On the COI host, Firefox reports `coi.conclusion: "supported"` and `unmet: []`. Every check `passed`, including `shared-memory`, `opfs`, `service-worker-module-registration`, `wasm`, `page-locks`, `nested-worker` and `broadcast-channel`. Only `deployment-control` is `incomplete`, which is by design.

**WebKit 26.4: both tests failed**, for the W-A reason. Verbatim, recovered from `trace.zip` because the spec only logs the report on success:

```
"nonCoi":{"composition":"sdk-toolchain","conclusion":"unsupported",
 "required":["window","secure-context","crypto","module-worker","module-import","message-port","js-eval","opfs"],
 "unmet":["opfs"],"limitations":[]}
"coi":{...,"conclusion":"unsupported","unmet":["cross-origin-isolated","shared-memory","opfs"],"limitations":[]}
{"id":"opfs","status":"failed","reason":"opfs: UnknownError: The operation failed for an unknown transient reason (e.g. out of memory)."}
{"id":"shared-memory","status":"failed","reason":"shared-memory: ReferenceError: Can't find variable: SharedArrayBuffer"}
{"id":"cross-origin-isolated","status":"failed","reason":"cross-origin-isolated: Error: Current document is not cross-origin isolated"}
"cleanup":{"id":"cleanup","status":"passed","reason":"Probe Workers/ports/channels terminated and every owned native resource removed"}
"limits":[ … same three strings as Firefox … ]
```

Everything else passed on WebKit: `window`, `secure-context`, `crypto`, `page-locks`, `module-worker`, `module-import`, `nested-worker`, `message-port`, `broadcast-channel`, `js-eval`, `wasm`, `service-worker-api`, `service-worker-registration` and `service-worker-module-registration`. `deployment-control` is `incomplete`. The `unmet:["opfs"]` is the ephemeral-context artifact (W-A), and the COI `unmet` additions are W-C. With a persistent profile the OPFS probe succeeds (see the W-A discriminator).

Both engines' COI rows come from `apps/playground/vite.config.ts` headers (`credentialless`). Firefox's COI `supported` verdict therefore also proves that Firefox honours `credentialless`.

## Capability spot-checks (module Worker, all three engines)

From `/tmp/opfs-probe.mjs`, worker realm, `http://127.0.0.1`, `isSecureContext: true`:

| capability | chromium 148 | firefox 150 | webkit 26.4 |
| --- | --- | --- | --- |
| `FileSystemFileHandle.prototype.createSyncAccessHandle` | function | function | function |
| `FileSystemFileHandle.prototype.createWritable` | function | function | function |
| `DecompressionStream` | function | function | function |
| `Array.prototype.toSorted` | function | function | function |
| `crypto.randomUUID` | function | function | function |
| `navigator.storage.getDirectory()` (ephemeral PW context) | ok | ok | **rejects `UnknownError`** |
| 2nd `createSyncAccessHandle` on an open file | `NoModificationAllowedError` ("Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.") | `NoModificationAllowedError` ("No modification allowed") | not reachable (no root) |

The contention error name matters. `packages/vfs/src/opfs-replica-store.ts:57-67` retries only on `NoModificationAllowedError` and rethrows anything else. Chromium and Firefox both produce that exact name, so the 30 s admission retry loop behaves identically on Firefox. **WebKit's contention error name is still unverified**: it could not be probed in an ephemeral context, and the persistent-profile runs never contended.

## Local patches

**None.** No spec, fixture, product file or config under `apps/`/`packages/`/`tests/` was modified. The only file added to the working tree was the untracked temp config `playwright.no-coi.engines.config.ts`, which was deleted at the end. All probes and scripts lived in `/tmp`.

## Commands used

The `/tmp` scripts were lost in the wipe; the discriminating ones are in §Appendix.

```
pnpm test:client-bundles
RIFTY_ENGINE=chromium pnpm exec playwright test --config playwright.no-coi.engines.config.ts --project=chromium   > /tmp/no-coi-chromium.log
RIFTY_ENGINE=firefox  pnpm exec playwright test --config playwright.no-coi.engines.config.ts --project=firefox    > /tmp/no-coi-firefox.log
RIFTY_ENGINE=webkit   pnpm exec playwright test --config playwright.no-coi.engines.config.ts --project=webkit     > /tmp/no-coi-webkit.log
RIFTY_ENGINE=webkit-iso pnpm exec playwright test --config playwright.no-coi.engines.config.ts --project=webkit \
  tests/no-coi/no-coi-agent-sdk.spec.ts:8 tests/no-coi/no-coi-sandbox-build-loop.spec.ts:2698 --timeout=180000    > /tmp/no-coi-webkit-iso.log
RIFTY_PLAYGROUND_PORT=5299 pnpm exec playwright test --config playwright.browser-unit.config.ts --browser=firefox \
  tests/browser-unit/sandbox-support.spec.ts -g "prerequisites, owner OPFS"                                       > /tmp/support-firefox.log
RIFTY_PLAYGROUND_PORT=5299 pnpm exec playwright test --config playwright.browser-unit.config.ts --browser=webkit  \
  tests/browser-unit/sandbox-support.spec.ts -g "prerequisites, owner OPFS"                                       > /tmp/support-webkit.log
node /tmp/opfs-probe.mjs chromium firefox webkit     # OPFS op-by-op, module worker
node /tmp/opfs-probe2.mjs                            # webkit ephemeral vs launchPersistentContext vs headed
node /tmp/coi-probe.mjs                              # COEP require-corp / credentialless × 3 engines × 127.0.0.1|localhost
node /tmp/wk-persistent-replica.mjs                  # replica-storage spec body, webkit persistent profile, live 5411 host
node /tmp/wk-persistent-opfs-reload.mjs webkit       # opfs-reload spec body, webkit persistent profile
```

The temp config used for the three engine projects was deleted afterwards. It extended `playwright.no-coi.config` with `projects: [chromium|Desktop Chrome, firefox|Desktop Firefox, webkit|Desktop Safari]`, `workers: 1`, `retries: 0`, and reporters `list` + `json → /tmp/no-coi-$RIFTY_ENGINE.json`:

```ts
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.no-coi.config';
const engine = process.env.RIFTY_ENGINE ?? 'chromium';
export default defineConfig({
  ...base,
  reporter: [['list'], ['json', { outputFile: `/tmp/no-coi-${engine}.json` }]],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

## What this proves / what it doesn't

**Proves:** on this machine, at this SHA, the non-COI lane is fully green on Chromium 148 and on Firefox 150; the one Firefox red is a Chrome-version assertion, not behavior. WebKit 26.4 implements every capability the non-COI tier requires, and the two OPFS hazards the brief flagged do not reproduce there. The lane as written cannot run on WebKit, because Playwright's ephemeral WebKit context serves no OPFS root.

**Doesn't prove:**
- WebKit's behavior for the other 57 specs/tests (unobserved, not failing)
- WebKit's OPFS contention error name vs `NoModificationAllowedError`
- anything about real Safari (a persisted profile, quota pressure, private browsing) or about engines other than these three builds
- anything about the COI lane

## Open questions

1. Can the no-COI lane be made runnable on WebKit at all under Playwright? `launchPersistentContext` works, but Playwright Test has no per-project switch for it. It would need a `context`/`page` fixture override, which every `tests/no-coi` spec would have to import. The cheapest partial is the two standalone probes in §W-A.
2. `no-coi-agent-sdk.spec.ts:8` and `no-coi-sandbox-build-loop.spec.ts:2698` **hang** rather than throwing when the OPFS root rejects, while the other 55 fail loudly with the same `UnknownError`. It is worth knowing whether a rejecting OPFS root can wedge a native flush on Chromium too (Fidelity: gaps should be loud throws, not hangs). *Answered by P2 below: no product hang on Chromium or WebKit.*
3. `no-coi-memory-descriptor.spec.ts:136` pins `browser.version()` to `148.0.7778.96`, so it will also go red on the next Chromium bump in `@playwright/test`, not just on other engines.
4. WebKit's lack of `COEP: credentialless` support means the current playground header choice makes COI unreachable on WebKit; `require-corp` works there. This is a COI lane question, recorded only.

## Probes 2026-09-27 (main, Chromium)

**Setup**
- HEAD `4f94a0584770869cadd8b4f3a692ef7e1c852744`, Playwright `1.60.0`, chromium `148.0.7778.96` headless. The cross-checks also ran on webkit `26.4`.
- Live no-COI Vite (`cd apps/playground && RIFTY_NO_COI_PORT=5411 pnpm dev:no-coi`) sits behind a disposable node proxy host on `:5440` (Appendix A) that also serves wrapper workers.

**Realm injection** uses the repo's own technique (`tests/no-coi/fixtures/no-coi-unavailable-storage-worker.ts`): the wrapper patches the realm, then runs `await import('/@fs<repo>/packages/workbench/src/workers/no-coi-toolchain-worker.ts')`. Every rifty module therefore evaluates after the patch, and the sandbox gets `toolchain.workerUrl = /__probe/<variant>/toolchain-worker.js`. For `checkSandboxSupport` the same prelude is prepended to `support-worker.js`, which is what `tests/browser-unit/fixtures/sandbox-support-host.ts` does for its fault variants.

The realm shape was verified by a shape worker per variant:

| variant | prelude | `createSyncAccessHandle` | `createWritable` | `FileSystemWritableFileStream` | `getDirectory()` |
| --- | --- | --- | --- | --- | --- |
| control | — | function | function | function | ok |
| p1 (Safari 15.2–25 shape) | `delete FileSystemFileHandle.prototype.createWritable; delete globalThis.FileSystemWritableFileStream;` | function | **undefined** | **undefined** | ok |
| p2 (WebKit-ephemeral shape) | `StorageManager.prototype.getDirectory = () => Promise.reject(new DOMException('The operation failed for an unknown transient reason (e.g. out of memory).', 'UnknownError'))` | function | function | function | **UnknownError** |

`p2 +window` applies the same prelude to the page realm too, via `page.addInitScript`.

### P1: sync handles present, no `createWritable`

Commands: `node probe.mjs p1`, `node probe.mjs p1cap p1support`. The control ran the identical flow with an empty prelude: every step resolved, backend `opfs`, `persistence: 'flushed'`, and `/saved.txt` survived the reopen.

**(a) Backend: `opfs` in every boot.** This covers `{persistence:'required', namespace:'p1'}`, its reopen, `{persistence:'preferred', namespace}` and the default (no `storage`). All four boots resolved in 67–73 ms, the same as control. The static read is confirmed: `OpfsFsSync.isSupported()` (`packages/vfs/src/opfs-sync.ts:135-146`) checks only `createSyncAccessHandle`, so `detectVfsBackend()` (`packages/vfs/src/boot.ts`) picks `opfs`, and `preferred` never falls back to memory.

**(b) The caller first sees the error at the first write, not at boot.** `fs.writeFile('/saved.txt','A')` rejects after **2 ms**:

```
constructor Error, name "SandboxPersistenceError"
message "OPFS persistence failed (1 unhealed): /saved.txt: file.createWritable is not a function"
(no code, no feature, no cause)
```

- The same error arrives from `fs.flush()` (0 ms), and from `preferred` and default boots (`/p.txt`, `/d.txt`).
- The in-memory mirror keeps the bytes: `readFile('/saved.txt')` → `"A"` even though the write rejected.
- `project.run('echo applied > held.txt').completion` **resolves** `{status:'failed', effects:{applied:'unknown', persistence:'failed'}, error:{name:'SandboxPersistenceError', message:'OPFS persistence failed (2 unhealed): …'}}` in 47 ms. The control gave `status:'exited'` with `persistence:'flushed'`. Both runs carry the same irrelevant `echo` redirect ENOENT, because `/proj` did not exist.

Path: `writeNative` → `file.createWritable()` (`packages/vfs/src/opfs-replica-store.ts:87,93`) throws a TypeError. `recordPersistFailure` (`packages/vfs/src/opfs-sync.ts:590-611`) stores the raw `err.message`, and `checkedRuntimeFsFlush` (`packages/runtime-js/src/worker-fs-rpc.ts:157-165`) wraps it.

The static expectation is **partially refuted**:
- Confirmed: the class name is `SandboxPersistenceError`.
- Refuted: nothing passes through `mapOpfsError`. There is no `EIO`, no `VfsError` and no `code`; the text is the raw engine TypeError.

**(c) The unhealed set grows and never self-heals; the data is lost at reopen.**
- Within one session the set grows: `writeFile /second.txt` → `(2 unhealed): /saved.txt: …; /second.txt: …`. Every later `writeFile`, `flush` and `run` reports the whole set.
- Reopen (`dispose` → `createSandbox` with the same namespace, `required`) boots `opfs` in 73 ms.
  - `readFile('/saved.txt')` → `VfsError ENOENT: /saved.txt` (code `ENOENT`). The bytes never reached native storage, and nothing signals the loss at reopen.
  - The first `flush()` before any write → `{applied:'yes', persistence:'flushed'}`.
  - The next write starts a fresh set: `(1 unhealed): /third.txt: file.createWritable is not a function`.

**(d) No capability-named error anywhere.**
- `sandbox.capabilityReport` is byte-identical to control: `fs: working`, `npm.install: working`, `node_modules.bin: working`, and so on. Its only `NotImplementedError` rows (`child_process.execSync`, `toolchain.threaded-wasm`) are static and also present in control.
- No `NotImplementedError` appears in any error path. The logger received only `[rifty] The legacy per-file OPFS layout was not restored; old native files remain.`, in control too. That warning is a probe artifact: the probe does a default-root boot after the namespaced boots.

**`checkSandboxSupport({ probeBaseUrl, persistence: 'required' })` in the same realm shape:**

| | control | p1 |
| --- | --- | --- |
| `modes.nonCoi.conclusion` | `supported` | **`unsupported`** |
| `modes.nonCoi.unmet` | `[]` | **`["opfs"]`** |
| `modes.nonCoi.limitations` | `[]` | `[]` |
| `opfs` check | `passed` — `opfs: native operation succeeded in dedicated Worker` | **`failed` — `opfs: TypeError: file.createWritable is not a function`** (`error.name: "TypeError"`) |
| `cleanup` | passed | passed |

The support probe flags the shape (`packages/workbench/src/support/support-worker.ts:143` calls `createWritable`). `createSandbox` does not: it admits `persistence:'required'`, selects `opfs`, reports `fs: working`, and then fails every write.

### P2: OPFS root unavailable (`getDirectory()` rejects `UnknownError`)

Commands: `node probe.mjs p2loud p2agent p2build`; WebKit cross-check `PROBE_ENGINE=webkit node probe.mjs p2agent p2build`; routing check `node worker-route.mjs`. Every step was capped at 120 s, and **no step ever hit the cap.**

| flow (spec shape) | control (Chromium) | p2 worker realm (Chromium) | p2 worker+window (Chromium) | WebKit 26.4 native (control / p2) |
| --- | --- | --- | --- | --- |
| **loud**: `createSandbox({storage:{persistence:'required'}})` (and `+namespace:'p2ns'`) | resolves 91 / 85 ms, `opfs` | **rejects 81 / 71 ms**, `NotImplementedError` (see text below) | — | — |
| loud ref: `storage:{persistence:'preferred'}` / no `storage` | resolves, `opfs`, flush `flushed` | resolves 75 ms, `vfs {backend:'memory', reason:'The operation failed for an unknown transient reason (e.g. out of memory).'}`, write ok, flush `{applied:'yes', persistence:'memory'}` | — | — |
| **agent-sdk.spec.ts:8**: createSandbox → writeFile → `runtime.eval(nativeReplicaProbeSource + observeNativeReplicaWrites)` → `project.run('echo applied > held.txt').completion` | all settle; completion 59 ms `{status:'exited', effects:{applied:'yes', persistence:'flushed'}}`; **`/agent-flush-barrier` requested** | all settle; createSandbox 72 ms (`memory`); eval `{ok:true}`; completion **55 ms** `{status:'exited', effects:{applied:'yes', persistence:'memory'}}`; `held.txt` = `"applied\n"`; **barrier never requested** | same, completion 54 ms, barrier never requested | same; completion 70 / 61 ms, `persistence:'memory'`, barrier never requested |
| **sandbox-build-loop.spec.ts:2698**: 2 false-flag boots → `createSandbox({serviceWorkerUrl:'/sw.js', …})` → ready → seed `package.json` (kleur 4.1.5) → `toolchain.install` → `toolchain.runBin` (network-boundary bin) | all settle; install 1168 ms, runBin 9 ms `{exitCode:0}`, marker seen | all settle; `memory`; install **776 ms** (`/npm-registry/kleur` fetched), runBin **9 ms** `{exitCode:0}`, marker seen | same, install 794 ms, runBin 8 ms | same; install 895 / 901 ms, runBin 8 / 7 ms `{exitCode:0}` |

`required` rejection text (Chromium p2, identical to the WebKit W-A 13-test group):

```
NotImplementedError: Not implemented: sandbox.toolchain.worker (toolchain Worker crashed during handshake: Uncaught UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).)
feature: "sandbox.toolchain.worker"
logger.warn: "[worker error] Uncaught UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).\n"
page: 4 × pageerror with the same message during that flow
```

Mechanism: `worker-entry.ts` rethrows for `required` (`packages/runtime-js/src/worker-entry.ts:151`) inside the top-level `boot` IIFE. The resulting unhandled rejection becomes a worker `error` event, and the host maps it through `toolchainHandshakeError` → `new NotImplementedError('sandbox.toolchain.worker', …)` (`packages/runtime-js/src/host.ts:192-194, 414`). The throw is loud, but its class names a missing implementation and a worker crash rather than unavailable storage. Contrast the absent-`createSyncAccessHandle` fixture path (`tests/no-coi/no-coi-configured-startup.spec.ts:6`), whose `required` expectation is `OPFS is unavailable`.

Routing check (`worker-route.mjs`, Appendix B): `context.route('**/npm-registry/kleur*')` intercepts a dedicated module Worker's `fetch` on all three engines:

```
chromium 148.0.7778.96: worker fetch -> status=200 body=from-route (route handler calls after worker: 1); page fetch -> status=200 body=from-route (total route calls: 2); server saw 0 registry request(s)
firefox 150.0.2: worker fetch -> status=200 body=from-route (route handler calls after worker: 1); page fetch -> status=200 body=from-route (total route calls: 2); server saw 0 registry request(s)
webkit 26.4: worker fetch -> status=200 body=from-route (route handler calls after worker: 1); page fetch -> status=200 body=from-route (total route calls: 2); server saw 0 registry request(s)
```

**Verdict on the WebKit hangs: no product defect reproduces on Chromium, and the product does not hang on WebKit either.** `createSandbox` always settles when `getDirectory` rejects: `required` rejects loudly in about 75 ms, and `preferred`/default resolve on memory with `vfs.reason` and a logger warning.

- **agent-sdk.spec.ts:8** is a **spec-side unbounded wait.** The spec's Node-side `await request` (`:54`) resolves only when the `**/agent-flush-barrier` route fires. That fetch is issued only by `observeNativeReplicaWrites` (`tests/browser-unit/fixtures/native-replica-observer.ts:55-69`), which wraps `createWritable` and fires only on a native `segment-*.bin` write. Under the memory fallback that write never happens, so the barrier is never requested (observed on Chromium p2 and on WebKit). Reclassify W-D: `timeout/flake` → `test-infra`.
- **sandbox-build-loop.spec.ts:2698**: the product flow (install + runBin) settles on Chromium with the fault and on WebKit itself. The WebKit hang therefore sits in the spec's orchestration: popup host, `context.route(..., {times:1})` holds, `await installRoute` / `await runRoute`. Plain worker-fetch routing works on WebKit, so the exact wait is **not pinned**.
  - Unverified candidate: requests that pass through the rifty Service Worker (registered by this flow's `serviceWorkerUrl:'/sw.js'`) are not routed by Playwright on WebKit.
  - Class stays `unknown (spec-side)`.

**Caveats**
- P1 emulates the Safari 15.2–25 surface by deleting the APIs on Chromium. Real Safari's sync-handle semantics (for example its contention error name) are not emulated.
- P2 `+window` patches the page realm by `addInitScript`. Real WebKit rejects in both realms, and so does the WebKit cross-check.

**Probe hygiene**
- No repo files were added or patched for the probes. The proxy and wrappers ran from `/tmp`, and the servers (`:5411`, `:5440`, `:5441`) were killed afterwards.
- The Appendix A script is the one that ran, except that its hardcoded paths were replaced by `RIFTY_REPO`/`cwd` and `os.tmpdir()`. It was re-verified with `node probe.mjs shape` after that edit.
- Appendices B–D had only their import lines parameterized; their bodies are as run.

## Appendix — probe scripts

Run them from the repo root, with each script saved *outside* the repo. A–D need network; A needs the live no-COI Vite on `:5411`.

<details><summary>A. <code>probe.mjs</code>: P1/P2 realm-injection harness (proxy :5440 → no-COI Vite :5411)</summary>

```js
// Disposable P1/P2 probe harness. Proxy host on :5440 in front of the live no-COI Vite (:5411).
// Serves wrapper workers whose realm is patched BEFORE `await import(<real worker>)`, the same
// technique as tests/no-coi/fixtures/no-coi-unavailable-storage-worker.ts.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const REPO = process.env.RIFTY_REPO ?? process.cwd(); // run from the repo root
const require = createRequire(`${REPO}/package.json`);
const { transform } = require('esbuild');
const { chromium, webkit, firefox } = require('@playwright/test');
const UP = 'http://127.0.0.1:5411';
const PORT = 5440;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOOLCHAIN = `/@fs${REPO}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const UNKNOWN_MSG = 'The operation failed for an unknown transient reason (e.g. out of memory).';

const PRELUDES = {
  control: '',
  // Safari 15.2..25 shape: sync access handles, no writable streams.
  p1: 'delete FileSystemFileHandle.prototype.createWritable;\ndelete globalThis.FileSystemWritableFileStream;',
  // WebKit ephemeral shape: OPFS root unobtainable.
  p2: `StorageManager.prototype.getDirectory = function () { return Promise.reject(new DOMException(${JSON.stringify(UNKNOWN_MSG)}, 'UnknownError')); };`,
};

const requests = [];
const t0 = Date.now();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  requests.push({ t: Date.now() - t0, method: req.method, path: path + url.search });
  try {
    if (path === '/__probe/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>probe</title><main>probe</main>');
      return;
    }
    if (path === '/agent-flush-barrier') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('released');
      return;
    }
    const m = /^\/__probe\/(\w+)\/(.+)$/.exec(path);
    if (m) {
      const [, variant, rest] = m;
      const prelude = PRELUDES[variant];
      if (prelude === undefined) throw new Error(`unknown variant ${variant}`);
      res.setHeader('content-type', 'text/javascript');
      if (rest === 'toolchain-worker.js') {
        res.end(`${prelude}\nawait import(${JSON.stringify(TOOLCHAIN)});\n`);
        return;
      }
      if (rest === 'shape-worker.js') {
        res.end(`${prelude}\nlet root; try { await navigator.storage.getDirectory(); root = 'ok'; } catch (e) { root = e.name + ': ' + e.message; }
postMessage({ createSyncAccessHandle: typeof FileSystemFileHandle.prototype.createSyncAccessHandle, createWritable: typeof FileSystemFileHandle.prototype.createWritable, FileSystemWritableFileStream: typeof globalThis.FileSystemWritableFileStream, getDirectory: root });\n`);
        return;
      }
      const asset = /^support\/(support-(?:worker|child|module|service-worker))\.js$/.exec(rest)?.[1];
      if (asset) {
        const source = await readFile(`${REPO}/packages/workbench/src/support/${asset}.ts`, 'utf8');
        const { code } = await transform(source, { loader: 'ts', target: 'es2022' });
        res.end(`${asset === 'support-worker' ? prelude : ''}\n${code}`);
        return;
      }
      throw new Error(`unknown probe asset ${rest}`);
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise((r) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => r(Buffer.concat(chunks)));
    });
    const upstream = await fetch(UP + req.url, { method: req.method, body, redirect: 'manual' });
    const headers = {};
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) headers[key] = value;
    });
    res.writeHead(upstream.status, headers);
    res.end(new Uint8Array(await upstream.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---------- in-page helpers (stringified into every flow) ----------
const HELPERS = `
const CAP = 120000;
const ser = (e) => e instanceof Error || (e && typeof e === 'object' && 'message' in e)
  ? { ctor: e?.constructor?.name, name: e.name, message: String(e.message).slice(0, 600), code: e.code, path: e.path, feature: e.feature, cause: e.cause ? { name: e.cause.name, message: String(e.cause.message).slice(0, 300) } : undefined }
  : { value: String(e) };
const steps = [];
async function timed(label, fn, cap = CAP) {
  const start = performance.now();
  let timer;
  const hang = new Promise((r) => { timer = setTimeout(() => r({ __hang: true }), cap); });
  try {
    const value = await Promise.race([Promise.resolve().then(fn), hang]);
    const ms = Math.round(performance.now() - start);
    if (value && value.__hang) { steps.push({ label, state: 'HANG(>' + cap + 'ms)' }); return { hang: true }; }
    steps.push({ label, state: 'resolved', ms, value: summarize(value) });
    return { value };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    steps.push({ label, state: 'rejected', ms, error: ser(e) });
    return { error: e };
  } finally { clearTimeout(timer); }
}
function summarize(v) {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? '[fn]' : x))); } catch { return String(v); }
}
const runtimeLog = [];
function tapRuntime(sb, tag) {
  try { sb.runtime.on((ev) => { if (ev && (ev.type === 'stderr' || ev.type === 'exit' || ev.type === 'error')) runtimeLog.push({ tag, t: Math.round(performance.now()), ...summarize(ev) }); }); } catch (e) { runtimeLog.push({ tag, tapError: ser(e) }); }
}
const loggerLog = [];
const logger = { warn: (...a) => loggerLog.push({ level: 'warn', args: a.map((x) => (x instanceof Error ? ser(x) : String(x))) }), error: (...a) => loggerLog.push({ level: 'error', args: a.map((x) => (x instanceof Error ? ser(x) : String(x))) }) };
async function waitReady(sb) {
  if (sb.runtime.isReady()) return 'ready';
  return new Promise((resolve) => { const off = sb.runtime.on(() => { if (sb.runtime.isReady()) { off(); resolve('ready'); } }); });
}
`;

async function runFlow(browser, name, variant, body, { windowPatch = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const workers = [];
  const consoleLog = [];
  const tStart = Date.now();
  page.on('worker', (w) => {
    const rec = { url: w.url().replace(REPO, '<repo>'), created: Date.now() - tStart };
    workers.push(rec);
    w.on('close', () => { rec.closed = Date.now() - tStart; });
  });
  page.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text().slice(0, 400)}`));
  page.on('pageerror', (e) => consoleLog.push(`pageerror: ${e.message.slice(0, 400)}`));
  if (windowPatch) await page.addInitScript(PRELUDES[variant]);
  const reqStart = requests.length;
  await page.goto(`${ORIGIN}/__probe/page`);
  let result;
  try {
    result = await page.evaluate(
      new Function('args', `return (async ({ root, variant, UNKNOWN_MSG }) => {\n${HELPERS}\n${body}\nreturn { steps, runtimeLog, loggerLog, extra: typeof extra === 'undefined' ? undefined : extra };\n})(args);`),
      { root: REPO, variant, UNKNOWN_MSG },
    );
  } catch (e) {
    result = { evaluateError: String(e.message).slice(0, 800) };
  }
  const netPaths = requests.slice(reqStart).map((r) => r.path)
    .filter((p) => /npm-registry|agent-flush-barrier|toolchain-run-boundary|__probe\/\w+\/(toolchain|support)/.test(p));
  await context.close();
  return { name, variant, windowPatch, wallMs: Date.now() - tStart, ...result, workers, console: consoleLog.filter((l) => !l.includes('[vite]')).slice(0, 40), net: netPaths };
}

// ---------- flows ----------
const SHAPE = `
const extra = await new Promise((resolve, reject) => {
  const w = new Worker('/__probe/' + variant + '/shape-worker.js', { type: 'module' });
  w.onmessage = (e) => { resolve(e.data); w.terminate(); };
  w.onerror = (e) => reject(new Error('shape worker error ' + e.message));
});
`;

const P1_PERSIST = `
const { createSandbox } = await import('/@fs' + root + '/packages/rifty/src/index.ts');
const workerUrl = '/__probe/' + variant + '/toolchain-worker.js';
const boot = (storage) => createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true, logger, ...(storage ? { storage } : {}), startupTimeoutMs: 30000, toolchain: { workerUrl } });
const extra = {};
// required + namespace
let r = await timed('boot#1 required ns=p1', () => boot({ persistence: 'required', namespace: 'p1' }));
let sb = r.value;
if (sb) {
  tapRuntime(sb, 'boot#1');
  extra.vfs1 = summarize(sb.vfs);
  await timed('writeFile /saved.txt', () => sb.fs.writeFile('/saved.txt', 'A'));
  await timed('readFile /saved.txt (mirror)', () => sb.fs.readFile('/saved.txt', 'utf8'));
  await timed('fs.flush #1', () => sb.fs.flush());
  await timed('writeFile /second.txt', () => sb.fs.writeFile('/second.txt', 'B'));
  await timed('fs.flush #2', () => sb.fs.flush());
  await timed('project.run echo > held.txt', () => sb.project({ root: '/proj' }).run('echo applied > held.txt').completion);
  await timed('fs.flush #3', () => sb.fs.flush());
  await timed('dispose#1', () => sb.dispose());
}
r = await timed('boot#2 required ns=p1 (reopen)', () => boot({ persistence: 'required', namespace: 'p1' }));
sb = r.value;
if (sb) {
  tapRuntime(sb, 'boot#2');
  extra.vfs2 = summarize(sb.vfs);
  await timed('reopen readFile /saved.txt', () => sb.fs.readFile('/saved.txt', 'utf8'));
  await timed('reopen fs.flush (before any write)', () => sb.fs.flush());
  await timed('reopen writeFile /third.txt', () => sb.fs.writeFile('/third.txt', 'C'));
  await timed('reopen fs.flush', () => sb.fs.flush());
  await timed('dispose#2', () => sb.dispose());
}
// preferred, own namespace
r = await timed('boot#3 preferred ns=p1pref', () => boot({ persistence: 'preferred', namespace: 'p1pref' }));
sb = r.value;
if (sb) {
  tapRuntime(sb, 'boot#3');
  extra.vfs3 = summarize(sb.vfs);
  await timed('pref writeFile /p.txt', () => sb.fs.writeFile('/p.txt', 'P'));
  await timed('pref fs.flush', () => sb.fs.flush());
  await timed('dispose#3', () => sb.dispose());
}
// default (no storage option)
r = await timed('boot#4 default storage', () => boot(undefined));
sb = r.value;
if (sb) {
  tapRuntime(sb, 'boot#4');
  extra.vfs4 = summarize(sb.vfs);
  await timed('default writeFile /d.txt', () => sb.fs.writeFile('/d.txt', 'D'));
  await timed('default fs.flush', () => sb.fs.flush());
  await timed('dispose#4', () => sb.dispose());
}
`;

const P1_SUPPORT = `
const api = await import('/src/browser-unit/workbench-public-entry.ts');
const probeBaseUrl = location.origin + '/__probe/' + variant + '/support/';
const r = await timed('checkSandboxSupport required', () => api.checkSandboxSupport({ probeBaseUrl, persistence: 'required' }));
const rep = r.value;
const extra = rep ? { nonCoi: rep.modes.nonCoi, opfs: rep.checks.find((c) => c.id === 'opfs'), cleanup: rep.cleanup, failed: rep.checks.filter((c) => c.status !== 'passed').map((c) => ({ id: c.id, status: c.status, reason: c.reason })) } : undefined;
steps.length = 0; steps.push({ label: 'checkSandboxSupport required', state: r.value ? 'resolved' : (r.hang ? 'HANG' : 'rejected'), error: r.error ? ser(r.error) : undefined });
`;

const P1_CAP = `
const { createSandbox } = await import('/@fs' + root + '/packages/rifty/src/index.ts');
const r = await timed('boot preferred', () => createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true, logger, storage: { persistence: 'preferred', namespace: 'p1cap' }, toolchain: { workerUrl: '/__probe/' + variant + '/toolchain-worker.js' } }));
const extra = r.value ? { vfs: summarize(r.value.vfs), capabilityReport: summarize(r.value.capabilityReport) } : undefined;
if (r.value) r.value.dispose();
`;

// agent-sdk.spec.ts:8 shape (barrier answered immediately by the proxy, never held)
const P2_AGENT = `
const { createSandbox } = await import('/@fs' + root + '/packages/rifty/src/index.ts');
const m = await import('/@fs' + root + '/tests/browser-unit/fixtures/native-replica-observer.ts');
const nativeReplicaProbeSource = [m.nativeWriteBytes, m.nativeSegmentRecords, m.nativeReplicaEntries, m.observeNativeReplicaWrites].map((fn) => fn.toString()).join('\\n');
const extra = {};
const r = await timed('createSandbox (agent-sdk:8 shape)', () => createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true, logger, toolchain: { workerUrl: '/__probe/' + variant + '/toolchain-worker.js' } }));
const sb = r.value;
if (sb) {
  tapRuntime(sb, 'agent');
  extra.vfs = summarize(sb.vfs);
  await timed('fs.writeFile /mutation/seed', () => sb.fs.writeFile('/mutation/seed', 'seed'));
  const patched = await timed('runtime.eval(nativeReplicaProbeSource + observeNativeReplicaWrites)', () => sb.runtime.eval(nativeReplicaProbeSource + "\\nobserveNativeReplicaWrites(async records => { if (records.some(record => record.path === '/mutation/held.txt' && record.kind === 'file')) await fetch('/agent-flush-barrier'); });"));
  extra.patchedOk = patched.value?.ok;
  const run = sb.project({ root: '/mutation' }).run('echo applied > held.txt');
  await timed('run.completion', () => run.completion);
  await timed('readFile held.txt', () => sb.fs.readFile('/mutation/held.txt', 'utf8'));
  await timed('dispose', () => sb.dispose());
}
`;

// no-coi-sandbox-build-loop.spec.ts:2698 shape (routes never held)
const P2_BUILDLOOP = `
const sdk = await import('/@fs' + root + '/packages/rifty/src/index.ts');
const workerUrl = '/__probe/' + variant + '/toolchain-worker.js';
const extra = {};
for (const requireCrossOriginIsolation of [undefined, true]) {
  await timed('false-flag boot requireCrossOriginIsolation=' + requireCrossOriginIsolation, () => sdk.createSandbox({ ...(requireCrossOriginIsolation === undefined ? {} : { requireCrossOriginIsolation }), skipServiceWorker: true, toolchain: { workerUrl } }));
}
const r = await timed('createSandbox (createToolchainSandbox shape, serviceWorkerUrl=/sw.js)', () => sdk.createSandbox({ requireCrossOriginIsolation: false, serviceWorkerUrl: '/sw.js', logger, toolchain: { workerUrl } }));
const sb = r.value;
if (sb) {
  tapRuntime(sb, 'buildloop');
  extra.vfs = summarize(sb.vfs);
  await timed('waitForRuntimeReady', () => waitReady(sb));
  await timed('seedStalledInstall writeFile package.json', () => sb.fs.writeFile('/interactive-install/package.json', JSON.stringify({ name: 'stalled-install', private: true, dependencies: { kleur: '4.1.5' } })));
  await timed('toolchain.install kleur@4.1.5', () => sb.toolchain.install({ cwd: '/interactive-install', registryUrl: '/npm-registry' }));
  const rootDir = '/interactive-run';
  await timed('write network-boundary bin', async () => {
    await sb.fs.writeFile(rootDir + '/node_modules/.bin/network-boundary', "#!/usr/bin/env node\\nimport('../network-boundary/cli.js');\\n");
    await sb.fs.writeFile(rootDir + '/node_modules/network-boundary/package.json', JSON.stringify({ name: 'network-boundary', type: 'commonjs' }));
    await sb.fs.writeFile(rootDir + '/node_modules/network-boundary/cli.js', "fetch('/favicon.svg?toolchain-run-boundary=admitted').then((response) => response.arrayBuffer()).then(() => console.log('__RIFTY_RUN_RELEASED__')); module.exports = {};\\n");
  });
  const out = [];
  const off = sb.runtime.on((ev) => { if ((ev.type === 'stdout' || ev.type === 'stderr') && ev.chunk) out.push(ev.chunk); });
  await timed('toolchain.runBin network-boundary', () => sb.toolchain.runBin({ cwd: rootDir, binPath: rootDir + '/node_modules/.bin/network-boundary', args: [] }));
  off();
  extra.runOutputHasMarker = out.join('').includes('__RIFTY_RUN_RELEASED__');
  await timed('dispose', () => sb.dispose());
}
`;

// Loud-throw reference flows (configured-startup shape)
const P2_LOUD = `
const { createSandbox } = await import('/@fs' + root + '/packages/rifty/src/index.ts');
const workerUrl = '/__probe/' + variant + '/toolchain-worker.js';
const extra = {};
for (const storage of [{ persistence: 'required' }, { persistence: 'required', namespace: 'p2ns' }, { persistence: 'preferred' }, undefined]) {
  const label = 'boot storage=' + JSON.stringify(storage ?? null);
  const r = await timed(label, () => createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true, logger, ...(storage ? { storage } : {}), startupTimeoutMs: 30000, toolchain: { workerUrl } }));
  if (r.value) {
    extra[label] = summarize(r.value.vfs);
    await timed(label + ' → writeFile', () => r.value.fs.writeFile('/x.txt', 'x'));
    await timed(label + ' → fs.flush', () => r.value.fs.flush());
    r.value.dispose();
  }
}
`;

const which = process.argv.slice(2);
const ENGINE = process.env.PROBE_ENGINE || 'chromium';
const browser = await ({ chromium, webkit, firefox })[ENGINE].launch();
const out = { playwright: '1.60.0', browser: `${ENGINE} ${browser.version()}`, headless: true, date: new Date().toISOString(), results: [] };
const plan = {
  shape: [['shape control', 'control', SHAPE], ['shape p1', 'p1', SHAPE], ['shape p2', 'p2', SHAPE]],
  p1: [['P1 persistence control', 'control', P1_PERSIST], ['P1 persistence', 'p1', P1_PERSIST]],
  p1cap: [['P1 capabilityReport control', 'control', P1_CAP], ['P1 capabilityReport', 'p1', P1_CAP]],
  p1support: [['P1 checkSandboxSupport control', 'control', P1_SUPPORT], ['P1 checkSandboxSupport', 'p1', P1_SUPPORT]],
  p2agent: [['P2 agent-sdk:8 control', 'control', P2_AGENT], ['P2 agent-sdk:8', 'p2', P2_AGENT], ['P2 agent-sdk:8 +window', 'p2', P2_AGENT, { windowPatch: true }]],
  p2build: [['P2 build-loop:2698 control', 'control', P2_BUILDLOOP], ['P2 build-loop:2698', 'p2', P2_BUILDLOOP], ['P2 build-loop:2698 +window', 'p2', P2_BUILDLOOP, { windowPatch: true }]],
  p2loud: [['P2 loud boots control', 'control', P2_LOUD], ['P2 loud boots', 'p2', P2_LOUD]],
};
for (const key of which) {
  for (const [name, variant, body, opts] of plan[key]) {
    process.stderr.write(`[probe] ${name} ...\n`);
    const res = await runFlow(browser, name, variant, body, opts);
    out.results.push(res);
    process.stderr.write(`[probe] ${name} done in ${res.wallMs}ms\n`);
  }
}
await browser.close();
server.close();
const file = `${tmpdir()}/no-coi-probe-${ENGINE}-${which.join('-')}.json`;
await writeFile(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
```

</details>

<details><summary>B. <code>worker-route.mjs</code>: does <code>context.route</code> see dedicated-Worker fetches?</summary>

```js
import http from 'node:http';
import { createRequire } from 'node:module';
const { chromium, firefox, webkit } = createRequire(`${process.env.RIFTY_REPO ?? process.cwd()}/package.json`)('@playwright/test');

const PORT = 5441;
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url.startsWith('/worker.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`self.onmessage = async (e) => { try { const r = await fetch(e.data); postMessage('status=' + r.status + ' body=' + (await r.text())); } catch (err) { postMessage('fetch error ' + err); } };`);
    return;
  }
  if (req.url.startsWith('/npm-registry/')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('from-server');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>r</title>');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  let routed = 0;
  await context.route('**/npm-registry/kleur*', async (route) => {
    routed++;
    await route.fulfill({ status: 200, body: 'from-route' });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const serverBefore = hits.filter((h) => h.startsWith('/npm-registry/')).length;
  const fromWorker = await page.evaluate(() => new Promise((resolve) => {
    const w = new Worker('/worker.js', { type: 'module' });
    w.onmessage = (e) => resolve(e.data);
    setTimeout(() => resolve('timeout 10s'), 10000);
    w.postMessage('/npm-registry/kleur?from=worker');
  }));
  const routedAfterWorker = routed;
  const fromPage = await page.evaluate(async () => { const r = await fetch('/npm-registry/kleur?from=page'); return 'status=' + r.status + ' body=' + (await r.text()); });
  const serverAfter = hits.filter((h) => h.startsWith('/npm-registry/')).length;
  console.log(`${name} ${browser.version()}: worker fetch -> ${fromWorker} (route handler calls after worker: ${routedAfterWorker}); page fetch -> ${fromPage} (total route calls: ${routed}); server saw ${serverAfter - serverBefore} registry request(s)`);
  await browser.close();
}
server.close();
```

</details>

<details><summary>C. <code>opfs-probe2.mjs</code>: WebKit OPFS root in ephemeral vs persistent context (W-A discriminator, run 2026-09-17)</summary>

```js
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { webkit } = createRequire(`${process.env.RIFTY_REPO ?? process.cwd()}/package.json`)('@playwright/test');

const PORT = 5432;
const HTML = `<!doctype html><html><body><main id=x>probe</main></body></html>`;
const WORKER = `
self.onmessage = async () => {
  try { const r = await navigator.storage.getDirectory(); self.postMessage({ ok: true, brand: Object.prototype.toString.call(r) }); }
  catch (e) { self.postMessage({ ok: false, name: e && e.name, message: String(e && e.message) }); }
};`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/worker.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(WORKER);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(HTML);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

async function probe(label, page) {
  const win = await page.evaluate(async () => {
    const out = {};
    try {
      const r = await navigator.storage.getDirectory();
      out.window = { ok: true, brand: Object.prototype.toString.call(r) };
    } catch (e) {
      out.window = { ok: false, name: e && e.name, message: String(e && e.message) };
    }
    try { out.estimate = await navigator.storage.estimate(); } catch (e) { out.estimate = { error: String(e && e.message) }; }
    try { out.persisted = await navigator.storage.persisted(); } catch (e) { out.persisted = 'err: ' + String(e && e.message); }
    out.secureContext = isSecureContext;
    return out;
  });
  const worker = await page.evaluate(async () => {
    const w = new Worker('/worker.js', { type: 'module' });
    return await new Promise((resolve, reject) => {
      w.onmessage = (e) => resolve(e.data);
      w.onerror = (e) => reject(new Error('worker error ' + e.message));
      setTimeout(() => reject(new Error('timeout')), 15000);
      w.postMessage('go');
    });
  });
  console.log('\n--- ' + label + ' ---');
  console.log('window: ' + JSON.stringify(win));
  console.log('worker: ' + JSON.stringify(worker));
}

const b = await webkit.launch();
const p = await (await b.newContext()).newPage();
await p.goto(`http://127.0.0.1:${PORT}/`);
await probe('webkit ' + b.version() + ' ephemeral newContext', p);
await b.close();

const profile = await mkdtemp(join(tmpdir(), 'wk-profile-'));
const pctx = await webkit.launchPersistentContext(profile, {});
const pp = await pctx.newPage();
await pp.goto(`http://127.0.0.1:${PORT}/`);
await probe('webkit persistentContext ' + profile, pp);
await pctx.close();

const bh = await webkit.launch({ headless: false });
const ph = await bh.newPage();
await ph.goto(`http://127.0.0.1:${PORT}/`);
await probe('webkit headed ephemeral', ph);
await bh.close();
server.close();
```

</details>

<details><summary>D. <code>wk-persistent-opfs-reload.mjs</code>: opfs-reload canary on a persistent WebKit profile (run 2026-09-17; needs Vite :5411)</summary>

```js
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const REPO = process.env.RIFTY_REPO ?? process.cwd();
const { webkit, firefox } = createRequire(`${REPO}/package.json`)('@playwright/test');

const PORT = process.env.PORT || '5411';
const workerUrl = `/@fs${REPO}/tests/browser-unit/fixtures/opfs-no-coi-policy-worker.ts`;
const exactBytes = [0, 1, 2, 127, 128, 254, 255, 13, 10];

const runWorker = (page, request) =>
  page.evaluate(
    ({ url, request }) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('OPFS policy worker timeout')); }, 20000);
        worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
        worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage(request);
      }),
    { url: workerUrl, request },
  );

const engineName = process.argv[2] || 'webkit';
const engine = { webkit, firefox }[engineName];
const profile = await mkdtemp(join(tmpdir(), engineName + '-noco-'));
const ctx = await engine.launchPersistentContext(profile, {});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
const base = `http://127.0.0.1:${PORT}/unit-harness.html?no-coi-opfs=1`;
try {
  const r1 = await page.goto(base);
  const h1 = await r1.allHeaders();
  console.log('goto COOP=' + h1['cross-origin-opener-policy'] + ' COEP=' + h1['cross-origin-embedder-policy']);
  await page.waitForSelector('#browser-unit-harness[data-status="ready"]', { timeout: 60000 });
  console.log('facts: ' + JSON.stringify(await page.evaluate(() => ({ coi: crossOriginIsolated, sab: typeof SharedArrayBuffer }))));
  const path = `/__rifty_no_coi_opfs__/${Math.random().toString(36).slice(2)}.bin`;
  const write = await runWorker(page, { mode: 'selected', operation: 'write', path, bytes: exactBytes });
  console.log('WRITE: ' + JSON.stringify(write));
  await page.reload();
  await page.waitForSelector('#browser-unit-harness[data-status="ready"]', { timeout: 60000 });
  const read = await runWorker(page, { mode: 'selected', operation: 'read', path, bytes: exactBytes });
  console.log('READ:  ' + JSON.stringify(read));
  console.log('same worker id: ' + (write.workerId === read.workerId));
  console.log('bytes match: ' + JSON.stringify(read.actual) + ' vs ' + JSON.stringify(exactBytes));
} catch (e) {
  console.log('THREW: ' + String(e.message).split('\n').slice(0, 6).join(' | '));
}
await ctx.close();
```

</details>
