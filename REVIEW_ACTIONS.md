# Архитектурное ревью — action items

Источник: ревью соответствия репозитория `PROJECT_PLAN.md` (12 параллельных агентов по M0-M10 + сквозной слой), 2026-05-24.

**Update 2026-05-24 (auto-decisions session):** все 40 пунктов обработаны. Каждый имеет статус: `RESOLVED` (исправлено в этой сессии), `ADR-NNNN` (решение задизайнено, реализация отложена) или `PROMOTED` (соответствующий OPEN_QUESTIONS entry перенесён в ADR/Rejected). См. `~/ai/superpowers/specs/2026-05-24-review-actions-design.md` и `~/ai/superpowers/plans/2026-05-24-review-actions-plan.md`.

Приоритеты:
- **P0** — фундаментные продолбы, ломают принятые ADR / создают иллюзию работающей системы.
- **P1** — нарушения процесса / hard rules CLAUDE.md / DONE-флаги вне реальности.
- **P2** — техдолг, ловушки на следующих милстоунах, расхождение документации и кода.

Классификация обратимости (по чек-листу CLAUDE.md §«Reversibility»): I — IRREVERSIBLE, R — REVERSIBLE.

---

## P0 — фундаментные продолбы

### A-001 [I] execSync через SAB+Atomics не реализован
**Статус:** RESOLVED (2026-05-25, ADR-0011 phase 3). ADR `docs/adr/0011-sync-ipc-sab-atomics.md` теперь полностью имплементирован: phase 1 (SAB ring), phase 2 (worker-per-process), phase 3 (sync `execSync` через `Atomics.wait`).

Phase 3 surface:
- `packages/kernel/src/ipc/sync-rpc.ts` — JSON-over-UTF-8 RPC framing (`SyncRpcRequest`/`SyncRpcReply` + `encode*`/`decode*`).
- `packages/kernel/src/ipc/sync-dispatch.ts` — `SyncRpcDispatcher` (parent-side polling, attach/detach per ring, in-flight guard).
- `packages/kernel/src/ipc/sync-client.ts` — `SyncRpcClient` (in-Worker `Atomics.wait` blocking call); throws `NotImplementedError` если вызвать из main realm.
- `packages/kernel/src/ipc/default-handlers.ts` + `recursive-runner.ts` + `script-resolver.ts` — kernel default `execSync` handler рекурсивно спавнит new Worker, capture'ит stdout, возвращает строку.
- `packages/kernel/src/worker-entry.ts` — публикует `__riftyKernelSyncCall(method, payload)` (key: `KERNEL_SYNC_CALL_KEY`) для runtime-js слоя.
- `packages/runtime-js/src/builtins/child_process-sync.ts` — `execSync` бранчит: SAB hook когда `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]`; иначе fallback на in-realm `new Function`.

2 conformance тестa: `tests/conformance/kernel/sync-rpc.test.ts` (real Node Worker round-trip — echo + ERPCNOHANDLER); `tests/conformance/builtins/exec-sync-worker.test.ts` (skips в Node без isolation, документирует контракт для browser e2e).

### A-002 [I] «Процесс = Web Worker» не реализован
**Статус:** RESOLVED (2026-05-25, ADR-0011 phase 2). `kernel.spawnWorker(spec)` создаёт реальный `new Worker(kernelWorkerUrl, { type: 'module' })` под уникальный PID с SAB-ring + 3 stdio `MessageChannel`s; exit отслеживается через `{type:'exit', code}` сообщение worker'а. `setKernelWorkerUrl` / `getKernelWorkerUrl` дают хосту (playground) передать Vite-резолвленный URL без хардкода путей в `@rifty/kernel`. `child_process.spawn` / `fork` и `worker_threads.Worker` бранчат на `isSabIpcSupported() && getKernelWorkerUrl()`; иначе fallback на in-realm путь (per ADR-0011). 2 conformance-теста под `tests/conformance/builtins/child_process-worker.test.ts` (skip в Node без COOP/COEP).

