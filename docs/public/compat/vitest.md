# Compatibility — Vitest in the browser shell

Claim: **Vitest4.1.11 + Vite8.0.16**, `vitest run`, node environment,
TypeScript configuration/tests, default forks and opt-in threads. Tested on
fresh Chromium with real npm packages; no Vitest-specific source patch.

The manifest must pin Vite through npm's override spelling (or bring an
npm-authored lockfile). An organic unpinned Vitest install may select another
Vite/lightningcss line; unsupported lightningcss recipes fail loudly.

```json
{
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "4.1.11" },
  "overrides": { "vite": "8.0.16" }
}
```

| Capability | Status | Evidence |
|---|---|---|
| Install exact tree, one Vite, rolldown WASM and lightningcss shadow | ✅ | Real browser install; bare-version overrides and lock replay tests |
| Worker/manual-port lifetime and process error/exit events | ✅ | Native Node24 differential plus real isolated browser Workers |
| TypeScript config include and TypeScript test execution | ✅ | Included sum tests run; excluded sentinel never loads |
| Default/forks/threads reporters, counts and assertion diff | ✅ | 1passed/1failed, exit1; fixed fixture2passed, exit0 |
| `npm test` and verbose reporter | ✅ | Same failing/fixed outcomes; verbose test names |
| Claimed tree's module loading, script offsets and advanced IPC | ✅ | Real both-pool scenario plus Node parity and fault carriers |

Timing, ANSI and a fast passing file's default-reporter line are not compared
byte-for-byte. Native default output can omit that line; failure and verbose
runs retain it. Native command oracle:
`node --import tsx tests/e2e/fixtures/vitest-run/native-oracle.mts`.
Browser acceptance: `tests/e2e/owner-shell-vitest.spec.ts`.

## Outside the guarantee

These observations describe actual boundaries, not an artificial version/mode
allowlist. Only the exact pair and scenario above carry a support guarantee.

| Mode/version | Status | Observed boundary |
|---|---|---|
| jsdom30.0.1 | ❌ | `vm.constants.DONT_CONTEXTIFY` named ceiling; no unwrapped VM global |
| happy-dom20.0.0 | ❌ | `module-loader.esm-global-function-assignment` named ceiling |
| Coverage with @vitest/coverage-v84.1.11 | ❌ | `node:inspector/promises` builtin is not implemented; ModuleLoadError, exit1 |
| Browser provider @vitest/browser-playwright4.1.11 + playwright1.60.0 | ❌ | `node:https.Agent` named socket-pool ceiling, exit1 |
| vmThreads/vmForks | ❌ | Their experimental VM flag hits `worker_threads.Worker.execArgv` / `child_process.fork.execArgv`, exit1 |
| Watch | ⚠️ | Initial run and waiting observed; edit/re-run/cleanup lifecycle not certified |
| Other Vite versions | ⚠️ | Outside exact guarantee; 8.0.15 default fail/fix also worked in a probe |

Installed-environment/provider checks:
`tests/e2e/owner-shell-vitest-ceilings.spec.ts`. The extra packages are actually
installed; missing dependencies are not used as runtime ceiling evidence.

Advanced fork IPC supports this non-binary scenario. Binary serialized graphs,
including nested Buffer/typed arrays/DataView/ArrayBuffer/SharedArrayBuffer,
throw `child_process.serialization.advanced.binary` before sending (ADR-0467).
QuickJS Proxy-backed object/array mirrors cannot cross this native-clone IPC
boundary. Other versions/modes are outside the guarantee; no artificial ban.
