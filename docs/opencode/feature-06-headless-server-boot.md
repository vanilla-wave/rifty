# Feature 06-headless-server-boot — Programmatic headless Server.listen(opts)
> Part of the opencode-in-rifty facade effort. Feasibility phase P2/P3. Staged doc — NOT a ratified ADR.

## Summary

Fork the proven real-vite-smoke harness into an opencode headless harness that boots the server programmatically via `import { Server } from ".../server/server"` + `Server.listen(opts)` (NOT the CLI, which top-level-imports drizzle-orm/bun-sqlite and crashes at import — confirmed by de-risk findings), with mDNS disabled and ptyConnectApi neutralized, then drives a single trivial JSON route (version/status) through the port registry and asserts 200 + JSON body.

This feature is the integration-harness + test-fixture layer ONLY: it consumes (does not build) the `#db`/`node:sqlite` shim (feature 04), the conditional-import intercept (feature 03), TS-on-import (feature 02), the VFS-loaded opencode tree (feature 01), and the Effect HTTP bridge response-shape work (feature 05). Its job is to prove the ~40 default Effect layers from `createRoutes()` actually build under rifty without a native crash (resolving unknown #1 in practice, not just on paper) and that one buffered `res.end(JSON)` route returns 200 across the registry/bridge — exactly the express@4 precedent.

New facade-only config to disable mDNS and drop the pty-connect API surface must come from `Server.listen(opts)` arguments or environment, not from patching opencode source. The harness runs under tsx in a spawned child (it replaces `globalThis.process`, incompatible with vitest IPC), mirroring the vite/express opt-in drivers. The harness deliberately stops at the FIRST trivial route: session/LLM/tool flows are features 08/09 and are out of scope here so we touch zero hard-blocker surface.

## Decisions (classified)

### D-06.1 — How to disable mDNS and drop/stub ptyConnectApi at boot

- **Question:** How does the harness disable mDNS and drop/stub the ptyConnectApi when booting `Server.listen` — via `Server.listen(opts)` arguments only, by env flags opencode reads, or by editing opencode source in the VFS overlay?
- **Classification:** REVERSIBLE
- **Chosen:** Drive everything through `Server.listen(opts)` + environment that opencode already reads (loopback hostname to gate mDNS off via opencode's own `ListenOptions`; never construct a real `PtyConnectApi` consumer because we never open a pty session). Set `process.env`/`argv` on the rifty process shim BEFORE importing the server module so opencode's config reads resolve. Do NOT edit opencode source files in the VFS overlay for boot config — only the dependency-resolution shims (features 03/04) may rewrite specifiers. If opencode's `Server.listen` has no opts knob to suppress mDNS startup, fall back to letting `bonjour-service` load but assert it performs no module-scope native `dlopen` (per de-risk: mDNS is gated when hostname is loopback; the module still loads but must not crash).
- **Alternatives:**
  - (a) Patch `packages/opencode/src/server/server.ts` in the VFS overlay to delete the MDNS layer — rejected: editing application source for boot config is brittle, drifts on every opencode bump, and blurs the line between the dep-shim layer (legitimate) and behavioral patching (a maintenance trap).
  - (b) A bespoke opts object invented by us and injected — rejected: would require knowing opencode internals we cannot pin; relies on `Server.listen`'s real public signature instead.
- **Trade-offs:** opts/env-driven keeps the harness a thin consumer and survives opencode source churn, but is hostage to whatever knobs `Server.listen` actually exposes — if mDNS cannot be suppressed via opts, the harness depends on `bonjour-service` being import-safe (a separate verification, owned conceptually by feature 03's prune/keep list). The chosen path adds zero opencode-source edits, keeping reverts trivial.
- **Reversibility justification:** Lives entirely inside the new harness fixture file (a test asset). No public API between packages, no new dependency, no ADR conflict; reverting deletes one fixture. Per checklist rule 5 → REVERSIBLE.
- **Tracking:** `Q-2026-05-30-101`

### D-06.2 — Success granularity: graph-load only vs 200 JSON route

- **Question:** At what milestone granularity does the harness assert success — graph-load only (P0/P2: layers build, no crash) or all the way to a 200 JSON route (P3)?
- **Classification:** REVERSIBLE
- **Chosen:** Two staged success markers in ONE fixture, gated so a P2 pass is still informative if P3 regresses:
  1. `RIFTY_OPENCODE_LAYERS_OK` after `Server.listen(opts)` resolves and the port registers in net's registry (proving the ~40 `createRoutes` layers built without a native crash — the practical resolution of unknown #1).
  2. `RIFTY_OPENCODE_ROUTE_OK` after `dispatchToPort(port, new Request('http://preview.local/.../<trivial route>'))` returns status 200 and `JSON.parse(body)` succeeds.

  The driver test asserts both markers; if only marker (1) appears, the failure message localizes the regression to the route/bridge rather than layer-build.
- **Alternatives:**
  - (a) Single all-or-nothing P3 marker — rejected: loses the diagnostic signal that distinguishes 'layers won't build' (shim problem, features 03/04) from 'route won't round-trip' (bridge problem, feature 05).
  - (b) Separate fixtures for P2 and P3 — rejected: duplicates the entire install+overlay+loader boot (~100 lines) for marginal benefit; staged markers in one process are cheaper and keep the expensive install once.
- **Trade-offs:** Staged markers cost a few extra log lines and a slightly longer fixture but give precise regression localization across the feature boundary (04 shim vs 05 bridge vs 06 harness). Single marker would be simpler but turns every failure into a bisect.
- **Reversibility justification:** Pure choice of log strings + assertions inside the new fixture and its driver test. No cross-package API, no dep, no ADR. Two files, both new test assets. REVERSIBLE.
- **Tracking:** `Q-2026-05-30-102`

### D-06.3 — Which trivial route, and how addressed into the port registry

- **Question:** Which trivial route does the harness hit for the P3 200-JSON assertion, and how is the URL addressed into the port registry?
- **Classification:** REVERSIBLE
- **Chosen:** Hit whichever GET route opencode's `createRoutes` exposes that touches NO storage layer — provisionally a version/health/app-info endpoint (the de-risk note explicitly names 'version/status' as the no-storage-touching first-light target). Address it via the in-process registry exactly as the existing tests do: build the handler-shape-agnostic `Request` and call `dispatchToPort(port, request)` from `net/src/registry.ts:40` (NOT a real network fetch), since the harness runs in a single tsx process with no SW. The exact route path is read from opencode's actual route table at harness-write time and pinned with a `TODO(ADR)` noting it must avoid Storage to stay at P3.
- **Alternatives:**
  - (a) Hit a session/project route — rejected: those instantiate Storage and would trip the lazy DB connection, pulling P4 (WASM-SQLite, feature 08) into scope and breaching this feature's P3 ceiling.
  - (b) Go through `serveCrossRealmPreview`/SW bridge — rejected: no SW in a tsx child; `dispatchToPort` is the documented in-process equivalent and is what vite/express harnesses use.
- **Trade-offs:** `dispatchToPort` exercises the registry + `IncomingMessage`/`ServerResponse` shapes (the parts feature 05 hardens) without needing a browser SW — high fidelity for the cheap path, but does NOT exercise the cross-realm `MessageChannel` framing (that is feature 07's concern, explicitly a separate WS/SSE/bridge item). Picking a no-storage route keeps us strictly below the WASM-SQLite blocker for P4.
- **Reversibility justification:** Route selection + in-process dispatch live in the fixture; swapping routes is a one-line change. No cross-package API, no dep, no ADR. REVERSIBLE.
- **Tracking:** `Q-2026-05-30-103`

### D-06.4 — Incidental boot shims: harness-local vs new runtime-js public API

- **Question:** Any incidental runtime shims the harness needs at boot (`Heap.start`, `process.env`/`argv` population, `node:os.hostname` returning a loopback name, a minimal yargs/global surface) — are these harness-local or do they require new runtime-js public API?
- **Classification:** IRREVERSIBLE
- **Chosen:** **RECOMMENDED — awaiting ratification.** Keep ALL incidental boot shims harness-local — populate `globalThis.process.env`/`argv` on the existing rifty process shim (`installProcessGlobals` from runtime-js builtins/process, already used by real-vite-smoke), and if opencode reads `node:os.hostname()` to decide mDNS, set the env/opts so it resolves to a loopback value WITHOUT adding a new os builtin method. Only if a required boot path calls a runtime-js builtin method that does not yet exist (e.g. `os.hostname()` unimplemented, or a `Heap`/global the Effect runtime touches) does this become a runtime-js public-API change — which is IRREVERSIBLE and must be ratified, not invented. Surface the exact missing method(s) discovered during harness bring-up as the ADR's concrete options.

> **⚠️ WARNING — IRREVERSIBLE / NEEDS RATIFICATION:** Adding a method to a runtime-js builtin widens public API consumed across packages (checklist rule 1). This decision is RECOMMENDED only and is BLOCKED until the ADR is ratified with the concrete missing method(s) and their Node-parity semantics. Do NOT pre-add API and do NOT monkeypatch from the harness.

- **Alternatives:**
  - (a) Add `os.hostname()`/`networkInterfaces()` etc. to runtime-js builtins now, pre-emptively — rejected as speculative: do not widen public API before a real boot path demands it.
  - (b) Monkeypatch the missing methods from inside the harness onto the global/builtin object — rejected: that mutates shared runtime-js builtin state from a test, a silent-stub-by-the-back-door that violates the no-silent-stubs rule and hides the real gap.
  - (c) Throw `NotImplementedError` from the unimplemented builtin (current rifty convention) and let the harness fail loudly until the method is properly added via ADR — this is the honest fallback if a gap is found.
- **Trade-offs:** Harness-local env/argv population is free and reversible. But the moment opencode's boot exercises an unimplemented runtime-js builtin method, fixing it touches runtime-js's public builtin surface (rule 1: cross-package public API) — that is a genuine IRREVERSIBLE decision (which methods, with what semantics, matching Node parity) and must not be guessed. The recommended path is 'discover the gap, stop, ratify' rather than 'pre-add API'.
- **Reversibility justification:** Adding a method to a runtime-js builtin is touching public API consumed across packages (checklist rule 1 → IRREVERSIBLE). The env/argv population alone is reversible, but the rule requires marking the decision by its irreversible component; the ADR captures only the API-widening part.
- **Proposed ADR title:** *ADR: runtime-js builtin surface additions required to boot the opencode Effect runtime headlessly (os.hostname and any Effect-runtime globals)*

## Interface contract

No new exported package API. This feature adds two test assets only:

```ts
// tests/integration/fixtures/real-opencode-smoke.ts  (forked from real-vite-smoke.ts)
//   standalone tsx script. Reads RIFTY_LIVE_REGISTRY (skip if unset).
//   1. createMemoryFs + setSyncMirror; installProcessGlobals/installTimerGlobals; set process.env/argv before import.
//   2. install opencode tree from live registry into the VFS (feature 01 supplies the install + prune/keep set).
//   3. overlay dependency shims: #db/node:sqlite (feature 04), conditional-import intercept (feature 03), esbuild TS-on-import overlay (feature 02).
//   4. const loader = createModuleLoader(fsSync, { cwd: ROOT });  __setCreateRequireImpl(...) as in vite harness.
//   5. const { Server } = await loader.import('<opencode>/server/server', `${ROOT}/__entry__.mjs`);
//   6. await Server.listen(opts) with mDNS-off / loopback opts;  -> prints RIFTY_OPENCODE_LAYERS_OK once port registers.
//   7. const port = listPorts()[0];  const res = await dispatchToPort(port, new Request('http://preview.local/<trivial-route>'));
//      assert res.status === 200 && JSON.parse(await res.text());  -> prints RIFTY_OPENCODE_ROUTE_OK; realExit(0).

// tests/integration/opencode-headless.opt-in.test.ts  (forked from vite-live-run.opt-in.test.ts)
//   describe.skipIf(!RIFTY_LIVE_REGISTRY): spawn('npx',['tsx', smoke]); assert out contains both markers; code === 0.
```

Consumed (not defined) seams: `createModuleLoader` (runtime-js/module-loader/index.ts), `registerPort`/`dispatchToPort`/`listPorts` (net/src/registry.ts), `createServer`/`HttpServer.listen` (net/src/http/server.ts), `ServerResponse.end` (net/src/http/response.ts), register-builtins side-effect (net/src/register-builtins.ts). The opts shape for `Server.listen` is opencode's, pinned in the fixture against the real source.

## Affected packages & seams

**Affected packages:**
- `tests/integration` (fixtures + opt-in driver)

**Seam anchors (consumed, not modified):**
- `tests/integration/fixtures/real-vite-smoke.ts:107`
- `tests/integration/fixtures/real-vite-smoke.ts:120`
- `tests/integration/fixtures/real-vite-smoke.ts:131`
- `tests/integration/vite-live-run.opt-in.test.ts:26`
- `packages/net/src/http/server.ts:27`
- `packages/net/src/http/server.ts:32`
- `packages/net/src/registry.ts:22`
- `packages/net/src/registry.ts:40`
- `packages/net/src/registry.ts:36`
- `packages/net/src/http/response.ts:185`
- `packages/net/src/register-builtins.ts:15`
- `packages/runtime-js/src/module-loader/resolver.ts:235`
- `packages/runtime-js/src/module-loader/index.ts:10`

## Dependencies

**Depends on:**
- `01-load-opencode-into-vfs`
- `02-ts-on-import-graph`
- `03-conditional-imports-and-bun-sqlite-intercept`
- `04-db-and-pty-shims`
- `05-effect-http-bridge`

**Blocker proximity:** Closest to THREE hard blockers and stays on the feasible side of each by construction:

1. **Native SQLite** — the `createRoutes` graph statically pulls `session.ts` -> `storage/db.ts` -> `#db` -> `node:sqlite` (de-risk confirmed). This harness does NOT solve that; it CONSUMES feature 04's shim and proves the layers build with it. It picks a no-storage-touching trivial route (Q-103) so the lazy DB connection (`init()`) never fires at P3 — staying below the WASM-SQLite-required line (that line is P4/feature 08).
2. **PTY** — `#pty` is lazy (import only inside `create()`), so the harness boots `Server.listen` without ever opening a pty session; the `ptyConnectApi` is dropped/stubbed and we never call it, so no native `dlopen`.
3. **Process spawn / tools** — the harness deliberately HALTS at one GET route; it issues zero session-create, zero LLM, zero tool calls, so `Git.run`/`ChildProcess`/ripgrep are never reached.

The single deliberate proximity-to-edge is the IRREVERSIBLE runtime-js builtin gap (`os.hostname` / Effect-runtime globals): if boot trips an unimplemented builtin, the honest move per rifty rules is loud `NotImplementedError` + ADR ratification, NOT a back-door monkeypatch — that is the one place this feature could brush a blocker, and it is fenced behind `needsHumanRatification`.

## Test strategy

Integration (live, opt-in, spawned-tsx) is the right and only level here — this is itself a test harness, not production code, so the deliverable IS the test.

Levels:
- **Integration/live** — the spawned `real-opencode-smoke.ts` asserting the two staged markers (`RIFTY_OPENCODE_LAYERS_OK`, `RIFTY_OPENCODE_ROUTE_OK`), gated by `describe.skipIf(!RIFTY_LIVE_REGISTRY)` and run sandbox-disabled (network for live npm). This mirrors the established vite/express opt-in pattern exactly.

Parity is NOT applicable here: there is no Node-vs-rifty stdout diff to make — the contract being proven is 'opencode's own Effect layers build and one route returns 200 under rifty', which has no Node baseline equivalent (Node would just run it natively). The Node-compatible sub-behaviors that DO have parity value — the `IncomingMessage` pull-stream contract and the buffered `ServerResponse.end(body)` path — are owned and parity-tested by feature 05 (the Effect HTTP bridge), and this harness merely exercises them end-to-end.

CI stays fast because the test is skipped by default (no network/spawn in normal runs).

## Implementation plan (test-first)

1. **T1 — Create the driver test FIRST (it must fail because the fixture file does not exist yet).** Fork `tests/integration/vite-live-run.opt-in.test.ts` into a new opt-in driver that spawns `npx tsx` on the (not-yet-existing) `real-opencode-smoke.ts` fixture, gated by `describe.skipIf(!RIFTY_LIVE_REGISTRY)`. It asserts both staged markers (`RIFTY_OPENCODE_LAYERS_OK` and `RIFTY_OPENCODE_ROUTE_OK`) and exit code 0. Writing this first locks the contract before any fixture code exists. Because the smoke replaces `globalThis.process` (incompatible with vitest IPC), spawn-tsx is the only viable level — same justification as the vite driver.
   - **FAILING test to write first:** `tests/integration/opencode-headless.opt-in.test.ts :: it('boots opencode Server.listen headlessly + 200 JSON on a no-storage route')` — initial assertion: spawn of fixture returns code 0 AND out contains both `'RIFTY_OPENCODE_LAYERS_OK'` and `'RIFTY_OPENCODE_ROUTE_OK'`. It FAILS first because `tests/integration/fixtures/real-opencode-smoke.ts` is absent (spawn exits non-zero / module-not-found).
   - **Files:** `tests/integration/opencode-headless.opt-in.test.ts`
   - **Test kind:** integration

2. **T2 — Create the smoke fixture skeleton (steps 1-4 only):** memory VFS + `setSyncMirror`, `installProcessGlobals`/`installTimerGlobals`, set `process.env`/`argv` BEFORE any opencode import, install the opencode tree from `RIFTY_LIVE_REGISTRY` (consuming feature 01's install + prune/keep set), overlay the dep shims (`#db`/`node:sqlite` from feature 04, conditional-import intercept from feature 03, esbuild TS-on-import overlay from feature 02), then `createModuleLoader(fsSync,{cwd:ROOT})` and `__setCreateRequireImpl` exactly as the vite harness. This stage prints nothing past install; the driver test from T1 still fails (no markers yet) — which is the correct red state for this incremental task.
   - **FAILING test to write first:** REUSES T1's failing assertion. After T2, the fixture exists and installs/loads the tree but emits NEITHER marker, so the T1 driver still fails on the missing `'RIFTY_OPENCODE_LAYERS_OK'` substring — proving the install/overlay/loader plumbing runs without yet booting the server.
   - **Files:** `tests/integration/fixtures/real-opencode-smoke.ts`
   - **Test kind:** harness

3. **T3 — Wire steps 5-6:** `loader.import('<opencode>/server/server')` and `await Server.listen(opts)` with mDNS-off / loopback opts driven via `Server.listen(opts)` + env ONLY (per Q-2026-05-30-101 — NO opencode-source edits for boot config). After listen resolves and the port appears in net's registry, print `RIFTY_OPENCODE_LAYERS_OK` (staged marker 1 per Q-2026-05-30-102: proves the ~40 `createRoutes` Effect layers built with no native crash — the practical resolution of unknown #1). The exact opts shape is pinned against the real opencode server source at harness-write time. If boot trips an unimplemented runtime-js builtin (`os.hostname` / Effect-runtime global), it must surface as a loud `NotImplementedError` — STOP and ratify (see ratification gate), do NOT monkeypatch.
   - **FAILING test to write first:** REUSES T1's driver. After T3 the fixture should emit `'RIFTY_OPENCODE_LAYERS_OK'` but NOT yet `'RIFTY_OPENCODE_ROUTE_OK'`, so the T1 assertion still fails on the second marker — localizing that layer-build works while the route round-trip is not yet wired. (Per design Q-102, the staged markers exist precisely to give this regression-localization signal.)
   - **Files:** `tests/integration/fixtures/real-opencode-smoke.ts`
   - **Test kind:** harness

4. **T4 — Wire step 7 (the P3 first-light):** read the port from `listPorts()[0]`, build a handler-shape-agnostic `Request` for a NO-STORAGE GET route (provisionally version/status per Q-2026-05-30-103, pinned from opencode's real route table with a `TODO(ADR)` noting it MUST avoid Storage to stay below the WASM-SQLite/P4 line), call `dispatchToPort(port, request)` (in-process registry — NOT a network fetch, no SW in a tsx child), assert `res.status===200` and `JSON.parse(await res.text())` succeeds, then print `RIFTY_OPENCODE_ROUTE_OK` and `realExit(0)`. This turns the T1 driver GREEN (both markers + code 0). This exercises the `IncomingMessage` pull-stream + buffered `ServerResponse.end(body)` contract owned/parity-tested by feature 05; this harness only drives it end-to-end (no separate parity case here — see risks).
   - **FAILING test to write first:** REUSES T1's driver, now expected to PASS: out contains both `'RIFTY_OPENCODE_LAYERS_OK'` and `'RIFTY_OPENCODE_ROUTE_OK'` and code===0. Before T4's dispatch code is added, the second-marker assertion fails (red); after, it passes (green) — standard red→green on the same locked test.
   - **Files:** `tests/integration/fixtures/real-opencode-smoke.ts`, `tests/integration/opencode-headless.opt-in.test.ts`
   - **Test kind:** integration

5. **T5 — Documentation/DoD wiring only (no new test):** add an `OPEN_QUESTIONS.md` entry for each REVERSIBLE provisional choice (Q-2026-05-30-101 mDNS/pty-via-opts, Q-2026-05-30-102 staged markers, Q-2026-05-30-103 trivial-route selection), add `TODO(ADR)` markers in the fixture at the route-selection and opts-shape sites, and update the `tests/integration` CHANGELOG. Record in docs/compat that the opencode-headless P3 path is exercised opt-in (and that P4 session/LLM/tools remain out of scope / not-supported). No behavioral code, so no new failing test — this is the documentation half of Definition of Done.
   - **FAILING test to write first:** NONE (docs/DoD-only task). The behavioral contract is already fully covered by the T1 driver going green in T4; per CLAUDE.md a doc/changelog/OPEN_QUESTIONS task does not require its own failing test.
   - **Files:** `OPEN_QUESTIONS.md`, `tests/integration/CHANGELOG.md`, `docs/compat/integration.md`, `tests/integration/fixtures/real-opencode-smoke.ts`
   - **Test kind:** harness

### Scaffolding sketch

```ts
// tests/integration/fixtures/real-opencode-smoke.ts  (forked from real-vite-smoke.ts; standalone tsx script, NOT vitest)
import '../../../packages/net/src/register-builtins.ts'; // side-effect: registers node:http -> createServer/listen over the port registry
import { RegistryClient, install } from '../../../packages/npm-client/src/index.ts';
import { Buffer as RiftyBuffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';
import { __setCreateRequireImpl } from '../../../packages/runtime-js/src/builtins/module.ts';
import { installProcessGlobals, setProcessCwd } from '../../../packages/runtime-js/src/builtins/process.ts';
import { installTimerGlobals } from '../../../packages/runtime-js/src/builtins/timers.ts';
import { createModuleLoader } from '../../../packages/runtime-js/src/module-loader/index.ts';
import { dispatchToPort, listPorts } from '../../../packages/net/src/index.ts'; // registry primitives (public surface)
import { createMemoryFs, setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';
// + feature 02/03/04 overlay shim sources (TS-on-import overlay, conditional-import intercept files, #db/node:sqlite shim files)

const ROOT = '/workspace';
const log = (m: string): void => { process.stdout.write(`[opencode-smoke] ${m}\n`); };
const realExit = process.exit.bind(process);
const realEnv = { ...process.env };

// opts shape is opencode's own ListenOptions, pinned against real source at write-time. TODO(ADR Q-2026-05-30-101)
interface OpencodeListenOpts { hostname: string; port: number; /* loopback gates mDNS off in opencode's own logic */ }

async function main(): Promise<void> {
  if (!realEnv.RIFTY_LIVE_REGISTRY) { log('RIFTY_LIVE_REGISTRY not set — skipping'); realExit(0); return; }
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  installProcessGlobals(); installTimerGlobals();
  (globalThis as any).Buffer = RiftyBuffer;
  // set env/argv BEFORE importing the server module so opencode config reads resolve (Q-2026-05-30-101)
  (globalThis as any).process.env = { ...realEnv, /* mDNS-off / loopback knobs opencode reads */ };
  setProcessCwd(ROOT);

  // 2. install opencode tree (feature 01 supplies prune/keep set + install opts)
  const registry = new RegistryClient({ baseUrl: realEnv.RIFTY_LIVE_REGISTRY, fetch: globalThis.fetch });
  await install(/* opencode name/version/deps per feature 01 */);

  // 3. overlay dep shims: #db/node:sqlite (f04), conditional-import intercept (f03), esbuild TS-on-import (f02)
  //    (write each shim file into fsSync, mirroring the esbuild/rollup overlay loop in real-vite-smoke)

  // 4. loader + createRequire bridge (verbatim shape from vite harness)
  const loader = createModuleLoader(fsSync, { cwd: ROOT });
  __setCreateRequireImpl((from: string) => { /* same as vite harness */ return req; });

  // 5-6. boot the server programmatically (NOT the CLI — CLI top-level-imports drizzle-orm/bun-sqlite)
  const { Server } = (await loader.import('<opencode>/server/server', `${ROOT}/__entry__.mjs`)) as any;
  const opts: OpencodeListenOpts = { hostname: '127.0.0.1', port: 4096 };
  await Server.listen(opts);
  if (listPorts().length === 0) { log('FAIL: no port registered after Server.listen'); realExit(2); return; }
  log('RIFTY_OPENCODE_LAYERS_OK'); // staged marker 1 (Q-2026-05-30-102): ~40 createRoutes layers built, no native crash

  // 7. P3 first light — in-process dispatch, no SW, NO-STORAGE route (Q-2026-05-30-103, TODO(ADR))
  const port = listPorts()[0];
  const res = await dispatchToPort(port, new Request('http://preview.local/<trivial-no-storage-route>'));
  const body = await res.text();
  if (res.status !== 200) { log(`FAIL: status ${res.status}`); realExit(4); return; }
  JSON.parse(body); // throws -> caught by main().catch -> nonzero exit
  log('RIFTY_OPENCODE_ROUTE_OK'); // staged marker 2
  realExit(0);
}
main().catch((e) => { log(`UNCAUGHT: ${(e as Error)?.stack ?? e}`); realExit(3); });

// tests/integration/opencode-headless.opt-in.test.ts  (forked from vite-live-run.opt-in.test.ts)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;
const smoke = fileURLToPath(new URL('./fixtures/real-opencode-smoke.ts', import.meta.url));
describe.skipIf(!liveRegistryUrl)('integration (opt-in) — boot real opencode headlessly', () => {
  it('boots Server.listen + 200 JSON on a no-storage route', async () => {
    const { code, out } = await spawnTsx(smoke, liveRegistryUrl); // spawn('npx',['tsx',smoke]); collect stdout+stderr
    if (code !== 0) throw new Error(`real-opencode-smoke exited ${code}:\n${out}`);
    expect(out).toContain('RIFTY_OPENCODE_LAYERS_OK');
    expect(out).toContain('RIFTY_OPENCODE_ROUTE_OK');
  }, 300_000);
});
```

### Risks

- **HARD DEPENDENCY ORDER:** this feature is the consumer of features 01-05. It cannot reach `RIFTY_OPENCODE_LAYERS_OK` until 01 (VFS tree+prune), 02 (TS-on-import across the graph), 03 (conditional `#import` + `bun:sqlite` intercept), and 04 (`#db`/`node:sqlite` WASM-or-stub shim) all land, and cannot reach `RIFTY_OPENCODE_ROUTE_OK` until 05 (Effect `IncomingMessage`/`ServerResponse` bridge) lands. Sequence T1-T2 can be written now; T3-T4 will stay red until upstream features merge. Do NOT mask this by relaxing the markers.
- **UNKNOWN #1 IS RESOLVED HERE IN PRACTICE:** if `HttpApiApp.createRoutes(opts)` STATICALLY imports the storage/Database layer, `Server.listen` trips `bun:sqlite` at layer-build time and `RIFTY_OPENCODE_LAYERS_OK` is unreachable without feature 04's shim being import-time-safe (not just lazy). If layer-build still crashes after 04, the failure is in 03/04 (shim), not this harness — the staged-marker design is what makes that attribution possible.
- **IRREVERSIBLE GAP RISK (the one place this feature can brush a blocker):** opencode's Effect boot may call an unimplemented runtime-js builtin (`os.hostname`, `networkInterfaces`, or an Effect-runtime global). Per Q-2026-05-30-104 / design decision, the honest move is loud `NotImplementedError` + ADR ratification of the exact runtime-js public-API additions — NOT a harness-local monkeypatch (which would violate no-silent-stubs and mutate shared builtin state from a test). This is the ratification gate below.
- **`Server.listen` opts knob for mDNS may not exist:** if opencode exposes no opts/env to suppress mDNS startup, the harness depends on `bonjour-service` being import-SAFE (no module-scope native `dlopen`). That import-safety is conceptually owned by feature 03's prune/keep list, not this harness; if `bonjour-service` crashes at import, escalate to 03, do not patch opencode source (Q-2026-05-30-101 forbids boot-config source edits).
- **Route selection (Q-2026-05-30-103) is provisional:** the chosen version/status route MUST touch zero Storage layer or it trips the lazy DB `init()` and silently pulls P4 (WASM-SQLite, feature 08) into scope, breaching this feature's P3 ceiling. Pin the exact route against opencode's real route table and assert via `dispatchToPort` response shape; mark `TODO(ADR)`.
- **No parity case exists at this level by construction:** there is no Node-vs-rifty stdout diff to make ('opencode's own layers build + one route returns 200 under rifty' has no Node baseline). The Node-compatible sub-behaviors with parity value (`IncomingMessage` pull-stream, buffered `ServerResponse.end`) are owned and parity-tested by feature 05; this harness only exercises them end-to-end. Do not invent a parity case here.
- **tsx-spawn fragility:** the fixture replaces `globalThis.process` (incompatible with vitest IPC), so it MUST run as a spawned tsx child and the test MUST run sandbox-disabled (live npm install needs network). Default CI runs skip it via `describe.skipIf` — keep it that way to avoid network/spawn in fast CI.

### Estimate

2-3 evening-units for the harness+driver wiring (T1-T5) ONCE features 01-05 are merged. Each evening-unit is dominated by live-install iteration and pinning the real `Server.listen` opts/route against upstream opencode source. NOT startable end-to-end until the dependency chain lands; T1-T2 (driver + fixture skeleton up to loader) are ~0.5 unit and writable immediately as red scaffolding.

### Ratification gate

**CONDITIONALLY BLOCKED.** The harness-local parts (env/argv population, opts/env-driven mDNS-off, in-process dispatch, staged markers, route selection) are all REVERSIBLE (one fixture + one driver, no cross-package API, no new dep, no ADR conflict) and need NO ratification — log them as OPEN_QUESTIONS Q-2026-05-30-101/102/103 and proceed.

The ONE irreversible gate (design decision marked `needsHumanRatification: true`): if opencode's headless boot exercises an unimplemented runtime-js builtin method (`os.hostname` and/or any Effect-runtime global the `createRoutes` layers touch), ADDING that method widens runtime-js's public builtin surface consumed across packages (checklist rule 1 → IRREVERSIBLE) and is BLOCKED until the ADR *'runtime-js builtin surface additions required to boot the opencode Effect runtime headlessly (os.hostname and any Effect-runtime globals)'* is ratified with the concrete missing method(s) + Node-parity semantics. Discover the gap by running the harness (it throws `NotImplementedError` loudly), then stop and ratify — do not pre-add API and do not monkeypatch.

Separately, the new external deps implied by feature 04 (`sql.js` / `wa-sqlite`) and any Effect adapter shim are IRREVERSIBLE by checklist rule 2 and owned by those features, not this one.