### A-003 [R] `packages/io` и `packages/kernel` — мёртвый каркас
**Статус:** RESOLVED (2026-05-25, ADR-0012 implemented). `@rifty/io` теперь owns `EventEmitter`/`Buffer`/`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough`/`pipeline`/`finished` + `NotImplementedError`. `runtime-js/builtins/{events,buffer,stream}.ts` и `kernel/src/internal/event-emitter.ts` — re-export shims. `child_process.spawn` аллоцирует PIDs через `globalProcessManager.spawn(...)` (kernel ProcessManager). `worker_threads.Worker` PIDs остаются на отдельном counter до ADR-0011 worker-as-process миграции.

### A-004 [R] OPFS не используется — persistence не работает
**Статус:** RESOLVED (2026-05-26). ADR-0013 (`docs/adr/0013-opfs-vfs-deployment.md`). **Update 2026-05-24 (M11):** code path landed — `packages/vfs/src/boot.ts` exposes `detectVfsBackend()` (returns `'opfs'` iff `crossOriginIsolated && OpfsVfs.isSupported()`) and `initBackend()` which calls `installOpfsFs()` when applicable. **Update 2026-05-26 (bootstrap consolidation):** playground bootstrap wiring landed — `bootstrapPlayground()` in `apps/playground/src/boot.ts` orchestrates COI assert (ADR-0002) → `initBackend()` (VFS) → `registerServiceWorker('/sw.js')` as a single awaited pipeline, awaited in `main.tsx` before `render(...)`. SW registration is no longer raced inside `App.onMount`; failures flow through `BootResult.swError` to the existing dismissible banner. E2E reload assertion added in `tests/e2e/m0-boot.spec.ts` (`write file -> reload -> file persists (OPFS round-trip, A-004)`), exercising `/workspace/persist.txt` survival across `page.reload()`. Remaining OPFS work (chunked streaming, quota error path) tracked separately under A-020 phase 2.

### A-005 [I] Sync через `FileSystemSyncAccessHandle` не реализован
**Статус:** **Closed — scope fixed, not deferred** (2026-05-26 decision, см. ADR-0013 top-of-file). `OpfsFsSync` file ops (`existsSync`, `readFileBytesSync`, `writeFileSync`, `statSync`) реализованы через `FileSystemSyncAccessHandle`. Directory ops permanently throw `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an async bootstrap; use OpfsVfs for those')` — `FileSystemSyncAccessHandle` platform API не имеет directory variant by design, callers routing через paired async `OpfsVfs`. Конструктор отказывается работать вне Worker realm с `NotImplementedError('OpfsFsSync', 'sync OPFS only available inside a Web Worker realm')`. Browser e2e round-trip — отдельный M11 follow-up (см. A-004).

### A-006 [I] Две VFS параллельно — нет «одного источника истины»
**Статус:** ADR-0014 (`docs/adr/0014-shared-vfs-backing-tree.md`). **Decision (2026-05-26):** имплементировать в **M11 (end of June 2026)**. Sketch: process-wide `MemoryBackend` singleton owns in-memory tree; `MemoryVfs` (async view) и `MemoryFsSync` (sync view) — thin wrappers через него. OPFS pair (`OpfsVfs` + `OpfsFsSync`) разделяют OPFS directory handle + in-memory `Map<string, FileSystemSyncAccessHandle>`. WASI preopens используют тот же backend instance. `installMemoryFs()` / `installOpfsFs()` — единственные call sites, минтящие backend.

### A-007 [I] D-005 shadow-registry символический
**Статус:** RESOLVED — ADR-0015 имплементирован (2026-05-24). `tools/shadow-registry/` — новый workspace-пакет `@rifty/shadow-registry` с `bakedOverrides`, `esbuildShimFiles`, `rollupShimFiles`. `packages/npm-client/src/overrides.ts` и `apps/playground/src/adapters/esbuild-shim.ts` теперь тонкие адаптеры/re-exports. `unenv` остаётся отложенным до концретного триггера (см. ADR-0015 §Decision).

