# WebContainer Clone — Project Plan

> Учебный пет-проект: браузерный Node-совместимый рантайм + WASI-runner для нативных бинарей. Цель — глубокое понимание устройства таких систем, путь к "Express + npm install в браузере" за ~год работы по вечерам.

---

## 1. Цели и не-цели

### Цели
- Понять, как устроены системы вида WebContainers/StackBlitz изнутри
- Получить работающий рантайм, способный запускать реальные Node-программы (Express, CLI-инструменты на pure JS)
- Прокачать архитектурные навыки: слои, изоляция, контракты, эмуляция системных API
- Параллельно изучить WASI как отдельный модуль (запуск esbuild/sqlite — настоящие WASI-бинарники; `@esbuild/wasi-preview1` импортирует только `wasi_snapshot_preview1` — см. ADR-0047, реверс ADR-0044)
- Вести devlog — серия глубоких технических статей

### Не-цели (по крайней мере на первый год)
- Полная Node-совместимость (это бесконечный путь)
- Поддержка нативных модулей через node-gyp
- Production-ready performance
- Поддержка всех браузеров (целимся в свежий Chrome/Edge — нужен OPFS SyncAccessHandle в Workers)
- Свой JS-движок (используем браузерный V8)

---

## 2. Архитектура: основные принципы

### Стратегические решения
1. **Браузерный V8 как основной JS-движок** — путь StackBlitz. Производительность и tooling несравнимо лучше QuickJS-в-WASM.
2. **WASI — отдельный рантайм для нативных бинарей**, не для основного исполнения JS. Полезен для esbuild/sqlite/python (esbuild публикует настоящий WASIp1-билд `@esbuild/wasi-preview1` — см. ADR-0047, реверс ADR-0044; Go-bridge `gojs` остаётся отложен для будущих Go-гостей, но для esbuild больше не нужен).
3. **Web Workers как процессы.** Каждый "процесс" Node = отдельный Worker со своим JS-контекстом.
4. **Service Worker для виртуальной сети.** Перехват fetch, маршрутизация в "слушающие" воркеры.
5. **OPFS (Origin Private File System) — основной storage backend** для VFS. Даёт sync API в Workers через `FileSystemSyncAccessHandle`.
6. **VFS как чистый интерфейс**, in-memory backend для тестов и dev, OPFS — для прода.

### Слои
```
┌─────────────────────────────────────────┐
│  apps/playground  (UI: editor + term)   │
├─────────────────────────────────────────┤
│  shell, terminal, npm-client            │  ← high-level features
├─────────────────────────────────────────┤
│  runtime-js (Node API)  runtime-wasi    │  ← language runtimes
├─────────────────────────────────────────┤
│  kernel (processes, scheduling, IPC)    │  ← core
├─────────────────────────────────────────┤
│  vfs   io   net (+ service-worker)      │  ← system primitives
└─────────────────────────────────────────┘
```

**Правило зависимостей:** только сверху вниз. Никаких обратных импортов. Каждый слой имеет публичный API в `index.ts`.

**Правило UI-изоляции (D-002):** UI-фреймворк используется только в `apps/playground/`. Все пакеты в `packages/` — framework-agnostic. Это обеспечивает замену UI без переписывания ядра.

### Изоляция и контексты
- **Main thread:** UI, оркестратор процессов, Process Manager (PID-таблица), управление SW
- **Web Worker (на процесс):** runtime-js + пользовательский код + его модули
- **Service Worker:** перехват fetch, RPC-роутер между запросами и воркерами
- **(Опционально позже) iframe:** превью приложения, безопасный рендеринг HTML от пользователя

### Каналы коммуникации
- Main ↔ Worker: `MessageChannel` для async, `SharedArrayBuffer` + `Atomics` для синхронных вызовов (см. D-001)
- Worker ↔ Worker (pipes): `MessageChannel` напрямую через `Transferable`
- Main ↔ Service Worker: `postMessage` + `MessageChannel`
- Браузер → SW → Worker: fetch перехватывается, сериализуется в RPC-запрос, ответ возвращается через ReadableStream

### Требование к окружению: cross-origin isolation
Страница playground должна быть в состоянии `crossOriginIsolated === true` (см. **D-001**). Это даёт `SharedArrayBuffer`, `Atomics.wait` в Worker'ах, и является фундаментом для sync IPC (нужен в M6+). Все ресурсы (xterm, Monaco, шрифты) — локальные или с правильными CORP-заголовками. Сторонние CDN при необходимости проксируются через свой origin.

---

## 3. Структура репозитория

```
webcontainer-clone/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json                    # линтинг + форматирование (или eslint+prettier)
├── vitest.workspace.ts
├── playwright.config.ts
├── README.md
├── CLAUDE.md                     # ⚡ инструкции для AI-агента (см. §6)
│
├── docs/
│   ├── adr/                      # Architecture Decision Records
│   │   ├── 0001-monorepo-pnpm.md
│   │   ├── 0002-opfs-as-primary-backend.md
│   │   └── ...
│   ├── devlog/                   # посты по этапам
│   └── compat/                   # matrix совместимости (генерируется тестами)
│
├── packages/
│   ├── vfs/                      # интерфейс ФС + backends
│   │   ├── src/
│   │   │   ├── types.ts          # VFS interface
│   │   │   ├── memory.ts         # in-memory backend
│   │   │   ├── opfs.ts           # OPFS backend
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── io/                       # streams, pipes, stdio abstractions
│   ├── kernel/                   # process manager, PID, signals, scheduling
│   ├── runtime-js/               # Node-совместимый рантайм поверх V8
│   │   ├── src/
│   │   │   ├── worker-entry.ts   # точка входа в Worker
│   │   │   ├── module-loader/    # CJS + ESM resolver
│   │   │   ├── globals/          # process, Buffer, console
│   │   │   ├── builtins/         # node:fs, node:path, node:http, ...
│   │   │   └── event-loop/       # nextTick, timers, microtasks
│   │   └── ...
│   ├── runtime-wasi/             # WASI preview1 shim
│   │   ├── src/
│   │   │   ├── shim.ts
│   │   │   ├── syscalls/
│   │   │   └── preopens.ts
│   │   └── ...
│   ├── net/                      # net.Socket, net.Server, http
│   ├── service-worker/           # SW: fetch interceptor, port registry
│   ├── npm-client/               # resolver, fetcher, unpacker, linker
│   ├── shell/                    # минимальный bash-like shell
│   └── terminal/                 # xterm.js glue, PTY abstraction
│
├── apps/
│   ├── playground/               # основной UI
│   └── benchmarks/               # стенд для бенчей
│
├── examples/                     # фикстуры для test-driven подхода
│   ├── hello-c/                  # минимальный WASI binary
│   ├── express-hello/            # цель милстоуна M7
│   ├── npm-pkg-fixtures/         # реальные пакеты (chalk, commander, ...)
│   └── vite-app/                 # цель M10
│
├── tools/
│   ├── shadow-registry/          # подменные WASM-сборки нативных пакетов
│   ├── registry-proxy/           # CORS-прокси для npm registry (dev)
│   └── node-parity-runner/       # ⚡ запускает код в реальном Node и в нашем рантайме, диффает (см. §5)
│
└── tests/
    ├── conformance/              # ⚡ ключевые тесты соответствия Node API
    │   ├── fs/
    │   ├── path/
    │   ├── http/
    │   └── ...
    ├── integration/              # запуск реальных npm-пакетов
    ├── e2e/                      # playwright по playground'у
    └── harness/                  # утилиты: parity-runner, diff, snapshot
```

### Конвенции
- Каждый пакет в `packages/` экспортирует через `src/index.ts`. Прямые импорты из `src/internal/*` запрещены извне.
- Каждый пакет содержит `README.md` с описанием публичного API и `CHANGELOG.md`.
- Tests рядом с кодом (`*.test.ts`) для unit, отдельная папка `tests/` для интеграционных.
- TypeScript strict mode везде, `noUncheckedIndexedAccess: true`.
- Никаких циклических зависимостей (проверяется `madge` в CI).

---

## 4. Roadmap и милстоуны

