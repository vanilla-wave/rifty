# Архитектурное ревью — 2026-05-26

Параллельный обзор по субагенту на модуль (11 параллельных Explore-агентов). Фокус: соответствие реализации заявленным целям проекта (PROJECT_PLAN.md, ADR'ы) и архитектурные косяки, **не баги и не стиль**.

Методология: «deletion test» (если удалить модуль — концентрируется сложность или просто перетекает?), глубина интерфейса (interface ≈ implementation → shallow), нарушения слоистости, наличие реальных vs. мнимых seam'ов.

---

## Общий вердикт

**Архитектура держится.** Слои чистые (одно нарушение на весь репо), ADR-дисциплина живая, нет тихих заглушек, нет `any`, нет реверс-импортов из верхних слоёв. Проект как учебная демонстрация устройства WebContainers — на месте.

**Архитектурный долг сосредоточен в трёх местах**, и он растёт:

1. **`@rifty/io/streams`** — мелкие интерфейсы, на которые опираются 5+ пакетов
2. **`worker-entry` и глобальное состояние внутри Worker'а** — runtime-js пишет в `globalThis` ad-hoc без owner-таблицы, которая уже есть у kernel
3. **«Переходные» фасады для M11** — SW routing и WASI спроектированы под текущий single-realm мир

---

## Приоритеты по влиянию на реальный запуск фронтенд проектов

Сортировка находок ревью по критерию «насколько мешает или сломает реальный запуск фронт-проекта в playground'е» (npm install + vite dev + HMR). Это другой угол к секции «Топ-5 по архитектурному вреду до конца M11» ниже — оба полезны, фокусы разные.

### Tier 0 — блокирует исполнение уже сегодня

1. **`shell` не подключён к playground.** `apps/playground/package.json:21` объявляет dep, `apps/playground/src/*` его не импортирует ни в одном файле. Из UI нельзя ни `npm install`, ни `vite dev`. `TASKS.md:164` помечает M9 wiring как `[x]`, на деле — нет.
2. **`shell` writer — sync `+=`** (`packages/shell/src/shell.ts:121-134`). `stdout/stderr` копится строкой, `Shell.run` отдаёт blob после `await`. Прогресс-бары `npm install` и request-логи `vite dev` **не доходят до terminal в реальном времени** — пустота → всё разом в конце.
3. **`shell` молча дропает `&&`/`||`/`;`** (`shell.ts:104-113`). `cd app && npm install` исполняет ТОЛЬКО `cd app`, exit 127. Любой README-туториал с composite-командой — мимо.

### Tier 1 — критично для M10 «Real Tooling» под нагрузкой

4. **`ModuleLoader` пересоздаётся на каждый `load-fixture`** (`packages/runtime-js/src/worker-entry.ts:102-105`). M2 это невидимо, но Vite HMR полагается на тёплый module cache между апдейтами — здесь cache **очищается полностью** на каждое сохранение. Vite-как-Real-tool работать будет, но медленно и без HMR в полном смысле.
5. **io-streams ниже Node-контракта.** `Duplex/Transform.write` пер-инстансом ребиндится в конструкторе; `Readable.read(n)` игнорирует `n`; `pipeline` не destroy'ит upstream при ошибке. Любая третья библиотека на transform pipelines (`tar-stream`/`gunzip-maybe` в `@rifty/npm-client`, внутренности Vite) — undefined behaviour. Один корень для нескольких следствий выше по стеку.
6. **Две копии fetch+integrity+unpack в `installer.ts`** (`packages/npm-client/src/installer.ts:96-121` vs `:189-211`). Уже разошлись: fast-path бросает `EINTEGRITY`, live-path молча reuse'ит cache-hit bytes. Peer-warnings теряются на fast-path (lockfile v3 не хранит `peerDependencies`). Каждый второй `npm install` — потенциально divergent.
7. **`apps/playground/src/adapters/realVite.ts` — 262 строки, 6 ответственностей** (install globals → seed project → install packages → overlay shims → build loader → bridge SW) + module-global `globalsInstalled` флаг + 4 `as unknown as` cast'а. Текущая точка входа в M10 Real Vite demo. В demo работает, но регрессия в M10/M11 будет очень тяжело локализуема.

### Tier 2 — заминирует M11 (HMR / preview / Vite-в-Worker)

8. **SW routing assume page-realm.** `packages/service-worker/src/route-preview.ts:39-57` ищет `Client.type === 'window'`. После A-026 (Vite в Worker, ADR-0011) клиент Vite будет не window-type и matching silently выпадёт на deprecated first-window path. Симптом — preview работает «у первого попавшегося таба», а не у владельца процесса.
9. **`BridgedWebSocket` собран, не подключён** (`packages/net/src/ws/bridge.ts:243-248`). ADR-0017 phase 1 acceptance: «iframe HMR client connects via cross-realm bridge». В `apps/`/`service-worker/` ноль call-site'ов. HMR через bridge сегодня **не работает**, хотя API готов.
10. **Ungoverned globals в `runtime-js`.** `__riftyEsmStash`, `__riftyLastEsmBody`, `__setCreateRequireImpl`, monkey-patch `Promise.prototype.then` в `process.ts`. Сегодня — один Worker, всё работает. ADR-0011 phase 3 уже опубликовал через kernel `shared-globals.ts` ключи `__riftyKernelSyncCall`/`__riftyKernelSyncRing__`. При A-026 multi-realm runtime-js ключи начнут пересекаться — отладка такого «collision in third Worker realm» — катастрофа.

### Tier 3 — silent stubs и UX-кейсы в реальных проектах

11. **WASI `stdin` всегда EOF** (`packages/runtime-wasi/src/syscalls/fd.ts:108-112`, `wasi.ts:23`). `WasiOptions.stdin` объявлен, `fd_read` его игнорирует. esbuild через stdin (cli `esbuild --bundle` через pipe) тихо хангает.
12. **`IncomingMessage.socket` — hardcoded loopback** (`packages/net/src/http/request.ts:28-38`). Express `req.ip` всегда `'127.0.0.1'`. Любой middleware с rate-limit / geo / audit — лжёт молча.
13. **`terminal` без backpressure** (`packages/terminal/src/terminal.ts:84`) + `busy` mutex дропает keystroke'ы пока команда работает (`terminal.ts:49,121,172-178`). Стрелка вверх в середине npm install потеряна.
14. **`shell.cd` через privileged closure** (`shell.ts:48`); `shell` redirect parsing позиционный (`shell.ts:104-113`). `cd` снаружи виден builtin'ам снапшотом, `echo a > /f b` НЕ редиректит, `2>&1` молча трактуется как arg.

### Tier 4 — архитектурный долг без влияния на исполнение

15. **`vfs → io` layer leak** ради `NotImplementedError` (`packages/vfs/src/opfs-sync.ts:27`, `packages/vfs/package.json:18`). Hard rule violation, 5-строчный фикс (инлайн в `vfs/errors.ts`).
16. **`CjsLoaderDeps`/`EsmLoaderDeps`** — leaky abstraction (`packages/runtime-js/src/module-loader/loader.ts:34-87`). Пакуют registry + resolver + 3 хелпера ради одного метода.
17. **Process shim в `kernel/worker-entry.ts:138-161`** — задача runtime-js, kernel не должен знать про Node `process`.
18. **Buffer split** на `buffer.ts` + `buffer-prototype.ts` — ровно тот паттерн, который ADR-0033 явно называет анти-примером.
19. **Два PID-пространства** (`ProcessManager.nextPid` от 2 vs `kernel/src/internal/recursive-runner.ts:48` от `0xC0000000`). Nested execSync дети невидимы в `globalProcessManager.list()`.
20. **`apps/playground/src/App.tsx` god-component** — 292 строки, 5 сигналов, 4 callback'а, 3 режима inline. Извлечь `usePlaygroundMode()`.

### Tier 5 — микро-долг

21. ADR-0018 §B subpath-pinning тест обещан, не существует.
22. `controllerchange`-driven goodbye задокументирован (`packages/service-worker/src/protocol.ts:51-54`), не реализован — crashed tab оставляет ghost в ready-set.
23. `fd_readdir` сообщает `FILETYPE_UNKNOWN` (`packages/runtime-wasi/src/syscalls/fd.ts:285`) — toolchain'ы re-stat'ят, удвоенный syscall-трафик.
24. `packages/runtime-js/src/builtins/null-net-stubs.ts:72-80` — dead `https`-стаб, не регистрируется.
25. `nextRequestId` module-global mutable в `service-worker/route-preview.ts:26`.
26. `subgraphFreeOfOverrideDivergence` aggressive — не учитывает parent-scoped overrides формата `"a > b": "..."`.

---

## Соответствие целям по модулям

| Модуль | Цели | Главная архитектурная проблема |
|---|---|---|
| **vfs** | ⚠️ | Layer leak `vfs → io` ради `NotImplementedError`. `sync-mirror.ts` смешивает backend и process-wide registry. Backend-pluggability декларирована, на деле `boot.ts` хардкодит. |
| **io** | ⚠️ | Streams — мелкие. Duplex/Transform переписывают `this.write` instance-методом, `read(n)` игнорирует `n`, `pipeline` не destroy'ит upstream. EE не эмитит `removeListener`. Buffer split — антипаттерн, который сам же ADR-0033 называет анти-примером. |
| **kernel** | ✅ | В `worker-entry.ts:138-161` kernel вынужден шиммить `process` — это работа runtime-js. Module-load handshake `setKernelRecursiveSpawn` чинит цикл, но хрупкий. Два PID-пространства без единого аллокатора. |
| **runtime-js** | ⚠️ | **`ModuleLoader` пересоздаётся на каждый `load-fixture`** — нажатие клавиши в редакторе сбрасывает весь кэш модулей. Глобалы пишутся ad-hoc в `globalThis`/`self`/`Promise.prototype` без owner-таблицы. `CjsLoaderDeps`/`EsmLoaderDeps` — leaky abstraction. Subpath-pinning тест из ADR-0018 §B не существует. |
| **runtime-wasi** | ✅ | **Самый чистый пакет в репо.** Одна dep (`@rifty/vfs`), три публичных имени, syscalls сгруппированы по WASI spec. preview2-readiness реальная. Но `stdin` молча возвращает EOF (нарушение «no silent stubs») и нет интеграции с kernel/PID. |
| **net** | ⚠️ | `net.Server` парсит HTTP поверх фейкового сокета, прогоняя байты через два парсера. `BridgedWebSocket` собран, экспортирован — **ни одного product-callsite**. Две заглушки `https` в двух пакетах (`net/https.ts` и `runtime-js/null-net-stubs.ts`). |
| **service-worker** | ⚠️ | Routing предполагает page-realm: `clients.matchAll({type:'window'})`. M11 (ADR-0025/A-026 — Vite в Worker) **молча сломает** обращение к «owning client». `nextRequestId` — module-global mutable. Валидация фрейма проходит в `ready-clients.ts`, а не на границе диспетчера. |
| **npm-client** | ⚠️ | Две копии пайплайна fetch+integrity+unpack в `installer.ts` (fast-path vs live), уже разошлись поведенчески (EINTEGRITY обработана по-разному). Peer-warnings пропадают на lockfile fast-path. `resolveDep` — 95-строчный замкнутый метод, смешивающий 6 фаз. |
| **shell** | ⚠️ | **Ноль consumers в репозитории** — package объявлен зависимостью в `apps/playground/package.json`, но не импортирован нигде. Writer — синхронный string-`+=`, без стриминга в терминал. `cd` — привилегированный builtin через closure, недоступен сторонним командам. Нет интеграции с `kernel.spawn`. |
| **terminal** | ⚠️ | PROJECT_PLAN §122 обещает «PTY abstraction» — её нет. `types.ts`: один union `'stdout' \| 'stderr'`. Нет backpressure (M1 acceptance проходит по случайности). `handleInput public` ради тестов (A-041) — задокументированный смелл. |
| **playground** | ✅ | D-002 дисциплина соблюдена, `adapters/` — реальный seam. Слабые места: `App.tsx` — god-component (292 строки, 5 сигналов, 3 режима), `realVite.ts` мешает 6 ответственностей и трогает `globalThis`. Нет lint-правила, запрещающего `solid-js` в `adapters/`. |

---

## Сквозные архитектурные темы (приоритет ↓)

### 1. Shallow pretender seams

Несколько мест выглядят как принципиальная декомпозиция, но проходят тест на удаление как pass-through:

- `MemoryVfs` обёртывает `MemoryBackend` (vfs)
- `buffer-prototype.ts` обёртывает один-единственный консьюмер `buffer.ts` (io)
- `MemorySyncVfs` дублирует логику `@rifty/vfs.normalizePath` (runtime-js)
- `CjsLoaderDeps`/`EsmLoaderDeps` передают всю поверхность лоадера ради одного метода
- `realVite.ts` adapter — 262-строчная процедура из 6 ответственностей

**Симптом одинаковый:** файл создан для разделения concerns, но единственный консьюмер — соседний файл.

### 2. Streams — слабое место всей пирамиды

io-streams ниже Node-контракта. Это каскадно сдерживает четыре модуля:

- `shell` буферизует stdout строкой — не сможет показать прогресс `npm install` в M9
- `terminal` не имеет backpressure-контракта между kernel-stdout и xterm
- `net` outgoing `http.request` буферизует body в `Blob(bodyChunks[])`
- `runtime-wasi` `fd_read` на stdin молча возвращает EOF, потому что нет источника стрима

**Это один корень.** Чинить io-streams — самый большой single-PR win.

### 3. Глобальное состояние в Worker — две дисциплины в одном realm

Kernel имеет `shared-globals.ts` с типизированными publish/read хелперами. Runtime-js пишет в `globalThis`/`self` ad-hoc: `__riftyEsmStash`, `__riftyLastEsmBody`, `__setCreateRequireImpl`, monkey-patch на `Promise.prototype.then` в `process.ts`. Сегодня работает — один Worker. Когда ADR-0011 phase 3 запустит multi-realm координацию (нужно для M11+), эти ключи столкнутся с kernel'овским публикованным `__riftyKernelSyncCall`/`__riftyKernelSyncRing__`.

### 4. «Построено для будущего, но не подключено»

- `BridgedWebSocket` в net — публичный API, ноль callsite
- `shell` — публичный API, ноль callsite
- `setupPreviewBridge` дублируется один-в-один в `devMode.ts` и `realVite.ts`
- ADR-0018 §B обещает subpath-pinning тест — его нет

Рекомендация: либо подключать (закрывает acceptance пункты M7/M9/M10), либо помечать experimental с `console.warn` при первом использовании.

### 5. Realm-переход M11/M12 уже даёт трещины

Два конкретных места уже знают, что текущий код «page-realm only»:

- `service-worker/route-preview.ts:39-57` ищет `Client.type === 'window'` — при переезде Vite в Worker (A-026) silently fall through
- `playground/realVite.ts:84-91` устанавливает globals в `globalThis` страницы — комментарий честно отмечает «future Worker-realm alternative»

Оба места работают, но они **спроектированы под старый мир** и переезд будет вилкой не один день.

### 6. Дисциплина «no silent stubs» соблюдается, кроме одного места

Подавляющее большинство неимплементированного честно `throw NotImplementedError`. Исключения:

- `runtime-wasi`: `WasiOptions.stdin` — типизированный options-параметр, который игнорируется (`fd_read` всегда EOF)
- `io`: `Writable.destroy` не отменяет in-flight `drainBuffer`
- `net`: `IncomingMessage.socket` возвращает hardcoded loopback вместо throw

---

## Топ-5 критичных проблем (по вреду до конца M11)

1. **`worker-entry.ts:102-105` пересоздаёт ModuleLoader на каждый `load-fixture`** — runtime-js. M2 это не видно, M10 (Vite + HMR-стрим обновлений) убьёт производительность. Чинить до начала M10.

2. **io-streams не следуют Node-контракту в нескольких местах** — Duplex/Transform переписывают `this.write` per-instance, `read(n)` игнорирует размер, `pipeline` не destroy'ит upstream. Будет ломать всё, что использует Node-style transform pipelines (vite, npm-client gunzip-untar). Чинить до M8/M10.

3. **`vfs → io` layer leak** ради `NotImplementedError` (`opfs-sync.ts:27`, `package.json:18`). Hard rule violation. Тривиальный фикс (5-строчный класс в `vfs/errors.ts`), но прямо сейчас IRREVERSIBLE-нарушение без ADR.

4. **Routing в service-worker предполагает page-realm; M11 (A-026) сломает silently** — `route-preview.ts:39-57`. Извлечь `PreviewOwnerResolver` стратегию **до** переезда Vite в Worker, не после.

5. **Две копии fetch+integrity+unpack в `installer.ts`** уже разошлись (EINTEGRITY обработка отличается). На fast-path теряются peer-warnings. Drift-hazard растёт с каждым PR.

---

## Топ-7 deepening возможностей (по ROI)

1. **Восстановить io-streams под Node-shape** — `_readableState`/`_writableState` контейнеры, `pipe`/`read`/`write` на прототипе, `pipeline` с настоящим teardown. Один PR — три ниже-уровневых проблемы (shell streaming, terminal backpressure, net buffering).

2. **Извлечь `ModuleHost` интерфейс из `CjsLoaderDeps`/`EsmLoaderDeps`** — одна функция `loadDep(spec, fromFile, esm)`. Становится единственным чокпойнтом для ADR-0015 (shadow-registry) и ADR-0027 (file overlay) — сегодня хуки разбросаны.

3. **Разделить `vfs/sync-mirror.ts`** на `backends/memory-fs-sync.ts` + `vfs/registry.ts`. Registry — единственное, что верхние слои тянут через `/internal`, и логически он не про backend.

4. **Завести `runtime-js/worker-globals.ts`** по образцу kernel. Документированные ключи: `__rifty.require`, `__rifty.import`, `__rifty.esmStash`. Готовит почву для ADR-0011 phase 3 без коллизий.

5. **Granular invalidation в module registry** — `registry.invalidate(id)` вместо `new ModuleLoader()`. Закрывает критичную проблему #1.

6. **Single `PreviewOwnerResolver` strategy в service-worker** — извлечь до переезда Vite в Worker. Минимум кода сегодня, разница между «плавный M11» и «две недели миграции».

7. **Сложить `net.Server` поверх `HttpServer`** — снять два HTTP-парсера и синтетический encode-decode round-trip. Заодно прибраться с двумя `https`-заглушками (`net/https.ts` побеждает, `runtime-js/null-net-stubs.https` дохлый).

---

## Что работает хорошо

- **Layer rule соблюдается.** Только одно нарушение нашлось во всём репо.
- **ADR-дисциплина живая.** Реальные решения, реально применяются, REVIEW_ACTIONS отслеживается.
- **Honest NotImplementedError.** Минимум silent stubs, документированная compat-matrix.
- **runtime-wasi — образцово.** Одна dep, узкий публичный API, syscalls по spec'у. preview2-readiness не аспирационная.
- **kernel sync-IPC.** SAB ring + dispatcher — единственная wire-format в одном месте, версионирование настоящее (ADR-0032), не декоративное.
- **playground D-002 isolation.** `solid-js` за пределами `apps/playground` — ноль импортов. `adapters/` — реальный seam, не аспирационный.

---

## Архитектурные решения

Классификация по reversibility CLAUDE.md: **I** = IRREVERSIBLE (требует ADR + явное согласие пользователя), **R** = REVERSIBLE (можно начать с `TODO(ADR)` маркером).

Из всех находок только две — IRREVERSIBLE и требуют явного выбора. Остальные — straightforward refactors, идут как обычная работа.

### Принятые решения (2026-05-26)

**D-B [I]: io-streams Node-shape restoration — полная реставрация одним PR в M10.**
Затрагивает публичный API `@rifty/io` (Readable/Writable/Duplex/Transform/pipeline).

**Выбор:** A — один большой PR до Real Vite demo. Существующие streams unit-тесты переписываются как часть PR (test-first, per CLAUDE.md hard rule «никогда не редактировать тест чтобы код прошёл» — здесь тесты *дополняются* под Node-семантику, существующие assertions остаются как baseline).

**Скоуп PR (минимум — то, что найдено в ревью):**
- `Duplex`/`Transform` — конструкторы перестают per-instance ребиндить `write`/`end`; вся диспатчеризация через прототип (см. секцию io в Приложении).
- `Readable` — `_readableState` + честный `read(n)`; `flow()` перекачивает `_read` между flush'ами.
- `Writable` — `destroy()` отменяет in-flight `drainBuffer`, флипает `finished`.
- `pipeline` — destroy upstream при любой ошибке цепочки (Node `cleanup` контракт).
- `EventEmitter` — эмитит `removeListener` meta-event (нужно `Readable.pipe` Node-style).

**Требует нового ADR:** `docs/adr/00NN-io-streams-node-contract.md`. Должно быть до A-008 (esbuild.wasm push в M11) — esbuild через WASI требует stdio как Node-streams, текущая реализация будет undefined behaviour для bin'ов читающих stdin.

**D-D [I]: `BridgedWebSocket` — wire в HMR прямо сейчас.**
Затрагивает публичный API `@rifty/net`. **Выбор:** A.

**Скоуп:**
- `apps/playground/src/adapters/preview-bridge.ts` подключает `BridgedWebSocket` для cross-realm WS frames (HMR client'у в preview iframe).
- E2E test: `tests/e2e/m10-hmr.spec.ts` — `npm run dev` + edit file → preview iframe получает HMR-update без перезагрузки.
- **Закрывает ADR-0017 phase 1 acceptance** — пометить в `docs/adr/0017-net-scope-and-streaming-rewrite.md`. Нового ADR не нужно (acceptance был открыт).
- M11 A-026 (Vite в Worker) переиспользует тот же `BridgedWebSocket` — миграционный день сэкономлен.

### REVERSIBLE — идёт без отдельного решения (`TODO(ADR): Q-...` маркер, потом merge)

| Где | Что | Когда | Tier |
|---|---|---|---|
| `packages/vfs/src/errors.ts` (новый) | inline `NotImplementedError`, убрать `@rifty/io` dep из `vfs/package.json` | сразу, отдельный PR | 4 |
| `apps/playground/src/adapters/shell-adapter.ts` (новый) | adapter подключения `@rifty/shell` к playground UI (отдельная сессия, не режим в `App.tsx`) | M10 demo polish | 0 |
| `packages/shell/src/shell.ts` | `&&`/`||`/`;` chains parser; redirect throws на bad position; streaming writer вместо sync `+=` | M10 demo polish | 0 |
| `packages/runtime-js/src/module-loader/registry.ts` + `worker-entry.ts:102` | `registry.invalidate(id?)` — без `id` full reset (для `.reset` команды), с `id` точечная инвалидация (для file-update hot path) | до M10 demo | 1 |
| `packages/npm-client/src/installer.ts` | extract `fetchAndUnpackToCache(spec, integrity?)` — single source of truth для fast-path и live-path | сразу | 1 |
| `packages/service-worker/src/route-preview.ts` | `PreviewOwnerResolver` strategy interface; default = текущая first-window logic; M11 A-026 свапает на worker-owner resolver | до M11 A-026 | 2 |
| `packages/runtime-js/src/worker-globals.ts` (новый) | owner-таблица globals по образцу kernel `shared-globals.ts`: `__rifty.require`, `__rifty.import`, `__rifty.esmStash` | до M11 A-026 | 2 |
| `apps/playground/src/adapters/realVite.ts` | JSDoc-карта 6 ответственностей; полный split — при переезде в Worker realm (M11 A-026) | сейчас минимум | 1 |
| `packages/runtime-wasi/src/syscalls/fd.ts` | wire `WasiOptions.stdin` через `Readable` (паттерн как у stdout) | M11 esbuild.wasm push | 3 |
| `packages/net/src/http/request.ts` | `IncomingMessage.socket` — либо real-shape minimal object с `remoteAddress`/`localAddress` через SW client info, либо throw на access | M11 | 3 |

### Промптирующие follow-ups (без действий сейчас)

- `App.tsx` god-component split — Tier 4, через `usePlaygroundMode()` hook в `adapters/`. Желательно перед началом M11 UI работы (не блокирует M10).
- Buffer split на `buffer.ts` + `buffer-prototype.ts` — Tier 4, паттерн против ADR-0033. Объединить, оставить `buffer-codec.ts`.
- Process shim из `kernel/worker-entry.ts:138-161` — Tier 4, переехать в runtime-js. Часть более широкой M11 cleanup'ы.
- Two PID spaces — Tier 4, unify nextPid allocator. M11 cleanup.

---

## Приложение: per-module находки

### vfs

**Layer violation:** `opfs-sync.ts:27` импортирует `NotImplementedError` из `@rifty/io`. `package.json:18` делает зависимость permanent. Vfs — нижний слой, io — сосед справа в layer-диаграмме. Тривиальный фикс — инлайн класса в `vfs/errors.ts`.

**Sync-mirror перегружен:** `sync-mirror.ts` совмещает `MemoryFsSync` adapter и **process-wide mutable registry** (`activeSync`/`activeAsync` + `setSyncMirror`/`syncMirror`/`installMemoryFs`/`installOpfsFs`). Регистри — единственный singleton в нижнем слое, импортируется из `shell`, `runtime-wasi/syscalls/fd.ts`, `runtime-js/builtins/fs-sync-mirror.ts`. Разделить.

**Backend pluggability shallow:** `boot.ts:18-19` статически импортирует и `OpfsVfs`, и `installOpfsFs`. In-memory test-build всё равно тянет OPFS-код. Реестр `registerBackend('opfs', factory)` решил бы проблему.

**Path-normalization invariant — by convention, не by seam:** объявлен в `types.ts:30-37` и `fs-sync.ts:11-15`, но применяется отдельно в каждом методе (16+ `normalizeAbsolute(path)` call-сайтов). Три разных конвенции: `normalizeAbsolute` (memory), `normalizePath` (opfs-sync), ничего (opfs). Применимо к seam как декоратор.

**OPFS sync/async drift:** `OpfsFsSync` держит собственный warm `index` Map (`opfs-sync.ts:81`); записи через async `OpfsVfs` невидимы до `refreshIndex()`. Два mirror'а одного OPFS-состояния.

### io

**Buffer split — антипаттерн ADR-0033:** `buffer.ts` импортирует `installCoreMethods`/`installIntMethods`/`installExtraMethods` из `buffer-prototype.ts`. Декларации в `buffer.ts:35-117` shadow реальные импл в `buffer-prototype.ts:31-465`. ADR-0033 цитирует именно этот паттерн как анти-пример. Свернуть в один файл, `buffer-codec.ts` оставить (используется и Buffer'ом, и будущим string_decoder).

**Streams: Duplex/Transform нарушают Node-контракт:** `streams/duplex.ts:11-30` Duplex наследуется от Readable и хранит `writableSide: Writable`, затем **перепривязывает `this.write` и `this.end` как instance properties** в конструкторе. `Transform` потом **снова** перепривязывает (`transform.ts:33-65`). Subclass'у, который вызывает `super({})` и присваивает options позже, работать нельзя — это документированный hazard в тесте.

**`Readable.read(n)` ломает контракт:** `readable.ts:69-77` — `read()` игнорирует `n`, возвращает null без перепланирования `_read`. `flow()` эмитит `data` через `queueMicrotask` без перекачки `readImpl` между flush'ами.

**EventEmitter не эмитит `removeListener`:** `event-emitter.ts:70-86`. Node-контракт нарушен, тесты не покрывают. `Stream.Readable.pipe` в Node полагается на этот meta-event.

**`pipeline` не destroy'ит upstream:** `pipeline.ts:24-29`. Node гарантирует cleanup всей цепочки при ошибке любого звена; у нас readable продолжает push'ить в мёртвый writable.

**`Writable.destroy` не отменяет in-flight `drainBuffer`:** `writable.ts:135-139`. Эмитит `error`+`close`, но не флипает `finished`/не отменяет queued microtasks.

### kernel

**Process shim в kernel:** `worker-entry.ts:138-161` ставит минимальный `process` shim на `globalThis` (pid/ppid/argv/env/cwd/exit/stdout/stderr) с комментарием «Phase 2's runtime-js layer will replace this». Это работа runtime-js, kernel не должен знать про Node-`process`. Извлечь `ProcessShimInstaller` интерфейс.

**Duplicated `isWorkerRealm`:** `worker-entry.ts:270-274` и `ipc/sync-client.ts:89-99` — структурно идентичны. Сложить в `internal/`.

**Module-load handshake вместо DI:** static cycle `kernel-dispatcher ↔ spawn-worker` разорван `setKernelRecursiveSpawn(fn)` runtime handshake'ом в `spawn-worker.ts:281`. Работает, но load-order-sensitive. Заменить на constructor injection при `getKernelDispatcher`.

**Два PID-пространства:** `ProcessManager.nextPid` с 2, `recursive-runner.ts:48` с `0xC0000000`. Nested-execSync дети невидимы в `globalProcessManager.list()`. Унифицировать.

### runtime-js

**ModuleLoader пересоздаётся per-keystroke:** `worker-entry.ts:102-105` — каждый `load-fixture` создаёт `new ModuleLoader()`, что в `createModuleLoader` создаёт `new ModuleRegistry()` — сбрасывает резолвленные+исполненные модули. M2 невидимо, M10 (Vite) убьёт.

**Ungoverned globals:** `module.ts` хранит `let createRequireImpl: ((from) => RequireFn) | null = null`, сетится через `worker-entry.ts:41` `__setCreateRequireImpl`. `esm.ts:40-91` stash'ит трансформированное body на `globalThis.__riftyEsmStash`, `__riftyLastEsmBody`, `__riftyLastEsmFile`. `worker-entry.ts:35-39` пишет `require` и `__riftyImport` на `self`. `process.ts:57-77` monkey-patch'ит `Promise.prototype.then`. Нет ADR, нет owner-таблицы. Создать `runtime-js/worker-globals.ts` по образцу kernel.

**`CjsLoaderDeps`/`EsmLoaderDeps` — leaky:** `loader.ts:34-87` пакует registry + resolver + 3 хелпера в `deps` объект, исполнители знают всю поверхность ради одного метода. Заменить на `{ loadDep(spec, esm): T }`.

**`readResolvedById` round-trip:** `loader.ts:88-97` вызывает `resolver.resolve(id, { fromFile: id, esm: false })` чтобы прочитать файл по абсолютному пути. Комментарий «self-import» признаёт смелл.

**Subpath-pinning тест отсутствует:** ADR-0018 §B обещает тест, фиксирующий экспорты `./builtins/process|timers|buffer|module|fs-watch`. `packages/runtime-js/tests/` не существует.

### runtime-wasi

**Образцовый пакет.** Одна workspace-dep, три публичных имени (`Wasi`, `WasiExit`, `runWasi`), syscalls сгруппированы по WASI preview1 spec (`fd.ts`, `path.ts`, `proc.ts`, `shared.ts`), zero `any`/`@ts-ignore`. `errToWasiErrno` — единственная mapping-таблица. preview2-readiness реальная: import-namespace явный, factories-pattern идентичен компонентам.

**`opts.stdin` — wire-fiction:** `WasiOptions.stdin` объявлен (`wasi.ts:23`), но `fd_read` на stdin безусловно возвращает EOF (`fd.ts:108-112`). Нарушение «no silent stubs».

**Нет интеграции с kernel/PID:** `Wasi.start()` исполняет гостя в стеке хоста (`wasi.ts:81-91`). Нет PID, нет cwd из process-record, нет signal handling. M8 acceptance «WASI bin from shell as a normal program» недостижим без kernel-bridge.

**`fd_readdir` сообщает `FILETYPE_UNKNOWN`** (`fd.ts:285`). Toolchain'ы re-stat'ят, удваивая syscall-трафик.

### net

**`net.Server` re-encode'ит HTTP через fake socket:** `net.ts:97-177` парсит фейковый wire-format поверх своего же сокета, прогоняя байты через два парсера. `http/server.ts:18-44` делает то же самое нативно. Если `net.Server` — pure compat shim под Node API, маршрутизировать через `HttpServer`.

**`BridgedWebSocket` — собран, не подключён:** `ws/bridge.ts:243-248`. ADR-0017 phase 1 acceptance: «iframe HMR client connects via cross-realm bridge». Ноль callsite в `apps/`, `service-worker/`. Либо подключить, либо помечать experimental.

**Две заглушки `https`:** `packages/net/src/https.ts:21-39` (ADR-0010 loud throw) и `packages/runtime-js/src/builtins/null-net-stubs.ts:72-80` (dead, не регистрируется). Удалить вторую.

**`request()` использует `new Blob(body…)`** (`http/server.ts:83-127`) — outgoing streaming убит. Противоречит ADR-0017 направлению.

**`IncomingMessage.socket` — hardcoded loopback** (`http/request.ts:28-38`). Express'овский `req.ip` соврёт. Тихий стаб, должен бросать.

### service-worker

**Routing assumes page realm:** `route-preview.ts:39-57` ищет `Client.type === 'window'`. M11 (ADR-0025 + A-026 Vite в Worker) silently fall through на deprecated first-window path. Извлечь `PreviewOwnerResolver` стратегию до переезда.

**`nextRequestId` — module-global mutable:** `route-preview.ts:26`. Разделён между всеми `createPreviewInterceptor()` инстансами. Сложить в registry.

**Validation asymmetry per ADR-0031:** `sw.ts:24-48` валидирует ping-frame version на границе, но `preview-bridge.ts:109-117` отдаёт `ready`/`goodbye` фреймы в registry без проверки version — registry проверяет внутри. Симметрия с `setupPreviewBridge:174` нарушена.

**`controllerchange`-driven goodbye задокументирован, не реализован:** `protocol.ts:51-54` JSDoc заявляет, `sw.ts` не имеет hookup. Crashed tab оставляет ghost в ready-set.

### npm-client

**Две копии fetch+integrity+unpack:** `installer.ts:96-121` (fast path) и `:189-211` (live resolve) — одинаковый pipeline cache → fetch → verify integrity → write cache → `extractTarGz`. Разошлись поведенчески: fast path бросает `EINTEGRITY`, live path молча reuse'ит cache-hit bytes. Извлечь `fetchAndUnpackToCache()`.

**Peer-warnings пропадают на fast-path:** `warnUnsatisfiedPeers` вызывается только в live-resolve return (`installer.ts:237`), v3 lockfile не хранит `peerDependencies`. Либо персистить, либо считать с packument на fast-path.

**`resolveDep` смешивает 6 фаз** в 95-строчном замкнутом методе (`installer.ts:135-230`). Разделить `decidePin()` (override + packument + pickBest + conflict-detect) и `materialise(pin)` (fetch + integrity + unpack).

**`subgraphFreeOfOverrideDivergence`** «slightly more aggressive than strictly necessary» (комментарий) — не учитывает parent-scoped overrides формата `"a > b": "..."`.

### shell

**Ноль consumers:** `packages/shell` объявлен dep'ом в `apps/playground/package.json:21`, но не импортирован нигде в `apps/playground/src/*`. TASKS.md:164 помечено `[x]`, реально M9/M10 wiring отсутствует.

**Writer — sync `+=`:** `types.ts:8-9`, `shell.ts:121-134`. `stdout/stderr` — string accumulation, `Shell.run` возвращает blob после `await`. `npm install` прогресс-бары, `vite dev` request logs не дойдут до terminal.

**`cd` через privileged closure:** `shell.ts:48`, `types.ts:12`. `cd` мутирует state через closure, которая видна только builtin'ам. `registerCommand`-пользователи видят `ctx.cwd` снапшотом. Поднять до `ctx.setCwd()`.

**Нет интеграции с `kernel.spawn`:** `ShellCommand` контракт — pure `(args, ctx) → exitCode`. Нет shape'а под «найти exe в PATH → kernel.spawn → wire stdio».

**Redirect detection — позиционный:** `shell.ts:104-113` смотрит на последние два токена; `echo a > /f b` не редиректит, `2>&1` молча трактуется как arg. Должно бросать.

**`&&`/`||`/`;` silently dropped:** `cd app && npm install` → exit 127.

### terminal

**PTY abstraction обещана, не существует:** `types.ts:1` (`TerminalStream = 'stdout' | 'stderr'`) vs PROJECT_PLAN §122 («PTY abstraction»). Нет Readable/Writable, нет master/slave, нет resize signal, нет SIGWINCH.

**Нет backpressure:** `terminal.ts:84` — `write(data, stream)` — синхронный push в `xterm.write`. M1 acceptance «стрим вывода не блокирует UI» проходит по случайности (xterm внутри буферизует).

**`handleInput` — public async ради тестов (A-041):** `terminal.ts:109`. «Production callers should not invoke this» — задокументированный silent contract.

**`busy` flag — hand-rolled mutex** (`terminal.ts:49, 121, 172-178`). Дропает каждое keystroke во время команды, нет очередей паста, arrow-up while busy потерян.

**`write()` делает newline-rewriting per call** (`terminal.ts:85`) даже при `convertEol: true` (`terminal.ts:58`). Double work.

### playground

**Адаптеры — реальный seam.** `apps/playground/src/adapters/` — единственное место между Solid и core. `useRuntime.ts`, `devMode.ts`/`realVite.ts`, `sync-mirror-vfs.ts`. Zero Solid signals в adapter-файлах.

**`App.tsx` — god-component:** 292 строки, 5 сигналов, 4 callback'а, 3 режима (`'repl' | 'dev' | 'real-vite'`) inline, mode machine + inline styling + orchestration. Извлечь `usePlaygroundMode()` hook в `adapters/`.

**`App.tsx:52-54` пишет в terminal at render time** — side effect вне `createEffect`/`onMount`, при remount стрельнёт повторно.

**`realVite.ts` — 262 строки, 6 ответственностей:** install globals → seed project → install packages → overlay shims → build loader → bridge SW. 4 `as unknown as` cast'а, module-global `globalsInstalled` флаг. Реальный долгосрочный дом — выделенный Worker realm (ADR-0025).

**`useRuntime.ts:39` потенциально утечка listener'ов:** `attach()` вызывается из конструктора и из reset/handleLine, без disposal'а старой `on()` подписки.

**Дублированный preview-bridge wiring:** `devMode.ts:67-84` ≈ `realVite.ts:213-232`. Вынести в `adapters/previewBridge.ts`.

**Нет lint-правила:** `no-restricted-imports` для `solid-js` существует только на packages/, не на `apps/playground/src/adapters/`. Дисциплина — convention only.