### A-008 [I] esbuild-shim — passthrough, M10 финал — фейк
**Статус:** Deferred to **M11 toolchain push** (2026-05-26 decision, см. ADR-0011 §"M11 follow-up — esbuild.wasm via WASI"). Scope: vendored `esbuild.wasm` под `tools/esbuild-wasm/`, WASI preopens для esbuild's tmpdir (mapped через ADR-0014 shared backend), stdin/stdout через kernel-spawned Worker stdio `MessagePort`s из phase 2 ADR-0011. `esbuild-shim` adapter в `apps/playground` свапается с passthrough на spawning kernel Worker + WASI runner.

---

## P1 — процесс / hard rules / DONE-флаги

### A-009 [R] TASKS.md помечает M0/M4/M6/M7/M8/M9/M10 как DONE при невыполненных acceptance
**Статус:** RESOLVED — `TASKS.md` обновлён, эти милстоуны теперь `PARTIAL — see open acceptance below` с явным списком открытых пунктов.

### A-010 [I] Q-005 (subpath exports) прошёл без stop+PR
**Статус:** PROMOTED → ADR-0018 (`docs/adr/0018-runtime-js-subpath-exports.md`). Ретро-принятие: подписан публичный контракт на `./builtins/{process,timers,buffer,module}`, опция `./host` consolidation остаётся на будущее. Q-005 перенесён в "Promoted" секцию `OPEN_QUESTIONS.md`.

### A-011 [R] Q-006 (`https → http` alias) — silent stub
**Статус:** RESOLVED + PROMOTED. Создан `packages/net/src/https.ts` — loud-throw stub (импорт работает, любой вызов кидает `NotImplementedError`). `register-builtins.ts` обновлён. 5 conformance-тестов в `tests/conformance/builtins/https.test.ts`. ADR-0010 ратифицирует. Q-006 → "Rejected" в `OPEN_QUESTIONS.md`.

### A-012 [R] `check:isolation` не запускается в CI
**Статус:** RESOLVED — `.github/workflows/ci.yml` job `lint-and-typecheck` теперь зовёт `pnpm check:isolation` после `pnpm check:deps`.

### A-013 [R] `check:deps` отстал — есть необъявленный цикл
**Статус:** RESOLVED — реестр (registerBuiltin/listBuiltins/loadBuiltin/isBuiltinSpecifier + cache + factories) вынесен в новый модуль `packages/runtime-js/src/builtins/registry.ts`. `index.ts` и `module.ts` оба импортят из registry; цикл устранён. `pnpm check:deps` показывает `0 circular`.

### A-014 [I] Слойная инверсия `net → runtime-js`
**Статус:** RESOLVED (2026-05-25, ADR-0012 implemented). `packages/net/src/{http,net,ws}.ts` теперь импортят `EventEmitter`/`Buffer`/`Readable` из `@rifty/io` напрямую. `grep -r '@rifty/runtime-js' packages/net/src` показывает единственный hit — `register-builtins.ts` импортит `registerBuiltin` из runtime-js, но это forward-direction side-effect entrypoint (`apps/playground` загружает его чтобы плагнуть net в runtime-js loader registry), не reverse import of primitives.

### A-015 [R] TODO(ADR)-маркеры расходятся с OPEN_QUESTIONS.md
**Статус:** RESOLVED. (1) Q-005 markers добавлены: в `packages/runtime-js/package.json` (top-level `"// TODO(ADR)"` ключ) и в `apps/playground/src/adapters/realVite.ts:26-27`. (2) `tools/adr/todo-report.mjs` усилён: парсит `## Active` секцию `OPEN_QUESTIONS.md`, грепает каждый Q-id, exit 1 если нет хотя бы одного маркера. Pre-implementation Q's (с `(none — …)` под `### Code markers`) корректно пропускаются.

### A-016 [I] Нет prod-headers COOP/COEP
**Статус:** RESOLVED — добавлены `vercel.json` (на корне репо) и `apps/playground/public/_headers` (Netlify/CF Pages). Оба содержат COOP=`same-origin`, COEP=`credentialless`, CORP=`cross-origin`, матчится с `vite.config.ts`.