Структура: **милстоун = группа этапов, заканчивающаяся демонстрируемым результатом**. Каждый милстоун имеет приёмочный сценарий (acceptance criteria) — это то, что проверяет тест и что можно увидеть глазами.

| # | Милстоун | Что работает | Время |
|---|---|---|---|
| M0 | Foundation | Монорепо, UI, терминал, пустой Worker, пустой SW | 1-2 нед |
| M1 | JS Execution | `console.log('hi')` в Worker, REPL в xterm | 1-2 нед |
| M2 | Modules | `require('./other')` работает, CJS + базовый ESM | 2-3 нед |
| M3 | Node Core | process, timers, event loop, базовые built-ins | 3-4 нед |
| M4 | FileSystem | fs API, OPFS backend, sync & async | 3-4 нед |
| M5 | Streams & IO | Streams работают, pipes между процессами | 2-3 нед |
| M6 | Processes | child_process.spawn, дерево процессов, IPC | 3-4 нед |
| M7 | Network | net + http, Service Worker bridge, Express бежит | 4-5 нед |
| M8 | WASI Runner | esbuild.wasm работает как процесс через `@esbuild/wasi-preview1` (ADR-0047, реверс ADR-0044) | 2-3 нед |
| M9 | npm install | Реальная установка пакетов с registry | 3-4 нед |
| M10 | Real Tooling | Vite-like dev server в браузере; real express@4 + vite@5 бегут in-process (✅ ADR-0050) | 4-6 нед |
| M11 | post-M10 follow-ups | Vite-in-Worker (ADR-0043 ✅), nested install (ADR-0042 ✅), fork-IPC через Worker (ADR-0045 ✅), SW→Worker direct routing (A-023 / Q-2026-05-27-002), streaming cross-realm preview, lockfile reuse, esbuild.wasm vendoring (✅ ADR-0047), native-dep install policy (✅ ADR-0051) | 2-3 нед |
| M12 | opencode server facade (proposed) | Запуск anomalyco/opencode как headless Effect-сервера в rifty до tool-execution-потолка. **No-vendored-tree slice реализован и зелёный** (TS-on-import ✅ ADR-0052/0053; Effect↔node:http ✅ ADR-0054; SSE-over-HTTP ✅ ADR-0055; F09 tool-ceiling marker). Остальное blocked на вендоринге opencode → Spike C → решение WASM-SQLite. См. `docs/opencode/README.md` | TBD |

---

### M0 — Foundation
**Этапы:** 0
**Когда готово:** есть рабочий dev-сервер, открывается страница с редактором (Monaco) и терминалом (xterm.js). Пустой Web Worker стартует по кнопке "Run", пишет в консоль "worker alive". Service Worker зарегистрирован, ничего не делает.

**Acceptance:**
- [ ] `pnpm dev` поднимает playground на localhost
- [ ] В UI виден редактор, терминал, кнопка "Run"
- [ ] При клике "Run" Worker стартует и шлёт сообщение в main thread
- [ ] Service Worker зарегистрирован (виден в DevTools → Application)
- [ ] CI прогон зелёный (lint + typecheck + пустые тесты)

**Инфраструктура, которая появляется:** pnpm workspace, TS, Vite, Vitest, Playwright, Biome, GitHub Actions, базовый CLAUDE.md.

---

### M1 — JS Execution
**Этапы:** 1
**Когда готово:** в терминале можно набрать JS-выражение и увидеть результат. Console.log/error прокидывается из воркера в xterm с разделением stdout/stderr. Браузерные capabilities детектятся при старте (см. D-006).

**Acceptance:**
- [ ] `> 1 + 1` в терминале → `2`
- [ ] `> console.log('hi'); console.error('err')` → видно оба, разными цветами
- [ ] `> throw new Error('boom')` → traceback виден
- [ ] Worker безопасно перезапускается по команде `> .reset`
- [ ] Стрим вывода работает (длинный `for` с console.log не блокирует UI)
- [ ] **Capabilities-detection при старте:** проверяет `crossOriginIsolated`, `SharedArrayBuffer`, `FileSystemSyncAccessHandle`, `Atomics.waitAsync`; показывает понятное сообщение если чего-то нет

**Тесты:**
- Unit: контекст исполнения, capture console
- E2E (playwright): ввод в терминале → ожидаемый вывод

---

### M2 — Modules
**Этапы:** 2, 3, 4
**Когда готово:** в VFS можно положить несколько файлов, главный делает `require('./util')` и получает экспорт. Node module resolution работает (включая `node_modules` walk-up). Базовый ESM работает.

**Архитектура загрузчика — см. D-003:** общий резолвер для CJS+ESM, парсинг ESM через `es-module-lexer`, исполнение через `new Function`/`async function`, module registry с live bindings.

**Acceptance:**
- [ ] CJS: `require('./other.js')`, `require('./other')` (без расширения), `require('./dir')` (через index.js)
- [ ] Node algorithm: walk-up по `node_modules`
- [ ] `package.json` поля `main`, `exports` (conditional exports — хотя бы `node`/`default`/`import`/`require`)
- [ ] ESM: статический `import`, динамический `import()`
- [ ] Top-level await работает (модуль = async function)
- [ ] Live bindings: реэкспортированное значение видит обновления (как в Node)
- [ ] Циклические зависимости не падают (и для CJS, и для ESM)
- [ ] CJS ↔ ESM интероп: ESM может импортировать CJS; CJS грузит ESM только через `import()`
- [ ] **Тест на реальном пакете:** `lodash` (CJS) и `nanoid` (ESM) загружаются из фикстур

**Тесты:**
- Conformance: 30+ кейсов resolution (см. Node docs)
- Conformance: live bindings, top-level await, ESM↔CJS интероп (parity-runner против Node)
- Integration: пара реальных пакетов из `examples/npm-pkg-fixtures/`

---

### M3 — Node Core
**Этапы:** 5, 6, 7
**Когда готово:** `process.env.NODE_ENV`, `process.cwd()`, `setTimeout`, `setImmediate`, `process.nextTick` работают с правильной семантикой. Базовые built-ins подключены.

**Acceptance:**
- [ ] `path`, `url`, `querystring`, `util`, `events`, `buffer`, `assert` — все основные методы работают
- [ ] `process.nextTick` исполняется ДО Promise.then (правильный порядок)
- [ ] `setImmediate(fn)` исполняется после I/O-таска, но до setTimeout(fn, 0) в типичном случае
- [ ] `EventEmitter` поддерживает on/off/emit/once
- [ ] **Real-package test:** `chalk` работает (`chalk.red('hi')` даёт ANSI-строку)

**Тесты:**
- Parity-runner: 100+ кейсов на каждый builtin, сравнение с реальным Node
- Order tests на event loop: чёткие сценарии "nextTick before Promise"

---

### M4 — FileSystem
**Этапы:** 8 (частично), 9, 10
**Когда готово:** `fs.readFileSync`, `fs.writeFileSync`, `fs.promises.readFile`, `fs.readdirSync` работают поверх OPFS. Persistent: после reload файлы на месте.

**Acceptance:**
- [ ] Sync API через OPFS SyncAccessHandle (внутри Worker)
- [ ] Async API + promises
- [ ] `mkdir -p` семантика для `fs.mkdir({ recursive: true })`
- [ ] `fs.stat` возвращает корректные `size`, `isFile`, `isDirectory`
- [ ] **Persistent storage:** записал файл → перезагрузил страницу → файл на месте
- [ ] Streams: `createReadStream`/`createWriteStream` через VFS

**Тесты:**
- Conformance: дублируем 50+ тестов из Node test suite по fs
- Persistence test (e2e): запись → reload → чтение

---

### M5 — Streams & IO
**Этапы:** 8 (полностью)
**Когда готово:** readable-stream интегрирован, pipes работают, backpressure корректен.

**Acceptance:**
- [ ] `Readable`/`Writable`/`Duplex`/`Transform`
- [ ] `pipeline()` и `pipe()` с правильным cleanup
- [ ] Async iterators: `for await (const chunk of readable)`
- [ ] Object mode
- [ ] Backpressure: пишем большой файл, видим `drain` events
- [ ] **Real test:** `fs.createReadStream('big.txt').pipe(fs.createWriteStream('copy.txt'))`

