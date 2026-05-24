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
**Статус:** ADR-0011 (sync IPC via SharedArrayBuffer+Atomics; deferred to M11).
**Что сделано в этой сессии:** ADR `docs/adr/0011-sync-ipc-sab-atomics.md` фиксирует дизайн kernel `worker-entry.ts` + Atomics-coordinated request/reply, acceptance-критерии для M11.

### A-002 [I] «Процесс = Web Worker» не реализован
**Статус:** ADR-0011 (тот же дизайн).

### A-003 [R] `packages/io` и `packages/kernel` — мёртвый каркас
**Статус:** ADR-0012 (`docs/adr/0012-io-and-kernel-promotion.md`). Решение: путь 1 из ревью — primitives (EventEmitter, Buffer, Readable*) переезжают в `@rifty/io`, `ProcessManager` становится бэкендом `child_process`. Реализация — M11 (вместе с A-002).

### A-004 [R] OPFS не используется — persistence не работает
**Статус:** ADR-0013 (`docs/adr/0013-opfs-vfs-deployment.md`). Реализация (включая bootstrap-детект `OpfsVfs.isSupported() && crossOriginIsolated` и e2e reload) отложена до M11.

### A-005 [I] Sync через `FileSystemSyncAccessHandle` не реализован
**Статус:** ADR-0013 (`OpfsFsSync` в `packages/vfs/src/`; deferred to M11). Main-realm sync calls должны бросать `NotImplementedError('fs.readFileSync', 'sync fs only available in Worker')`.

### A-006 [I] Две VFS параллельно — нет «одного источника истины»
**Статус:** ADR-0014 (`docs/adr/0014-shared-vfs-backing-tree.md`). Async `Vfs` и sync `FsSync` теперь общий backend; реализация M11.

### A-007 [I] D-005 shadow-registry символический
**Статус:** ADR-0015 (`docs/adr/0015-shadow-registry-consolidation.md`). `tools/shadow-registry/` будет домом всех overrides + shims; `unenv` отложен до концретного триггера. Реализация M11.

### A-008 [I] esbuild-shim — passthrough, M10 финал — фейк
**Статус:** ADR-0011 (зависит от worker-as-process для запуска `esbuild.wasm` через WASI). Acceptance включает «esbuild.wasm runs through WASI runner».

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
**Статус:** ADR-0012 (резолвится автоматически после переезда primitives в `@rifty/io`; M11).

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
**Статус:** PARTIAL — phase 1 RESOLVED (2026-05-24 второй sub-session), phase 2 ADR-0020 M11. Phase 1: добавлен `openReadable(path, opts?): Promise<ReadableStream<Uint8Array>>` в `Vfs` interface (`packages/vfs/src/types.ts`), реализован в `MemoryVfs` (default chunkSize 64 KiB, start/end byte offsets), стабы в `OpfsVfs` + `SyncMirrorVfs` (бросают с pointer'ом на M11). 5 conformance-тестов pass. **Phase 2 (M11):** OpfsVfs реальная реализация через `File.stream()` + переписывание `createReadStream` поверх `openReadable` — заблокировано ADR-0014 (split VFS backend сейчас сломает источник истины).

### A-021 [R] Pipes между процессами — строковая шина
**Статус:** ADR-0011 (binary stdio over MessagePort при переходе на worker-as-process; M11).

### A-022 [I] Chunked transfer encoding и streaming response отсутствуют
**Статус:** ADR-0017 (`docs/adr/0017-net-scope-and-streaming-rewrite.md`). Streaming `SerializedResponse` (body как `ReadableStream` Transferable); M12.

### A-023 [I] SW → main thread, а не SW → Worker
**Статус:** ADR-0011 (нужна cross-realm net-bridge; зависит от worker-as-process; M11).

### A-024 [R] `net.Socket` — это HTTP-RPC, не TCP
**Статус:** ADR-0017 (зафиксирован scope: текущий `@rifty/net` — HTTP-shape only; полноценный socket — M12).

### A-025 [R] WebSocket — same-realm shim
**Статус:** ADR-0017 (cross-realm WS bridge как часть streaming rewrite; M12).

### A-026 [R] Vite крутится в main thread page realm
**Статус:** ADR-0011 (после worker-as-process — переезд в Worker; M11). Q-2026-05-23-002 остаётся активным до того момента.

### A-027 [R] Реальные пакеты — на mock'ах
**Статус:** ADR-0021 (`docs/adr/0021-real-install-integration-tests.md`). Vendored tarball registry под `tests/integration/fixtures/`; M11.

### A-028 [R] Parity-runner покрывает мало
**Статус:** RESOLVED (2026-05-25). Runner-fix: setup files теперь mount'ятся alongside entry в обеих средах (Node — copy into `entryDir`, rifty — `/work/<rel>` рядом с `/work/main.{js,mjs}`). +2 кейса (`modules/cjs-cycle`, `modules/tla`); итого 21. `pnpm check:parity-coverage` enforces floor ≥ 1 per represented module и warns при < 5 (ADR-0022 target).

### A-029 [R] E2E на M5-M10 отсутствует
**Статус:** RESOLVED (2026-05-25). `pnpm check:e2e-coverage` listает M0..M10 specs, warning'ом репортит missing (M3/M5/M6/M7/M8/M9/M10), wired в CI lint-and-typecheck. Non-failing per ADR-0022 §Consequences; backfill — M11.

### A-030 [R] Lockfile записывается, но не читается
**Статус:** ADR-0023 (`docs/adr/0023-lockfile-reuse.md`). Read-path для lockfile + tarball cache под `/.rifty/tarball-cache/`; M11.

### A-031 [R] Linker: конфликт версий → silent skip
**Статус:** RESOLVED — `packages/npm-client/src/installer.ts` теперь бросает `Object.assign(new Error(...), { code: 'EVERSIONCONFLICT', packageName, firstVersion, secondVersion })`. `conflicts: []` поле сохранено для совместимости (всегда пусто). Тест: `installer.test.ts` собирает реальный gz-tar fake registry с двумя пакетами, требующими разных версий третьего; ассертит rejection с правильным shape.

### A-032 [R] Q4' (prod-прокси npm registry) не зарегистрирован
**Статус:** RESOLVED — заведена `Q-2026-05-24-007` в `OPEN_QUESTIONS.md`. Provisional decision: Vercel Edge Function (fallback — Cloudflare Worker). Pre-implementation, маркер не требуется (`todo-report.mjs` корректно это распознаёт).

### A-033 [R] `compat-matrix` пустой для fs/streams/http
**Статус:** PARTIAL → deferred. `pnpm compat:generate` не запускался автоматически в этой сессии (не входит в `pnpm test:run`, требует ручного триггера на стабильном sequence). Будет регенерироваться в M11 как часть acceptance-cycle, см. CLAUDE.md DoD.

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
- **Implementation deferred items для M11:** A-001, A-002, A-003, A-004 (full), A-005, A-006, A-007, A-008, A-014, A-017 (full plugin spec в ADR-0016 уже реализован, но broader migration к "SW only as bundled artifact across all environments" — это уже M11), A-019, A-020 (phase 2: OPFS + fs-streams rewrite), A-021, A-022 (полный coverage), A-023, A-026, A-027, A-030, A-031 (nested install), A-039 (WASI split).
- **Implementation deferred items для M12 (после M11):** A-022/A-024/A-025 (streaming HTTP + cross-realm WS rewrite).
- **Q-2026-05-24-007** — pre-implementation, ждёт первого prod deploy.
- **Парные cycle/TLA parity cases (A-028)** — заблокированы runner-fix'ом (mount setup.files alongside entry).