### A-017 [R] SW-код задублирован
**Статус:** RESOLVED (2026-05-24 второй sub-session). Vite plugin `apps/playground/build/sw-plugin.ts` бандлит `packages/service-worker/src/sw.ts` в `apps/playground/public/sw.js` через esbuild на `buildStart` (build) и при изменениях в `packages/service-worker/src/` (dev). Source-of-truth — TS. Сгенерированный `sw.js` добавлен в biome ignore (артефакт сборки). Параллельно в `packages/service-worker/src/preview-bridge.ts` добавлены default `CORP: cross-origin` + `COEP: credentialless` заголовки на preview-responses (paritю с handwritten версией). См. ADR-0016.

---

## P2 — техдолг и ловушки на следующих милстоунах

### A-018 [R] Buffer — Uint8Array-tag без критичных методов
**Статус:** RESOLVED. `packages/runtime-js/src/builtins/buffer.ts` расширен: `readUInt{8,16BE,16LE,32BE,32LE}`, `readInt{...}`, `readBigUInt64{BE,LE}`, `readBigInt64{BE,LE}`, симметричные `write*`, `swap{16,32,64}`, instance `compare`, static `Buffer.compare`. Plus: 17 unit-кейсов в `tests/conformance/builtins/buffer.test.ts` + новый parity case `tools/node-parity-runner/cases/buffer/readwrite.case.ts` (matches Node).

### A-019 [R] `process.cwd()` hardcoded `/`, `chdir` — no-op
**Статус:** ADR-0019 (`docs/adr/0019-cwd-in-process-record.md`). Per-process cwd state in `ProcessManager`; M11.

### A-020 [R] `createReadStream` не стримит
**Статус:** PARTIAL — phase 1 RESOLVED (2026-05-24 второй sub-session), phase 2 deferred **post-A-006** (2026-05-26 decision, см. ADR-0020 top-of-file). Phase 1: добавлен `openReadable(path, opts?): Promise<ReadableStream<Uint8Array>>` в `Vfs` interface (`packages/vfs/src/types.ts`), реализован в `MemoryVfs` (default chunkSize 64 KiB, start/end byte offsets), стабы в `OpfsVfs` + `SyncMirrorVfs` (бросают с pointer'ом на M11). 5 conformance-тестов pass. **Phase 2:** gated on ADR-0014 (shared VFS backing tree) landing first — иначе `OpfsVfs.openReadable` через `File.stream()` от одной tree против `createReadStream` fallback от другой ломает "single source of truth" из M4/M8. Order: ADR-0014 (M11) → ADR-0020 phase 2 (M11).

### A-021 [R] Pipes между процессами — строковая шина
**Статус:** PARTIAL — ADR-0011 phase 3 implemented JSON-over-UTF-8 framing для sync RPC (см. A-001). Binary stdio over MessagePort с backpressure — отдельный follow-up: framing в phase 3 это JSON, не raw bytes. Будет адресовано отдельным заходом.

### A-022 [I] Chunked transfer encoding и streaming response отсутствуют
**Статус:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). `SerializedResponse` body as `ReadableStream<Uint8Array>` Transferable across realms через cross-realm bridge из ADR-0011. M12 starts только после M11 ships ADR-0011 worker-as-process — bridge является load-bearing primitive.

### A-023 [I] SW → main thread, а не SW → Worker
**Статус:** ADR-0011 — **M11 confirmed, sequenced after A-026** (2026-05-26 decision). Blocked by cross-realm port-registry bridge из Vite-in-Worker миграции. После A-026 SW rewires с "post to first window client" → "post to worker owning the process registered for this URL", reusing same `MessagePort` registry. Dependency chain: ADR-0011 phases 1-3 (DONE) → A-026 Vite-in-Worker → A-023 SW-to-Worker.