---

### M6 — Processes
**Этапы:** 11, 12, 13
**Когда готово:** один процесс может спавнить другой, передавать аргументы, читать stdout, ждать exit code.

**Acceptance:**
- [ ] `child_process.spawn('node', ['script.js'])` — где 'node' это специальный handler в нашем рантайме
- [ ] Pipes: stdout/stderr ребёнка читаются из родителя
- [ ] `exec(cmd, callback)` — обёртка с буферизацией
- [ ] `fork(modulePath)` с IPC через `process.send`/`message` event
- [ ] **Sync subprocess:** `execSync` работает (через SharedArrayBuffer + Atomics)
- [ ] `worker_threads` — параллельная реализация на Web Workers
- [ ] Process tree виден в DevTools/UI

**Тесты:**
- Спавним 10 параллельных процессов, ждём всех
- Pipe-chain: `a | b | c`
- Sync exec не вешает UI (исполняется в worker, не в main)

---

### M7 — Network
**Этапы:** 14, 15, 16
**Когда готово:** Express приложение поднимается, отвечает на запросы из браузера через Service Worker.

**Acceptance:**
- [ ] `net.createServer().listen(3000)` регистрирует endpoint в SW
- [ ] Открываем `https://<host>/preview/3000/` в новой вкладке → видим ответ от user-кода
- [ ] HTTP методы: GET, POST с body, headers
- [ ] Chunked transfer encoding работает (long-polling сценарии)
- [ ] `http.request` (исходящий) через прокси
- [ ] **Real test:** Express "hello world" → видим страницу в браузере
- [ ] **Real test:** Express app с middleware (body-parser, cors) обрабатывает POST с JSON

---

### M8 — WASI Runner
**Этапы:** 17, 18, 19
**Когда готово:** можно запустить WASI-бинарник из shell как обычную программу.

**Acceptance:**
- [ ] Минимальный hello.c → hello.wasm → запускается в playground, выводит в stdout
- [x] esbuild.wasm: `esbuild --loader=ts` через `runWasi` работает, трансформирует TS/JSX из stdin (ADR-0047; `tools/shadow-registry/src/esbuild-binding.ts`, integration `tests/integration/esbuild-wasi-transform.test.ts`)
- [x] esbuild видит preopens и cwd (`AT_FDCWD`) — ADR-0049, реверс гипотезы ADR-0044 о Go-runtime bridge (для esbuild не нужен; `@esbuild/wasi-preview1` — настоящий WASI-бинарь)
- [ ] WASI VFS интегрирована с основной VFS (один источник истины)
- [ ] Бинарник видит preopens (например `/workspace`)

**Тесты:**
- Sanity: hello.wasm у нас и в `wasmtime` дают одинаковый stdout
- esbuild: трансформируем небольшой TS/JSX через `@esbuild/wasi-preview1` под `runWasi`, проверяем что типы вырезаны и JSX опущен (ADR-0047; esbuild вернулся как forcing consumer вместо swc)

---

### M9 — npm install
**Этапы:** 20, 21, 22
**Когда готово:** `npm install express` в shell → пакет в node_modules → можно его require'ить.

**Прокси к registry — см. D-004:** dev через Vite proxy, prod через решение из Q4' (принимается к концу этого милстоуна).