### A-024 [R] `net.Socket` — это HTTP-RPC, не TCP
**Статус:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). `net.Socket` gains full TCP-shape surface: raw byte streaming, `_write`/`_read` honour `chunk` not HTTP frames. Где TCP semantics нельзя faithfully эмулировать в browser (e.g. `localAddress`), TSDoc declares limitation as final.

### A-025 [R] WebSocket — same-realm shim
**Статус:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). Cross-realm WS bridge через dedicated `MessagePort` per connection вместо `BroadcastChannel` (last has no per-connection isolation и no backpressure). Включено в M12 streaming rewrite вместе с A-022 / A-024.

### A-026 [R] Vite крутится в main thread page realm
**Статус:** ADR-0011 + ADR-0025 — **M11 confirmed** (2026-05-26 decision). Vite переезжает из page realm в kernel-spawned Worker как только cross-realm port-registry bridge в `@rifty/net` готов. Миграция local — replace `realVite.ts` с worker-spawning version плюс registry bridge. ADR-0025 superseded для Real Vite path; main-thread Dev Mode остаётся как non-isolated fallback. Q-2026-05-23-002 уже promoted к ADR-0025.

### A-027 [R] Реальные пакеты — на mock'ах
**Статус:** RESOLVED (2026-05-24). ADR-0021 переведён в `Implemented`. Vendored под `tests/integration/fixtures/registry/`: `picocolors-1.0.0.tgz` (2.4 KB), `ms-2.1.3.tgz` (2.9 KB), `kleur-4.1.5.tgz` (6.0 KB) — все zero-dep. `manifest.json` + per-package `<name>.json` + `local-registry.ts` (Fetcher для `RegistryClient`) дают offline fake-registry. `tests/integration/real-install.test.ts` гоняет реальный `install()` end-to-end: single-package, multi-package, lockfile + tarball-cache reuse (3 теста). Acceptance ADR-0021 для chalk/express и `tools/integration-fixtures/refresh.ts` остаются на M11 (chalk/express не zero-dep).

### A-028 [R] Parity-runner покрывает мало
**Статус:** RESOLVED (2026-05-25). Runner-fix: setup files теперь mount'ятся alongside entry в обеих средах (Node — copy into `entryDir`, rifty — `/work/<rel>` рядом с `/work/main.{js,mjs}`). +2 кейса (`modules/cjs-cycle`, `modules/tla`); итого 21. `pnpm check:parity-coverage` enforces floor ≥ 1 per represented module и warns при < 5 (ADR-0022 target).

### A-029 [R] E2E на M5-M10 отсутствует
**Статус:** RESOLVED (2026-05-25). `pnpm check:e2e-coverage` listает M0..M10 specs, warning'ом репортит missing (M3/M5/M6/M7/M8/M9/M10), wired в CI lint-and-typecheck. Non-failing per ADR-0022 §Consequences; backfill — M11.

### A-030 [R] Lockfile записывается, но не читается
**Статус:** RESOLVED (2026-05-26). ADR-0023 implemented end-to-end. `packages/npm-client/src/installer.ts` reads `<cwd>/package-lock.json` first; when every top-level dep's pin still satisfies the requested range (after applying user + baked-in overrides — см. ADR-0023 §"Implementation notes (2026-05-26) — overrides re-applied on fast path"), replays the closed subgraph through `VfsTarballCache` at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz`. Integrity-verified cache hits skip the network entirely. Coverage: 4 conformance tests (`tests/conformance/npm/lockfile-reuse.test.ts`) + integration roundtrip (`tests/integration/real-install.test.ts:81` — second install with same `package.json` issues 0 packument + 0 tarball calls against the vendored fake-registry) + 3 unit tests for the overrides-on-fast-path divergence (`installer-lockfile.test.ts`).