**Acceptance:**
- [ ] Semver resolver: правильно выбирает версии из ranges
- [ ] Скачивает tarballs через сконфигурированный registry URL (без хардкодов)
- [ ] Тесты `npm-client` ходят в локальный mock-registry, не в реальный
- [ ] Распаковывает (pako + tar-stream) в VFS
- [ ] Строит правильную структуру node_modules с dedupe
- [ ] Lockfile (npm v3) генерируется и переиспользуется
- [ ] Postinstall scripts через child_process (опционально, многие пакеты обходятся)
- [ ] Shadow-registry: `npm install bcrypt` → ставится `bcryptjs` (или WASM-bcrypt)
- [ ] **Прод-прокси выбран и развёрнут** (закрывает Q4')

**Тесты:**
- Чистый install простого пакета (`chalk`) → require работает
- Сложный install (`express` с 20+ транзитивных зависимостей) → app поднимается

---

### M10 — Real Tooling
**Этапы:** 23, 24, 25
**Когда готово:** Vite dev server (или эквивалент) запускается, отдаёт HMR в iframe-preview.

**Acceptance:**
- [ ] `npm install vite && npm run dev` запускает Vite
- [ ] Vite ходит в esbuild.wasm через shadow-binding (TS/JSX transform; ADR-0047, реверс ADR-0044 — `@esbuild/wasi-preview1` под `runWasi`)
- [ ] HMR работает через WebSocket-туннель
- [ ] Preview-iframe показывает приложение
- [ ] Изменение в редакторе → видим update в preview без перезагрузки

Это финальный показательный сценарий — "вот оно как у StackBlitz".

---

### M11 — post-M10 follow-ups
**Этапы:** 23.x, 24.x, 25.x (incremental refinements of M10 plus deferred items from M6/M8/M9)
**Когда готово:** все ADR-помеченные «open acceptance» из M6–M10 закрыты или явно отложены с трекером.

Состав (по состоянию на 2026-05-28, аудит 2026-05-27 подтвердил расхождение между ADR-слоем реальности и таблицей §4):
- ✅ **Vite-in-Worker** — ADR-0043 (landed 2026-05-27). Real Vite живёт в kernel-spawned Worker; страница превращается в координатора. Часть M10 «Real Tooling» переехала сюда из практических соображений (cross-origin isolation + heavy WASM не вписывались в page realm).
- ✅ **Nested install для конфликтов версий** — ADR-0042 (landed 2026-05-27). First-wins flat + nest-on-conflict в `walkAndPin`; lockfile fast-path replay через `pinnedEntryForParent`.
- ✅ **Fork-IPC через Worker** — ADR-0045 (landed 2026-05-28). `WorkerProcessHandle.send`/`'message'`/`disconnect` через parent↔child `MessagePort`. Закрывает разрыв «`fork()` returns IPC ✅» из M6 acceptance, который в SAB-пути ранее тихо дропал сообщения.
- ⏳ **SW→Worker direct routing** — A-023 (трекер: `OPEN_QUESTIONS.md` Q-2026-05-27-002). Когда landed, `WorkerOwnerResolver` заменит `FirstWindowOwnerResolver` в `@riftydev/service-worker`, и SW-fetch для `/preview/<port>/*` пойдёт напрямую в worker realm.
- ⏳ **Streaming cross-realm preview** — `bridgeCrossRealmPreview` сейчас buffered-only (`packages/net/src/cross-realm/preview-port.ts:24-29`). Поднимется как только Real Vite начнёт отдавать большие responses (vendor-prebundle, source maps). ADR-0046+ (TBD).
- ⏳ **Lockfile reuse on subsequent `install`** — M9 acceptance, ADR-0023 пометил тактику; код пока регенерирует каждый раз. Закрывается отдельным PR.
- ✅ **esbuild.wasm vendoring** — M8 acceptance. ADR-0047 реверснул ADR-0044 (swc не имеет WASI-билда; `@esbuild/wasi-preview1` — настоящий WASIp1-бинарь). Вендорится build-time скриптом `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs` (pin по версии + integrity), shadow-binding прогоняет real preopens/cwd через `runWasi` (ADR-0049).

Decision (2026-05-27): M11 — это не новая фаза работы, а контейнер для технического долга, оставшегося с M6 / M8 / M9 / M10. Срок 2-3 недели включает только активные работы (SW→Worker — после fork-IPC); deferred-пункты ждут реального триггерного use case.

---

### M12 — opencode server facade (proposed)

**Цель:** запустить anomalyco/opencode (Effect/Bun TS source-граф, НЕ нативный npm `opencode-ai`) как headless server-фасад «без выполнения инструментов» — поднять ~40 Effect-слоёв, отдать тривиальные роуты, создать сессию, сделать один LLM round-trip; spawn / shell / native git/ripgrep / PTY — жёсткий browser/WASI-потолок (out of scope by design). Вердикт фисибилити: `feasible-with-major-work` (medium confidence).

**Статус (2026-05-31): частично реализовано.** Весь срез, не требующий вендоренного дерева opencode, реализован и зелёный:
- ✅ TS-on-import по module-графу — ADR-0052 (transform hook) + ADR-0053 (`.ts`/`.tsx` first-class); gold multi-file `.ts` parity case зелёный (P0 language unit закрыт).
- ✅ Effect `@effect/platform-node` потребляет rifty `node:http` AS-IS — ADR-0054 (additive shape-widening; pipe-sink deferred).
- ✅ SSE-over-streaming-HTTP, без `ws`-шима (page-direct) — ADR-0055.
- ✅ F09 tool-ceiling marker — pure-JS `vfsGrep`, spawn-ceiling conformance, `docs/compat/opencode-tool-ceiling.md`.

**Spike C → WASM-SQLite re-cut в P2 (RATIFIED).** Spike C подтвердил: `Server.listen` строит layer-DAG eagerly и реальный `Database` (`node:sqlite` `DatabaseSync`) открывается+мигрируется на layer-build, поэтому WASM-SQLite перенесён из P4 в **P2 boot-prerequisite**. Движок зафиксирован **ADR-0065**: `sql.js` (pure-JS WASM SQLite, синхронный API, in-memory-first), зарегистрирован как rifty-builtin `node:sqlite` с `DatabaseSync`-совместимой синхронной поверхностью; OPFS-персистентность отложена. ADR-0065 supersedes decisions.md DRAFTS ADR-0055/0056 и исправляет каркас `bun:sqlite`→`node:sqlite`.

**Blocked / deferred** (гейты см. `docs/opencode/README.md`; полный текст ADR-черновиков — `docs/opencode/decisions.md`): headless boot (ADR-0058 draft); v3 SSE frame bump (ADR-0060 draft, противоречит ADR-0048/0017); LLM round-trip + `node:https`→fetch (ADR-0061 draft, supersedes ADR-0010, за C1 https.Agent pre-flight). opencode в репозитории НЕ вендорится.

Критический путь: **вендоринг opencode ✅ → Spike C ✅ → WASM-SQLite `node:sqlite` shim (sql.js, ADR-0065) в P2**.

---

## 5. Стратегия верификации

Это **самая важная часть** при работе с AI-агентом. Без жёсткой инфры тестирования агент будет делать вещи, которые "выглядят правильно" но ломаются в реальности.

### 5.1 Уровни тестирования

| Уровень | Что проверяет | Инструмент | Когда запускается |
|---|---|---|---|
| **Unit** | Изолированную логику внутри пакета | Vitest | На каждом сохранении (watch) + pre-commit |
| **Parity (Node diff)** | Совпадение с реальным Node API | Custom harness + Vitest | Pre-commit + CI |
| **Conformance** | Соответствие документированной семантике Node | Vitest | CI |
| **Integration** | Реальные npm-пакеты в рантайме | Vitest в Worker / Playwright | CI |
| **E2E** | Полный playground через браузер | Playwright | CI (полный прогон) |
| **Smoke** | Базовые сценарии после билда | Playwright | Pre-deploy |
| **Compat matrix** | Сводная таблица "что работает" | Auto-generated MD | После каждого CI |

### 5.2 Главное оружие: Node Parity Runner

Ключевая идея: **у нас есть эталон — настоящий Node**. Большинство ошибок реализации можно поймать автоматически, прогнав один и тот же код в обоих средах и сдиффив результат.

```
tools/node-parity-runner/
├── src/
│   ├── run-in-node.ts        # запускает код в spawn'нутом Node
│   ├── run-in-runtime.ts     # запускает код в нашем рантайме (Worker)
│   ├── diff.ts               # нормализация и сравнение
│   └── cli.ts
└── cases/
    ├── fs/
    │   ├── readFile-basic.case.ts
    │   ├── readFile-encoding.case.ts
    │   └── ...
    └── timers/
        └── nexttick-order.case.ts
```

Пример кейса:
```typescript
// fs/readFile-basic.case.ts
export const setup = {
  files: { '/work/hello.txt': 'world' },
}

export const code = `
  const fs = require('fs')
  const data = fs.readFileSync('/work/hello.txt', 'utf8')
  console.log(JSON.stringify({ data, type: typeof data }))
`

export const expected = { data: 'world', type: 'string' }
```

Harness прогоняет `code` в Node (с pre-setup'ленной директорией) и в нашем рантайме (с VFS preload), сравнивает stdout. Любое расхождение — баг.

**Это золотой стандарт для AI-агента:** агент не может "сжульничать", потому что эталон — внешний.

### 5.3 Conformance тесты

Для случаев, где Node-поведение нельзя/тяжело проверить parity-runner'ом (асинхронные таймеры, edge cases event loop, ошибки), пишем декларативные тесты на конкретное поведение:

```typescript
// tests/conformance/timers/order.test.ts
test('nextTick runs before resolved Promise.then', async () => {
  const order: string[] = []
  await runInRuntime(`
    Promise.resolve().then(() => order.push('promise'))
    process.nextTick(() => order.push('nextTick'))
  `)
  expect(order).toEqual(['nextTick', 'promise'])
})
```

Источники тестов:
- Node.js test suite (`test/parallel/`) — можно адаптировать сотни
- WPT (Web Platform Tests) для веб-частей
- Свои тесты для edge cases, которые мы целенаправленно решили поддержать

### 5.4 Integration: реальные npm-пакеты

`examples/npm-pkg-fixtures/` содержит **зафиксированные версии** реальных пакетов, на которых тестируется рантайм.

Стратегия: **от простого к сложному**, постепенно расширяем список. Каждый успешно работающий пакет фиксируется регрессионным тестом.

```
examples/npm-pkg-fixtures/
├── tier-0-utility/        # M3: chalk, kleur, picocolors, ms
├── tier-1-cli-pure/       # M3-M4: commander, yargs, mri
├── tier-2-streams/        # M5: through2, split2, csv-parse
├── tier-3-server/         # M7: express, koa, fastify
├── tier-4-tooling/        # M8-M10: esbuild, vite, swc
└── manifest.json          # таблица "пакет → тиры → ожидаемое поведение"
```

Каждый тир — отдельный тест-сьют, который **может быть зелёным или красным** в любой момент. Сводная таблица в `docs/compat/` показывает прогресс.

### 5.5 E2E через Playwright

Полный сценарий: открыть playground → ввести в редакторе код → нажать Run → проверить вывод в терминале. Для M7+ — проверить preview-iframe.

```typescript
test('M7: express hello world', async ({ page }) => {
  await page.goto('/')
  await loadFixture(page, 'express-hello')
  await page.click('[data-action=run]')
  await expect(page.locator('xterm-screen')).toContainText('listening on 3000')

  const preview = await page.context().newPage()
  await preview.goto('/preview/3000/')
  await expect(preview.locator('body')).toContainText('Hello from Express')
})
```

### 5.6 Compat matrix

Авто-генерируемый markdown по результатам тестов:

```markdown
# Compatibility Matrix

| Module | Method | Status | Notes |
|---|---|---|---|
| fs | readFileSync | ✅ |  |
| fs | readFile | ✅ |  |
| fs | watch | ⚠️ | polling-based, 200ms |
| fs | constants | ❌ | not implemented |
| http | Server | ✅ |  |
| http | request | ⚠️ | no keep-alive |
```

Обновляется каждый CI-прогон. Это и для пользователей доки, и для агента — карта "куда копать дальше".

### 5.7 CI pipeline

```yaml
# .github/workflows/ci.yml (схема)
jobs:
  lint-and-typecheck:
    - biome check
    - tsc --noEmit (workspace)
    - madge --circular packages/

  unit:
    - vitest run packages/*

  parity:
    - node tools/node-parity-runner run --all
    # сравнение каждого кейса в Node vs наш Worker

  conformance:
    - vitest run tests/conformance

  integration:
    - vitest run tests/integration

  e2e:
    - playwright test

  compat-report:
    - node tools/compat-matrix-generator
    - git diff --exit-code docs/compat/  # коммит должен включать обновлённую матрицу
```

**Pre-commit hook (lefthook/husky):** lint + typecheck + unit + parity-quick (быстрая выборка). Полный прогон в CI.

### 5.8 Бенчмарки и smoke

`apps/benchmarks/`:
- Boot time: сколько миллисекунд от загрузки страницы до готового рантайма
- `npm install lodash` end-to-end
- "Hello world" Express: запросов/сек через SW
- VFS write/read throughput

Запускаются раз в неделю или вручную, результаты в `docs/benchmarks/`.

---

## 6. AI-агент: правила игры

### 6.1 `CLAUDE.md` в корне

Это контекст для агента на каждой сессии. Минимум:
- Ссылка на этот документ
- Конвенции кода (см. ниже)
- Текущий милстоун и его acceptance criteria
- Список known issues и нерешённых вопросов
- "Definition of done" для PR

```markdown
# CLAUDE.md
You are working on a WebContainer-like project.
Read PROJECT_PLAN.md for the master plan.
Current milestone: M3 (Node Core).
Before considering any task done, ensure:
  1. All affected tests pass (unit + parity + relevant conformance)
  2. New behaviors have new tests (parity case preferred)
  3. Public API has TSDoc
  4. ADR is added if architectural decision was made
  5. compat-matrix is regenerated if any conformance/integration changed
```

### 6.2 Конвенции, помогающие агенту не сломать всё

1. **Strict TypeScript everywhere.** Никаких `any`. Никаких `@ts-ignore` без комментария-причины и тикета.
2. **Public API в `src/index.ts`, всё остальное internal.** Агент не может случайно зацепиться за внутренности другого пакета.
3. **Одно изменение — один PR в принципе.** Агент работает по милстоунам/этапам.
4. **TSDoc на каждой публичной функции.** Это даёт агенту контекст при чтении кода.
5. **Файлы небольшие** (<300 строк). Большие модули разбиваются.
6. **Сначала тест, потом код** (test-driven). Агенту проще написать парный тест к фиче, чем найти регрессию постфактум.
7. **Никаких "пока заглушим"** в основной ветке. Если не реализовано — `throw new NotImplementedError('fs.watch')` с регистрацией в compat-matrix как `❌`.
8. **ADR на любое архитектурное решение.** Это и для агента контекст, и для тебя через год.

### 6.3 Definition of done (для задачи/PR)

- [ ] Все существующие тесты проходят
- [ ] Новое поведение покрыто тестами (минимум — parity case, если применимо)
- [ ] TypeScript strict без ошибок
- [ ] Lint без ошибок
- [ ] TSDoc на новом публичном API
- [ ] CHANGELOG в затронутом пакете обновлён
- [ ] compat-matrix регенерирован (если изменилась совместимость)
- [ ] ADR добавлен (если было архитектурное решение)
- [ ] PR-описание ссылается на этап/милстоун

### 6.4 Workflow с агентом

Цикл, который реально работает:
1. **Ты:** "Берём этап X из милстоуна Y. Напиши тесты на acceptance criteria."
2. **Агент:** пишет тесты, они красные.
3. **Ты:** "Имплементируй до зелёного, не меняя тесты."
4. **Агент:** пишет код, гоняет тесты, итерирует.
5. **Ты:** ревью архитектуры (агент может выбрать неоптимальное решение), правки.
6. **Агент:** обновляет ADR, compat-matrix, CHANGELOG.
7. **Merge.**

Критичное правило: **тесты пишутся первыми и не редактируются под реализацию**. Если тест "оказался неудобным" — это сигнал к ADR-обсуждению, а не к подгонке.

### 6.5 Защита от типичных ошибок агента

- **Молчаливые заглушки:** агент любит вернуть `null` или `''` вместо implementation. Защита — strict types и обязательный `NotImplementedError` с регистрацией.
- **Падение тестов "по другой причине":** агент может править несвязанный тест, чтобы CI стал зелёным. Защита — pre-commit hook сравнивает diff: если правится тест в файле, где не менялся код, требуется флаг `--update-test`.
- **Хождение в `any`:** биом/eslint правило, ESLint error.
- **Прямой импорт из `src/internal/*` других пакетов:** ESLint правило `no-restricted-imports`.
- **Затирание ADR:** ADR файлы immutable после merge (только новые ADR могут override старые, со ссылкой).

---

## 7. Стартовый чек-лист (M0)

Конкретные шаги для первой недели:

1. [ ] `pnpm init` + `pnpm-workspace.yaml`
2. [ ] `tsconfig.base.json` со strict-настройками
3. [ ] Biome (или eslint+prettier) — выбрать и настроить
4. [ ] Vitest workspace
5. [ ] **Playwright init с поддержкой всех браузеров** (см. D-006):
    - [ ] `playwright.config.ts` с проектами `chromium`, `firefox`, `webkit`
    - [ ] `postinstall`-скрипт устанавливает все три браузера
    - [ ] npm-scripts: `test:e2e` (chromium-only), `test:e2e:all`, `test:e2e:firefox`, `test:e2e:webkit`
6. [ ] **GitHub Actions:**
    - [ ] `ci.yml` — на каждый PR: lint + typecheck + unit + parity + e2e:chromium
    - [ ] `ci-cross-browser.yml` — cron weekly + manual trigger: e2e:all + browser compat report
7. [ ] **Cross-origin isolation:**
    - [ ] Vite dev-server отдаёт `COOP: same-origin` + `COEP: credentialless`
    - [ ] Headers прописаны и для prod-конфига (`vercel.json` / `_headers` / etc — в зависимости от выбранного хостинга)
    - [ ] Все локальные ассеты (Monaco, xterm, шрифты) загружаются с того же origin'а; никаких внешних CDN
    - [ ] Runtime-check в playground: при загрузке проверить `crossOriginIsolated === true`, иначе показать понятную ошибку с инструкцией
    - [ ] E2E-тест в playwright: проверяет `crossOriginIsolated`, `typeof SharedArrayBuffer === 'function'`, что `new SharedArrayBuffer(8)` не падает
8. [ ] `apps/playground` со скелетом (Vite + **SolidJS**, Monaco, xterm.js — см. D-002)
9. [ ] `packages/terminal` — обёртка над xterm (framework-agnostic, без Solid)
10. [ ] Пустой Service Worker в `packages/service-worker`, регистрируется из playground
11. [ ] `packages/runtime-js` со скелетом worker-entry, грузится при клике Run
12. [ ] **ESLint-правило `no-restricted-imports`: `solid-js` запрещён вне `apps/playground/**`** (см. D-002)
13. [ ] `CLAUDE.md` + ADR-0001 (pnpm + workspace) + ADR-0002 (cross-origin isolation, D-001) + ADR-0003 (UI framework, D-002)
14. [ ] **`OPEN_QUESTIONS.md` в корне** + шаблон + `pnpm adr:new` и `pnpm adr:promote` скрипты (см. D-007)
15. [ ] **CI-чек на `TODO(ADR):` маркеры** — собирает количество, выводит в отчёт, не блокирует
16. [ ] README с roadmap-ссылкой и статусом
17. [ ] Первый devlog-пост "почему я это делаю"

После этого можно начинать M1.

---

## 8. Принятые решения (Decision Log)

Краткие записи зафиксированных архитектурных решений. Подробные обоснования — в `docs/adr/`. Этот раздел растёт по мере прохождения открытых вопросов.

### D-009: Инфлексии — не повод останавливаться
**Решено:** 2026-05-31
**ADR:** `docs/adr/0064-no-stop-on-inflections.md` (расширяет ADR-0063)
**Связано с:** D-008

**Проблема:** Несмотря на D-008 (record-and-continue), агент всё равно паузил ради вопроса человеку на «крупных инфлексиях» — неожиданный результат меняет план; у ранее отложенного решения появилась подтверждённая нужда; прежнее предположение оказалось устаревшим. Это ровно то трение, которое D-008 убирал.

**Решение:** Инфлексия — не стоп-триггер. Не паузят работу ради вопроса: результат/замер, меняющий план или порядок милестоунов; отложенное решение, чей гейт («нет подтверждённой нужды») закрыт доказательством → ратифицировать; обнаружение устаревшего предположения/спеки/feasibility-заметки → скорректировать курс; коммит новой внешней зависимости после подтверждения нужды. Агент решает, фиксирует (новый/замещающий ADR; decision-сабагент при пересмотре уже записанного), переcut'ит план, продолжает и докладывает ПОСЛЕ. Confirm-first остаётся только для действий наружу/разрушительных за пределами репо (публикация, удаление данных пользователя, траты, push в общие remote) или направления, явно зарезервированного пользователем.

---

### D-008: Record-and-continue — агент не останавливается на необратимых решениях
**Решено:** 2026-05-30
**ADR:** `docs/adr/0063-record-decisions-no-stop-on-irreversible.md` (supersedes ADR-0008)
**Связано с:** D-007 (обновляет поведение)

**Проблема:** Правило D-007 «IRREVERSIBLE → стоп, вопрос в PR, ждать человека» на практике останавливало длинные автономные сессии на рутинных развилках и стало главным источником трения.

**Решение:** Агент больше не останавливается на необратимых решениях. Reversibility-чеклист сохраняется, но определяет только **куда** записать решение, а не нужно ли паузить.
- Любое новое решение (reversible или irreversible): **решить, зафиксировать, продолжить.** REVERSIBLE → `OPEN_QUESTIONS.md` + `TODO(ADR)`; IRREVERSIBLE → новый ADR инлайн (агент ратифицирует), с опциями и trade-offs для аудируемости.
- **Пересмотр уже зафиксированного решения** (смёрдженный ADR или провизорное решение, на которое опёрлась другая работа) — единственный случай, когда не решаем инлайн: запускается **явный сабагент-решатель**, который оценивает и выпускает замещающий ADR (со ссылкой на старый — ADR остаются immutable).

**Что НЕ меняется:** ADR immutable после merge; правило «never modify a test to make code pass» остаётся жёстким (инвариант корректности, не дизайн-развилка); каждое необратимое решение по-прежнему **записывается**.

---

### D-007: Reversible decisions — агент не блокируется на дизайн-развилках
**Решено:** 2026-05  
**ADR:** `docs/adr/0008-reversible-decisions.md`  
**Связано с:** работа с AI-агентом (§6)

**Проблема:** Жёсткое правило "design decision = ADR discussion" останавливает длинные автономные сессии агента на каждой развилке. Это убивает продуктивность и провоцирует нарушение правил.

**Решение:** Дифференцируем решения по обратимости. Агент имеет право принимать обратимые решения автономно, фиксируя их в `OPEN_QUESTIONS.md` и помечая код `TODO(ADR)`-маркерами. Только необратимые решения и противоречия существующим ADR прерывают работу.

**Reversibility checklist (порядок важен — первое "yes" определяет классификацию):**

1. Затрагивает ли публичный API между пакетами? → **IRREVERSIBLE**
2. Требует ли новой внешней зависимости? → **IRREVERSIBLE**
3. Противоречит ли существующему ADR? → **IRREVERSIBLE**
4. Откат потребует >100 строк или правки >2 файлов? → **IRREVERSIBLE**
5. Иначе → **REVERSIBLE**

**Поведение агента:**

| Тип решения | Действие |
|---|---|
| Pure implementation (критерии ясны) | Делает |
| Local naming, file structure внутри пакета | Решает сам, без записи |
| Внутренний API между модулями одного пакета | Решает сам, документирует в TSDoc |
| REVERSIBLE design choice | Принимает провизорное, помечает `TODO(ADR): Q-...`, логирует в `OPEN_QUESTIONS.md`, продолжает работу |
| IRREVERSIBLE design choice | Останавливается, явно спрашивает в PR description |
| Противоречие существующему ADR | Стоп, явный вопрос |

**Артефакты:**

1. **`OPEN_QUESTIONS.md`** в корне репо — живой буфер для провизорных решений. Формат записи:
   ```markdown
   ## Q-YYYY-MM-DD-NNN: <Title>
   **Encountered in:** PR #X, while implementing Y
   **Context:** Краткое описание развилки
   **Options considered:** A, B (с trade-offs)
   **Decision taken (provisional):** A
   **Code markers:** `TODO(ADR): Q-YYYY-MM-DD-NNN` в файлах X, Y
   **Reversibility justification:** почему откат тривиален
   **Needs human review by:** end of milestone M<N>
   ```

2. **Маркер `TODO(ADR): Q-...`** в коде — grep-friendly, отдельный от обычных `TODO`. CI собирает их количество в отчёт, **не блокирует**.

3. **`pnpm adr:promote Q-YYYY-MM-DD-NNN`** — команда для апгрейда подтверждённого вопроса в ADR. Удаляет соответствующие `TODO(ADR)`-маркеры из кода.

**Процесс ревью:**
- В конце каждого милстоуна (или по необходимости чаще) — проход по `OPEN_QUESTIONS.md`.
- Каждый вопрос: подтверждён → промоут в ADR; отвергнут → переделка с новым ADR; отложен → остаётся с обновлённым `Needs human review by`.
- CI сигнализирует, если `OPEN_QUESTIONS.md` содержит вопросы старше двух милстоунов — это технический долг.

**Что это даёт:**
- Агент **продолжает работать** в большинстве случаев, где раньше тормозил.
- Развилки **видны и аудируемы** — ничего не теряется.
- Реально критичные решения по-прежнему останавливают — где иначе можно сделать необратимую ошибку.
- Количество `TODO(ADR)` — индикатор технического долга, виден количественно.

**Следствия для CLAUDE.md:**
- Добавляется раздел "Design decisions during work" с Reversibility checklist.
- Workflow получает шаг 0: классифицировать задачу перед стартом.
- Правило "Never modify a test to make code pass" остаётся жёстким — это категория необратимого.

---

### D-006: Chrome-first с готовой инфраструктурой для других браузеров
**Решено:** 2026-05  
**ADR:** `docs/adr/0007-browser-support.md`  
**Связано с:** Q6 (закрыт)

**Решение:** Основная цель — Chromium-семейство (Chrome/Edge/Arc/Brave). Firefox и WebKit/Safari поддерживаются best-effort: инфраструктура для прогонов готова с M0, но в дефолтном CI не запускается. Тестирование в "других" браузерах — один CLI-вызов, не отдельный проект.

**Стратегия позиционирования: Chrome-first, best-effort other browsers.**
- В Chromium всё должно работать как заявлено в acceptance criteria.
- В Firefox/WebKit — приложение загружается, базовые сценарии работают (или показывается понятное сообщение о причине неработы).
- Никаких vendor-prefixes и Chrome-only хаков "просто потому что". Если возможен стандартный путь — идём им.

**Инфраструктура для всех браузеров (готовится в M0, используется по требованию):**

1. **`playwright.config.ts` содержит проекты для всех трёх engines** (`chromium`, `firefox`, `webkit`) с самого начала. Не один конфиг для Chrome и отдельный "когда-нибудь" для остальных.

2. **CI matrix скрипт умеет в любой engine:**
   - В дефолтном `ci.yml` запускается только `chromium`.
   - Параметризованный workflow `ci-cross-browser.yml` запускается **по cron (раз в неделю)** + ручной trigger через `workflow_dispatch`. Прогоняет всю тестовую пирамиду на всех трёх.
   - Результаты падают в отдельный отчёт `docs/compat/browsers.md` (генерируется автоматически).

3. **Локальные npm-scripts с первого дня:**
   - `pnpm test:e2e` → chromium (быстро, дефолт)
   - `pnpm test:e2e:all` → все три
   - `pnpm test:e2e:firefox`, `pnpm test:e2e:webkit` → отдельно
   - Это включает установку браузеров через `playwright install firefox webkit` в `postinstall`.

4. **Browser capabilities detection как отдельный модуль** (`packages/runtime-js/src/env/capabilities.ts`):
   - При старте playground проверяет: `crossOriginIsolated`, `SharedArrayBuffer`, `FileSystemSyncAccessHandle` в Workers, `Atomics.waitAsync` (нужен в M6), и пр.
   - Если чего-то нет — конкретное сообщение в UI: "функция X не работает, потому что в вашем браузере Y. Подробнее: [link to caniuse]".
   - Этот же модуль логирует capabilities в e2e-тестах — отчёт по совместимости становится data-driven, не "ощущениями".

5. **Browser-specific known issues таблица** (`docs/compat/browsers.md`):
   - Генерируется из результатов CI cross-browser run.
   - Каждый failing test → запись "тест X фейлится в браузере Y, причина Z (link to bug)".
   - Это и для пользователей доки, и для будущего "что чинить, если решим довести до full cross-browser".

**Что это даёт:**
- "Посмотреть, как в FF" — это `pnpm test:e2e:firefox`, не "потратить день на настройку".
- Когда (если) проект созреет до публичной аудитории — добавление Firefox/Safari в дефолтный CI — это правка одной строки в workflow, а не работа на неделю.
- Регулярный cross-browser sweep (раз в неделю по cron) ловит регрессии раньше, чем мы вспомним о других браузерах руками.
- Capabilities-detection — единый источник правды о том, что работает в каком окружении.

**CI-конфигурация:**
```
.github/workflows/
├── ci.yml                    # на каждый PR: lint + unit + parity + e2e:chromium
├── ci-cross-browser.yml      # cron weekly + manual: e2e:all + report
└── nightly.yml               # на main ночью: бенчи + integration full
```

**Чего НЕ делаем:**
- Не блокируем PR на cross-browser failure. Это best-effort.
- Не пишем "обходные пути" для нестабильных API в других браузерах. Документируем как known issue, идём дальше.
- Не используем браузер-specific feature detection в продакт-коде (типа `if (isFirefox)`). Только feature-detection через capabilities API.

**Что отложено:**
- Mobile browsers (mobile Safari, Chrome Android) — отдельный вопрос, не сейчас. Инфра Playwright поддерживает device emulation; добавим, если/когда станет релевантно.
- Серьёзная работа по pixel-perfect cross-browser UI — за рамками пет-проекта.

---

### D-005: Shadow-registry — слоистая стратегия с опорой на экосистему
**Решено:** 2026-05  
**ADR:** `docs/adr/0006-shadow-registry.md`  
**Связано с:** Q5 (закрыт)

**Решение:** Подмена нативных и несовместимых пакетов — на уровне резолвера модулей. Источники подмен — слоистая структура с опорой на существующую экосистему вместо самописных решений.

**Механизм подмены:**
- Уровень резолвера в module loader (D-003): перед поиском в `node_modules` проверяем shadow-table.
- Реверсивно: можно отключить shadow-replacement через флаг для отладки.
- Тестируется: каждая подмена должна проходить parity-test против ожидаемого API подменяемого пакета (где это применимо).

**Источники подмен (в порядке приоритета применения):**

1. **Стандартный `overrides` из пользовательского `package.json`** — пользовательский интерфейс. Поддерживаем формат npm/yarn/pnpm как есть. Никаких своих изобретений в этом слое.

2. **`unenv` от UnJS-команды** — базовый слой полифилов для stdlib-модулей (`crypto`, `os`, `tty`, `perf_hooks`, `process`, и др.). Используется в продакшене Cloudflare Workers и esm.sh. Включается как зависимость `runtime-js`. Покрывает большую часть утилитарного хвоста M3 и M11.

3. **`e18e/module-replacements`** — community-курируемый список замен устаревших npm-пакетов на нативные/современные API. Импортируется как данные, расширяется нашими записями для нативных биндингов.

4. **Готовые WASM-сборки** для нативных пакетов из публичной экосистемы:
   - `sqlite3`/`better-sqlite3` → `@sqlite.org/sqlite-wasm` или `node-sqlite3-wasm`
   - Image processing (`sharp`) → `@jsquash/*` семейство
   - Прочие — по мере появления и потребности

5. **Свои адаптеры в монорепо** (`tools/shadow-registry/packages/*`) — только для API-адаптации поверх готовых WASM или для случаев, где экосистемного решения нет. Минимизируем количество.

6. **Documented incompatibility** — `docs/compat/incompatible-packages.md`. При попытке install — внятная ошибка с указанием на этот документ.

**WASM ecosystem assumptions:**
- Рассчитываем на рост числа готовых WASM-сборок (тренд устойчивый: `wasm32-wasip2` Rust target, Component Model, активная публикация WASM-портов).
- `.node`-файлы из npm (native bindings) **никогда не заработают магически** — это фундаментальное ограничение, не баг экосистемы.
- Архитектурно мы готовы к преимуществам WASI preview 2 (sockets, http в стандарте): `runtime-wasi` — отдельный плагин, миграция == обновление shim'а.

**Процесс: Ecosystem Sweep**
- Раз в квартал — проход по списку "documented incompatible" и проверка, не появилось ли WASM-альтернативы или upstream WASI-сборки.
- Раз в квартал — обновление `unenv` и `e18e/module-replacements` до свежих версий, прогон parity-тестов на регрессии.
- Зафиксировано в `docs/processes/ecosystem-sweep.md` как чек-лист, выполняется руками или по cron-issue в GitHub.

**Риски и митигации:**
- **`unenv` — внешняя зависимость, ориентирована на CF Workers.** Где-то могут быть стабы вместо реализаций. Митигация: каждый модуль из unenv проходит через parity-runner перед использованием; пиннуем версию; в крайнем случае готовы форкнуть.
- **`e18e/module-replacements` ориентирован на bundler-оптимизацию.** Часть замен подойдёт нам, часть — нет. Митигация: курируем подмножество, не используем всё подряд.
- **Расхождение API подменного пакета и оригинала** (например, `bcryptjs` ≠ `bcrypt` на 100%). Митигация: парные тесты, документирование известных расхождений в compat-matrix.

**Следствия:**
- `npm-client` (M9) реализует стандартный `overrides`-механизм.
- `runtime-js` (M3+) подключает `unenv` как dependency.
- Своих пакетов в `tools/shadow-registry/` — минимум; первый понадобится не раньше реальной потребности (вероятно M9-M10).
- Никакого своего mini-registry на CDN/CF — нет необходимости.

**Что отложено:**
- Конкретные адаптеры под `bcrypt`/`sharp`/`better-sqlite3` — пишутся по необходимости, не упреждающе.
- Возможность пользователю указывать собственные shadow-маппинги через UI (помимо `overrides` в package.json) — отложено до момента, когда станет очевидной потребность.

---

### D-004: Dev-прокси для npm registry через Vite
**Решено:** 2026-05  
**ADR:** `docs/adr/0005-npm-registry-dev-proxy.md`  
**Связано с:** Q4 (частично закрыт — prod вынесен в Q4'); напрямую влияет на M9

**Решение:** В dev-окружении прокси к `registry.npmjs.org` реализуется через `vite.config.ts` `server.proxy`. Никакой отдельной инфраструктуры на этапе разработки. Решение по prod-прокси отложено в Q4'.

**Что проксируется:**
- Metadata: `GET /npm-registry/:pkg` → `registry.npmjs.org/:pkg`
- Tarballs: `GET /npm-registry/:pkg/-/:file.tgz` → соответствующий tarball

**Конвенция на стороне `npm-client`:**
- Базовый URL registry конфигурируется через переменную (`REGISTRY_BASE_URL`).
- В dev = `/npm-registry` (относительный, ходит через Vite proxy).
- В prod будет полный URL прод-прокси (см. Q4').
- В тестах = mock-server, поднимаемый harness'ом, чтобы тесты были детерминистичны и не зависели от сети.

**Почему так:**
- Vite proxy — нулевая инфраструктура. Уже есть Vite, добавляем секцию в конфиг.
- Не блокирует M0-M8 — прокси нужен только в M9.
- К моменту prod-деплоя могут появиться новые варианты (изменения лимитов CF, новые сервисы), решение лучше принимать ближе к делу.

**Следствия:**
- `npm-client` спроектирован вокруг конфигурируемого registry URL с самого начала. Никаких хардкодов `registry.npmjs.org` в коде.
- Тесты для `npm-client` всегда ходят в локальный mock — это и быстрее, и стабильнее, и не нагружает реальный registry.
- Решение по prod-прокси требуется к завершению M9. До этого момента — открытый вопрос.

**Что отложено (Q4'):**
- Выбор prod-прокси: Cloudflare Worker, отдельный VPS, что-то ещё.
- Стратегия кеширования tarballs (если будет).
- Принимается к концу M9.

---

### D-003: Module loader — гибрид es-module-lexer + свой резолвер/линкер
**Решено:** 2026-05  
**ADR:** `docs/adr/0004-module-loader.md`  
**Связано с:** Q3 (закрыт)

**Решение:** ESM-модули обрабатываются собственным загрузчиком. Парсинг import/export — через `es-module-lexer`. Резолвер, граф зависимостей, исполнение — свой код. Не используем нативный браузерный `import()` с Blob URLs для пользовательского кода.

**Архитектура загрузчика:**
1. Резолвер (один для CJS и ESM) превращает specifier'ы (`'react'`, `'./util'`) в абсолютные пути в VFS. Реализует Node algorithm: walk-up по `node_modules`, поля `main`/`exports`/`imports`, conditional exports.
2. Для ESM-модуля `es-module-lexer` находит все import/export. Граф строится итеративно.
3. Транформация: импорты заменяются на обращения к module registry (`import x from 'y'` → доступ через registry с live binding через геттер).
4. Исполнение: модуль оборачивается в `async function` (поддерживает top-level await), вызывается с контекстом (`import.meta`, динамический `import()`, registry).
5. CJS-модули грузятся синхронно через `new Function('module', 'exports', 'require', code)` — это базовая Node-семантика.
6. CJS ↔ ESM интероп: ESM может импортировать CJS синхронно через namespace-обёртку; CJS может загрузить ESM только через async `import()` (как в Node).

**Почему так:**
- **Контроль над резолвером** — у нас Node-семантика, browser native ESM про package.json и conditional exports ничего не знает.
- **Единая семантика CJS+ESM** — один граф, один резолвер, две стратегии исполнения. Это путь Vite, проверенный на масштабе.
- **Транформации встраиваются естественно** — захотим TS/JSX в пользовательском коде позже, добавим transform-шаг между парсингом и исполнением без переделок.
- **Source maps и debug** — мы контролируем имена/пути, можем сохранить осмысленную информацию.
- **`es-module-lexer` дёшев** — ~5KB, быстрый, не парсит весь JS.

**Альтернативы и почему отклонены:**
- **Нативный браузерный ESM через Blob URLs + SW interception:** соблазнительно дешёво, но теряем контроль в самом критичном месте (резолюция и CJS-интероп). Динамический `import()` внутри Worker может обходить SW в зависимости от регистрации. CJS-интероп всё равно пришлось бы писать самим.
- **Полный парсер (acorn):** избыточно. Для построения графа достаточно сканера импортов/экспортов; полный AST нужен только когда мы будем добавлять transform'ы (TS/JSX) — тогда подключим отдельный парсер на этом шаге.

**Следствия:**
- В M2 строим резолвер с самого начала как общий для CJS+ESM (а не делаем сначала CJS, потом отдельный ESM).
- Module registry — отдельная сущность с live bindings через геттеры. Это и для CJS пригодится (циклы).
- При M3+ TS-поддержка в пользовательском коде = добавление transform-шага, а не переписывание загрузчика.

**Что отложено:**
- Поддержка `import` assertions / attributes (`import json from './x.json' with { type: 'json' }`) — добавим при появлении реальной потребности.
- Worker modules (`new Worker(url, { type: 'module' })`) внутри guest-кода — отдельная задача в M6 (child_process / worker_threads).
- HMR — не входит в M2-M9, будет рассматриваться в M10.

---

### D-002: UI-фреймворк playground — SolidJS, изолирован от core
**Решено:** 2026-05  
**ADR:** `docs/adr/0003-ui-framework-solid.md`  
**Связано с:** Q2 (закрыт)

**Решение:** Playground пишется на SolidJS. UI-фреймворк используется **только** в `apps/playground/` и нигде больше. Все пакеты в `packages/` остаются framework-agnostic (чистый TS, без JSX/реактивных зависимостей).

**Почему Solid:**
- Fine-grained reactivity естественно ложится на наш характер обновлений: стриминг stdout в терминал, file watcher events, статусы процессов в реальном времени.
- Маленький bundle — у нас и без UI много веса (Monaco, рантайм, WASM-бинари).
- JSX знаком из React, кривая обучения мягкая.
- Solid Stores хорошо подходят для глобального состояния (process manager, открытые файлы).

**Почему "не врастает":**
- Если через год захочется заменить UI (богатый IDE-интерфейс, мобильная версия, embed-режим) — это должно быть переписывание только `apps/playground/`, а не всего проекта.
- Это дисциплинирует архитектуру: API ядра должен быть достаточно чистым, чтобы любой UI мог его потреблять.

**Правила изоляции:**
- `packages/*/src/**` — никаких импортов `solid-js`, никакого JSX. Только TypeScript + Web APIs.
- ESLint-правило `no-restricted-imports`: `solid-js` запрещён везде, кроме `apps/playground/**`.
- Все события из ядра наружу — через типизированные event emitters или async iterators, без Solid-сигналов.
- Адаптер "ядро → Solid Store" живёт в `apps/playground/src/adapters/`, это единственное место, где они встречаются.

**Следствия:**
- При замене UI меняется только `apps/playground/`. Все `packages/` остаются нетронутыми.
- Любая будущая интеграция (VSCode-extension, CLI-демо, headless-режим для тестов) подключается к тому же ядру без переделок.
- Чуть больше кода на старте (адаптер вместо прямого использования Solid-стейта в ядре), но это нормальная цена за развязку.

**Что отложено:**
- Конкретный набор UI-компонентов (панели, табы, файловое дерево) — пишем по мере надобности, не тащим UI-kit на старте.
- Темизация — единая CSS-переменная-схема, никакого design-system на старте.

---

### D-001: Cross-origin isolation обязателен с M0
**Решено:** 2026-05  
**ADR:** `docs/adr/0002-cross-origin-isolation.md`  
**Связано с:** Q1 (закрыт)

**Решение:** Playground работает только в режиме `crossOriginIsolated === true`. Сервер отдаёт `COOP: same-origin` + `COEP: credentialless`.

**Почему:**
- К M6 нужен sync IPC между Worker'ами (для `execSync`, синхронных файловых вызовов). Единственный жизнеспособный механизм — `SharedArrayBuffer` + `Atomics.wait`, который требует isolation.
- Альтернатива (полностью async runtime + Asyncify-стиль трансформация guest-кода) кратно сложнее и медленнее.
- `credentialless` режим существенно облегчает работу с COEP по сравнению с `require-corp`: сторонние ресурсы можно эмбедить без CORP-заголовка, ценой отсутствия credentials. Для нашего use case это приемлемо.

**Следствия:**
- Хостинг: только тот, что позволяет кастомные headers (Vercel/Netlify/Cloudflare Pages — да; GitHub Pages — нет).
- Все ассеты playground'а — локальные или проксируются через свой origin с добавлением CORP-заголовка.
- iframe-preview для пользовательских приложений (M10) нужно будет проектировать с учётом COEP — отдельная задача в M10.
- M0 включает runtime-check и e2e-тест, гарантирующие, что isolation реально активен.

**Что отложено:**
- Конкретный хостинг (Vercel vs Netlify vs CF Pages) — выбираем перед первым деплоем, не блокирует разработку.
- Стратегия для iframe-preview (M10) — решим, когда дойдём.

---

## 9. Открытые вопросы (для обсуждения)

Эти вещи стоит решить **до** того, как соответствующий милстоун начнётся:

*Q4' (prod-прокси для npm registry) — открыт повторно 2026-05-27.* Изначально закрывался ADR 0028 (Vercel Edge Function), но аудит 2026-05-27 выявил, что код Edge Function так и не появился в репо. Статус ADR-0028 переведён в **Provisional**, живой трекер — `OPEN_QUESTIONS.md` Q-2026-05-24-007 (Active). Финализация — к первой prod-деплой сессии M9.

---

*Этот документ — живой. Обновляется при крупных решениях. Каждый милстоун завершается ревью документа: что подтвердилось, что переоценили.*