### A-031 [R] Linker: конфликт версий → silent skip
**Статус:** RESOLVED (loud-throw) — `packages/npm-client/src/installer.ts` теперь бросает `Object.assign(new Error(...), { code: 'EVERSIONCONFLICT', packageName, firstVersion, secondVersion })`. `conflicts: []` поле сохранено для совместимости (всегда пусто). Тест: `installer.test.ts` собирает реальный gz-tar fake registry с двумя пакетами, требующими разных версий третьего; ассертит rejection с правильным shape. **Nested install (M12 decision, 2026-05-26):** Полноценный nested layout (`node_modules/<a>/node_modules/<b>/...`) deferred to M12 (см. ADR-0023 top-of-file). До тех пор flat-tree linker + hard `EVERSIONCONFLICT`. Требует linker schema rewrite + lockfile-shape extension — оба fit в M12 toolchain pass вместе с `@rifty/net` cross-realm streaming rewrite.

### A-032 [R] Q4' (prod-прокси npm registry) не зарегистрирован
**Статус:** RESOLVED — заведена `Q-2026-05-24-007` в `OPEN_QUESTIONS.md`. Provisional decision: Vercel Edge Function (fallback — Cloudflare Worker). Pre-implementation, маркер не требуется (`todo-report.mjs` корректно это распознаёт).

### A-033 [R] `compat-matrix` пустой для fs/streams/http
**Статус:** **Manually triggered before each milestone DoD cycle** (2026-05-26 decision, documented в `CLAUDE.md` §"Definition of done"). `pnpm compat:generate` не invoked на каждый PR (CI fast + avoid noisy churn) — milestone closer runs it once и коммитит diff. Регенерация для M10 → M11 transition остаётся on milestone closer's plate.

### A-034 [R] Зомби-зависимость `es-module-lexer`
**Статус:** RESOLVED — удалён из `packages/runtime-js/package.json` `dependencies`. Lockfile регенерирован; пакет остаётся в дереве только как транзитивная зависимость Vite (это норм). Импортов в `packages/` нет (`rg "es-module-lexer" packages/` — 0 hits в source).

### A-035 [R] Поле `package.json` `imports` (`#dep`) не реализовано
**Статус:** RESOLVED — `packages/runtime-js/src/module-loader/resolver.ts` теперь обрабатывает `#`-specifiers (walk up до ближайшего `package.json` с `imports` field, применить condition logic, поддержка wildcards). 5 conformance-кейсов в `tests/conformance/modules/imports-field.test.ts`.

### A-036 [R] `RiftyTerminal.setBusy()` — мёртвый API
**Статус:** RESOLVED — удалён метод из `packages/terminal/src/terminal.ts`. Внутренний `busy` state остаётся (управляется `handleData`). Внешних потребителей не было.

### A-037 [R] `ChildProcess.stdin` — silent no-op
**Статус:** RESOLVED — `packages/runtime-js/src/builtins/child_process.ts` теперь `stdin = { write, end }` с обоими бросающими `NotImplementedError('child.stdin.{write,end}', '...see ADR 0011')`. Type обновлён (`{ write(chunk): never; end(): never }`). 2 теста в `tests/conformance/builtins/child_process.test.ts`.

### A-038 [R] Crash-recovery воркера: pending eval'ы зависают
**Статус:** RESOLVED — `packages/runtime-js/src/host.ts` `worker.addEventListener('error', …)`: reject всех pending entries с `Error{ code: 'WORKER_CRASHED' }`, clear pending, emit `{ type: 'exit', reason: 'error' }`, terminate воркер. Без авто-restart (caller's recourse — `reset()`).

### A-039 [R] Файлы за лимитом ~300 строк
**Статус:** PARTIAL — enforcement RESOLVED (2026-05-24 второй sub-session): `tools/checks/file-budget.mjs` (biome v1.9 такого правила не имеет), threshold 300, EXCEPTIONS-set из 8 файлов (4 из брифа + 4 обнаруженных при rollout: `buffer.ts`, `crypto.ts`, `fs.ts`, `esm-ast.ts`). Прокинуто в `package.json` (`pnpm check:budget`) и в `.github/workflows/ci.yml` `lint-and-typecheck` job. Точные line-counts задокументированы в ADR-0024. **WASI декомпозиция** (`wasi.ts` → `syscalls/{fd,path,proc}.ts`) остаётся в M11 (нужны больше WASI-тестов).

### A-040 [R] Рассинхрон source-of-truth
**Статус:** RESOLVED. `README.md` — `Active milestone: M10 (Real Tooling)`, port `5273`. `apps/playground/index.html` — xterm CSS `<link>` href переписан с `/node_modules/@xterm/xterm/css/xterm.css` на `/@xterm/xterm/css/xterm.css` (Vite разрешает в обоих режимах).

---

## Метрики после сессии (обновлено 2026-05-24, после второго sub-session)

- **Циклов зависимостей:** 0 ✅ (было 1)
- **TODO(ADR) маркеров (в коде):** 5 (Q-002 × 1, Q-003 × 1, Q-004 × 1, Q-005 × 2)
- **OPEN_QUESTIONS активных:** 4 (Q-002, Q-003, Q-004, Q-2026-05-24-007 prod proxy)
- **OPEN_QUESTIONS promoted:** 2 (Q-001 → ADR 0009, Q-005 → ADR 0018)
- **OPEN_QUESTIONS rejected:** 1 (Q-006 → ADR 0010)
- **ADRs:** 24 (0001-0024). Implemented в этой работе: 0010 (https loud-throw), 0016 (SW from TS), 0018 (subpath exports — retroactive). Partial: 0020 phase 1, 0022 (3 cases of 5), 0024 (enforcement). Остальные deferred к M11/M12.
- **Conformance + integration tests:** **255 pass** (было 222 → 250 → 255). Дельта в этом sub-session: +5 (`Vfs.openReadable`).
- **Parity cases:** **19** (было 15 → 16 → 19). Дельта в этом sub-session: +3 (`stream/backpressure`, `stream/pipeline-multi`, `http/parse-url`).
- **Typecheck (16 проектов):** clean
- **Lint (biome):** clean (1 pre-existing warning — `perf_hooks.ts`); generated `sw.js` в biome ignore
- **`check:deps`:** clean
- **`check:isolation`:** clean
- **`check:budget`:** clean (8 documented exceptions)
- **`todo:adr`:** exit 0

## Что осталось открытым

- **A-033** — `compat:generate` не запускался; M11 как часть DoD-cycle.

- **A-041 [R] `RiftyTerminal.handleInput` публичный «for testing»** (2026-05-26): `packages/terminal/src/terminal.ts:109` — `handleInput` сейчас `public` с TSDoc-комментарием, что production callers не должны его звать. Задача: сделать его `private` + добавить `onHandleInput?: (e: KeyEvent) => void` callback в `RiftyTerminalOptions` для test observability. **Status: deferred** — существующий `packages/terminal/src/terminal.test.ts` плотно завязан на direct `await term.handleInput(...)` вызовы (~30 тестов, синхронизация через возвращаемый Promise). Переход на callback требует полного переписывания test orchestration (await на callback emit вместо method return), что выходит за рамки текущей "не ломать тестовый suite"-задачи. Возвращаемся в отдельной сессии когда test rewrite будет main focus.
- **Implementation deferred items для M11:** A-001, A-002, A-003, A-005, A-006, A-007, A-008, A-014, A-017 (full plugin spec в ADR-0016 уже реализован, но broader migration к "SW only as bundled artifact across all environments" — это уже M11), A-019, A-020 (phase 2: OPFS + fs-streams rewrite), A-021, A-022 (полный coverage), A-023, A-026, A-027 (chalk/express follow-up — zero-dep slice уже landed), A-030, A-031 (nested install), A-039 (WASI split). (A-004 closed 2026-05-26 — bootstrap wiring + persistence e2e in place.)
- **Implementation deferred items для M12 (после M11):** A-022/A-024/A-025 (streaming HTTP + cross-realm WS rewrite).
- **Q-2026-05-24-007** — pre-implementation, ждёт первого prod deploy.
- **Парные cycle/TLA parity cases (A-028)** — заблокированы runner-fix'ом (mount setup.files alongside entry).
