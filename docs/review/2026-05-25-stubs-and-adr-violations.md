# Silent stubs и нарушения ADR — 2026-05-25

Собрано по результатам параллельного архитектурного обзора (по субагенту на модуль). Все находки имеют `file:line` ссылку, severity (🔴 критично / 🟡 серьёзно / 🟢 мелкое) и ссылку на ADR / правило CLAUDE.md, которое нарушено.

Источник правил:
- **No silent stubs:** `CLAUDE.md` → Hard rules → Code quality ("Throw `NotImplementedError('module.feature')` and register in compat-matrix as `❌`. Never return `null`/`''`/`undefined` as a placeholder").
- **ADR — immutable**: `CLAUDE.md` → Memory/state ("Decisions in `docs/adr/` are immutable after merge").
- **IRREVERSIBLE checklist** (CLAUDE.md): contradicting existing ADR → IRREVERSIBLE → должно было блокировать merge.

---

## 1. Silent stubs (нарушение "no silent stubs")

### 1.1 `runtime-wasi`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/runtime-wasi/src/syscalls/path.ts:36-40` | `path_open` без `O_CREAT` молча создаёт пустой файл вместо `E_NOENT` | Проверить `oflags & O_CREAT`, иначе `E_NOENT` |
| 🔴 | `packages/runtime-wasi/src/syscalls/fd.ts:85-87` | `fd_fdstat_get` принимает `_outPtr`, возвращает `E_SUCCESS`, не пишет структуру (24 байта) | Записать `fs_filetype`/`fs_flags`/`fs_rights_*` в guest-память |
| 🔴 | `packages/runtime-wasi/src/syscalls/fd.ts:40-46` | `fd_read` для невалидного fd возвращает 0 байт + `E_SUCCESS` | `E_BADF` для невалидного, отличать EOF |
| 🟡 | `packages/runtime-wasi/src/syscalls/fd.ts:72-84` | `fd_seek` не валидирует `whence`, `next<0`, переполнение | `E_INVAL` для bad whence |
| 🟡 | `packages/runtime-wasi/src/syscalls/path.ts:80-86` | `path_create_directory` ловит ЛЮБУЮ ошибку как `E_NOENT` (теряет `EACCES`/`EEXIST`) | Маппить по реальной ошибке |
| 🟡 | `packages/runtime-wasi/src/syscalls/clock.ts:10-13` | `clock_time_get` игнорирует `_id` (REALTIME == MONOTONIC) | Разнести по clock id |

### 1.2 `runtime-js`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/runtime-js/src/builtins/fs.ts:244-249` | `realpathSync` возвращает `np` без проверки symlinks; `lstatSync = statSync` | `NotImplementedError` или честная реализация |
| 🔴 | `packages/runtime-js/src/builtins/assert.ts:162-168` | `assert.doesNotThrow` без `expected`-фильтра; ронит на любой throw | Honor `expected` filter (RegExp/Class/predicate) |
| 🟡 | `packages/runtime-js/src/builtins/worker_threads.ts:98-99` | Capability-fallback на same-realm молча; `parentPort`/`workerData` не пробрасываются | Loud-warn или throw, либо честная same-realm передача |
| 🟡 | `packages/runtime-js/src/builtins/url.ts:32-39` | `query` иногда `string`, иногда object — несогласованно с Node legacy parse | Зафиксировать на parsed-object |

### 1.3 `net`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/net/src/http/request.ts:13` | `socket = {}` (пустой объект как `req.socket`) | Минимальный shape (`remoteAddress`, `localAddress`) или `NotImplementedError` на доступ |
| 🔴 | `packages/net/src/net.ts:62-105` | `net.Socket` сериализует Request в HTTP-текст, потом парсит ответ — не TCP, имя вводит в заблуждение | Rename → `HttpFramedSocket` или `NotImplementedError` на не-HTTP usage |
| 🟡 | `packages/net/src/registry.ts:33-39` | `dispatchToPort` возвращает 502 строкой без `Content-Type` | JSON-body с явным content-type |

### 1.4 `vfs`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/vfs/src/opfs.ts:43-46,52-56,104-105,118-120` | ВСЕ OPFS-ошибки маппятся в `ENOENT` (теряются `NotAllowedError`/`QuotaExceededError`/`TypeMismatchError`) | Разнести по веткам (ADR-0013 явно требует) |
| 🔴 | `packages/vfs/src/opfs-sync.ts:148-150` | `existsSync` возвращает `true` только для warmed handle; врёт о реальных файлах | Идти в OPFS или прогревать индекс при `init()` |
| 🔴 | `packages/vfs/src/opfs-sync.ts:171-178` | `statSync` бросает `ENOENT` для не-warmed файла; директорию не различает | Честный stat через OPFS |
| 🟡 | `packages/vfs/src/opfs.ts:65-67` | `readFile` игнорирует параметр `encoding` | Honor encoding или throw |
| 🟡 | `packages/vfs/src/opfs.ts:124-134` | `stat` через try/catch + `mtime: 0` для директории | Реальная mtime, явное различие EISDIR/ENOTDIR |

### 1.5 `io`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/io/src/buffer-methods.ts:90-101` | `Buffer.write(s, offset, length, encoding)` игнорирует `length` и `encoding`, всегда utf8 | Honor параметры |
| 🔴 | `packages/io/src/buffer.ts:28-35` | `Buffer.alloc(size, fill, encoding)` игнорирует `encoding` для строкового fill | Honor encoding |
| 🟡 | `packages/io/src/buffer.ts` | Отсутствуют `readFloat*`/`indexOf`/`fill`/`copy` без `NotImplementedError` — `TypeError` на доступ | Регистрировать как `❌` либо throw `NotImplementedError` |
| 🟡 | `packages/io/src/event-emitter.ts:118-125` | `rawListeners` идентичен `listeners` (в Node — обёртки `once`) | Возвращать raw-wrapper |

### 1.6 `shell`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/shell/src/shell.ts:82-91` | `<` tokenizer пропускает (см. `tokenize.ts:20`), shell игнорирует — silent drop | Throw `NotImplementedError("shell.input-redirect")` или реализовать |
| 🔴 | `packages/shell/src/tokenize.ts:30-56` | Кавычки снимаются без семантики, `'`/`"` не различаются, нет `$VAR` expansion | Реальный shell-parser |
| 🟡 | `packages/shell/src/builtins.ts:131` | `touch` не обновляет mtime существующих | Обновлять mtime |

### 1.7 `npm-client`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/npm-client/src/installer.ts:218-256` | `peerDependencies`/`optionalDependencies` парсятся (`registry.ts:20-21`), но игнорируются | Резолвить либо throw |
| 🟡 | `packages/npm-client/src/installer.ts:51-61` | `JSON.parse` lockfile молча возвращает `null` при любой ошибке | Throw с явным сигналом повреждения |
| 🟡 | `packages/npm-client/src/unpacker.ts:42` | typeFlag `'2'` (symlink), `'L'`/`'K'` (GNU long-name) молча → `'other'` | `NotImplementedError` для symlink в M9 |
| 🟢 | `packages/npm-client/src/semver.ts:29` | Pre-release сравнивается лексикографически, не по dot-segments | Сравнение по segments |

### 1.8 `terminal`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/terminal/src/terminal.ts:108-122` | Escape-литералы записаны без `\x1b`/`\x03` префиксов — стрелки/Ctrl+C **никогда не срабатывают** | Явные `'\x1b[A'`, `'\x1b[B'`, `'\x03'` + parity-тест |
| 🔴 | `packages/terminal/src/terminal.ts:118-122` | `Ctrl+C` локальный echo "^C", без эмита сигнала; `busy=true` блокирует ВСЁ | PTY abstraction со signal-эмитом |
| 🟡 | `packages/terminal/src/terminal.ts:124` | `charCodeAt(0) < 32` режет ВСЕ control-байты (paste с переводами строк, IME) | Whitelist |

### 1.9 `service-worker`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/service-worker/src/preview-bridge.ts:13-18` vs реальный код | Docblock протокола обещает `rifty:preview:ready` handshake — НЕ реализован; race: первые fetch'и уходят `503 No client` | Реализовать handshake |
| 🟡 | `packages/service-worker/src/register.ts:24-44` | Нет таймаута/reject; если SW застрянет в `installing`, promise висит вечно; нет `redundant`-handling | Timeout + state lifecycle |

### 1.10 `kernel`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🔴 | `packages/kernel/src/process-manager.ts:229-235` | `WorkerHandle.send()` всегда `false` (ChildProcess.stdin/fork IPC недоделаны, M6 PARTIAL) | Уже отмечено в TASKS.md — нужно throw `NotImplementedError`, не возвращать `false` |
| 🟡 | `packages/kernel/src/spawn-worker.ts:216-232` | Обработчик `error` НЕ слушает `messageerror` — десериализационные ошибки теряются | Подписать `messageerror` |

### 1.11 `apps/playground`

| Severity | File:line | Stub | Что должно быть |
|---|---|---|---|
| 🟡 | `apps/playground/src/App.tsx:42` | `registerServiceWorker('/sw.js')` падает в stderr без UI-индикации | UI fallback panel |
| 🟢 | `apps/playground/src/adapters/realVite.ts:165-185` | Фейковый `require` с пустыми `cache={}`, `extensions={}` — поля Node-`require` имитируются | Перенести в `runtime-js/builtins/module` |

---

## 2. Нарушения существующих ADR (IRREVERSIBLE по checklist)

> По CLAUDE.md "Reversibility checklist": "Does it contradict an existing ADR? → **IRREVERSIBLE**" — каждое из этих нарушений должно было блокировать merge.

### 2.1 ADR-0026 (`process.platform` honest values) — НАРУШЕНО

🔴 **`packages/runtime-js/src/builtins/os.ts:24-30`**: `os.platform()` возвращает `'linux'`, `os.arch()` — `'wasm32'`.
ADR-0026 фиксирует `process.platform='rifty'`, `process.arch='wasm'` как public ABI. `os.platform()` обязан возвращать ровно то же. Сейчас любой код `os.platform() === process.platform` сломается.

**Канон:** `'rifty'`/`'wasm'` (ADR-0026 immutable). Чинить надо `os.ts`.

### 2.2 ADR-0013 (OPFS persistence) — НЕ ПОДКЛЮЧЕНО В BOOTSTRAP

🔴 **`apps/playground/src/main.tsx:1-13`**: `initBackend()`/`detectVfsBackend()` нигде не вызывается. Все edits живут в `MemoryFsSync`, теряются на reload.

🔴 **`packages/vfs/src/opfs.ts:43-46`**: все ошибки → `ENOENT`. ADR-0013 acceptance требует `QuotaExceededError`-путь и различение `EEXIST`/`EISDIR`/`ENOTDIR`.

🔴 **`packages/vfs/src/opfs-sync.ts:148,171`**: `existsSync`/`statSync` врут о не-warmed файлах. ADR-0013 acceptance явно: "OpfsFsSync passes the same conformance suite".

### 2.3 ADR-0014 (shared VFS backing tree) — РАСХОЖДЕНИЕ

🔴 **`packages/runtime-wasi/src/syscalls/fd.ts:24-34`**: WASI хранит файл целиком в `FileDescriptor.data` параллельно с VFS — два источника истины. `writeFileSync` пишет в VFS, но fd-cursor живёт отдельно. Расхождение неизбежно при конкурентной записи.

🟡 **`packages/vfs/src/opfs-sync.ts:148-150`**: `OpfsFsSync.existsSync` не видит файла, созданного через `OpfsVfs.writeFile`. Срывает "одно дерево, две поверхности".

### 2.4 ADR-0015 (shadow-registry consolidation) — НЕ ВЫПОЛНЕНО

🟡 **`packages/npm-client/src/overrides.ts`**: 42 строки с `parseTarget()`. Acceptance §35 говорит "becomes a ~5-line adapter". Логика layering user → baked должна жить в `tools/shadow-registry/`, тут — ре-экспорт.

### 2.5 ADR-0017 (net scope and streaming rewrite) — PHASE 1 НЕ ЗАВЕРШЁН

🔴 **`packages/net/src/http/request.ts:9-28`** и **`packages/net/src/http/request.ts:42-46`** (`IncomingMessageFromFetch`): body загружается через `request.arrayBuffer()` целиком и `push`-ается одним куском. Streaming сделан только writer-side (response), reader-side (request) — buffered. Chunked upload не работает.

🟡 **`packages/net/src/http/response.ts:138`**: `this.controller?.enqueue(buf)` без проверки `desiredSize` — writer не уважает backpressure.

### 2.6 ADR-0018 (runtime-js subpath exports) — БОЛЬШЕЙ ЧАСТЬЮ ОК, ОДНА УТЕЧКА

🟡 **`packages/vfs/src/index.ts:6-26`**: публичный API утекает внутренние сущности (`setSyncMirror`, `setAsyncVfs`, `resetSyncMirror`, `MemoryBackend`, `MemoryFsSync`). Сама ADR-0018 о другом пакете, но дух правила "internal stays internal" в `vfs` нарушен.

### 2.7 ADR-0024 (file-size budget ~300 строк) — НАРУШЕНО

| File | Lines | Действие |
|---|---|---|
| `packages/runtime-js/src/builtins/crypto.ts` | 534 | Разнести SHA/HMAC/MD5 в `crypto/hashes/` |
| `packages/runtime-js/src/builtins/fs.ts` | 444 | Разбить по семействам |
| `packages/runtime-js/src/module-loader/resolver.ts` | 443 | Вынести exports-condition-matcher |
| `packages/runtime-js/src/module-loader/esm-ast-walker.ts` | 408 | Разделить walker и transformer |
| `packages/runtime-js/src/module-loader/esm-ast.ts` | 303 | На грани, можно оставить |

### 2.8 ADR-0028 / D-004 (registry URL configurable) — НАРУШЕНО

🔴 **`packages/npm-client/src/registry.ts:40`**: `/npm-registry` хардкодом. `REGISTRY_BASE_URL` env / config не читается нигде в пакете (grep подтвердил). Прямое нарушение Hard rule "No hardcoded URLs to external services. Configurable via env".

### 2.9 ADR-0016 (sw built from ts) — DOCSTRING-PROTOCOL ≠ КОД

🔴 **`packages/service-worker/src/preview-bridge.ts:13-18`**: docblock описывает `rifty:preview:ready` handshake — ни в `sw.ts`, ни в `setupPreviewBridge` его НЕТ. Документ обманывает читателя кода.

🟡 **Отсутствие `PROTOCOL_VERSION`** в `__rifty_sw_ping__`/`pong` и preview-frames: старый main + новый SW (после обновления) разойдутся молча. ADR-0016 генерирует SW из TS — версия должна быть зашита в обоих.

### 2.10 ADR-0019 (cwd in ProcessRecord) — РЕАЛИЗОВАНО

✅ Не нарушено. `process-manager.ts:88-97,112-117,191-192` делает child snapshot, mutable record, никаких globals. Эталонная реализация ADR в репо.

### 2.11 ADR-0011 (sync-ipc via SAB+Atomics) — PARTIAL

🟡 **`packages/kernel/src/spawn-worker.ts:172-183`**: `SyncRpcDispatcher` создаётся per-child + per-child `setInterval(1ms)` (`sync-dispatch.ts:90`). Docstring обещает "the same dispatcher instance can serve many rings" — должен быть синглтон. 10 параллельных воркеров = 10 busy-poll таймеров.

🟡 **`packages/runtime-js/src/builtins/worker_threads.ts:99`**: same-realm fallback без явного предупреждения; `parentPort`/`workerData` не пробрасываются в kernel worker.

### 2.12 ADR-0020 (`vfs.open*` streaming) — РЕАЛИЗОВАНО

✅ `packages/vfs/src/memory.ts:50-70` — backpressure-friendly chunked stream вместо одного big chunk. Мелкое: `chunkSize <= 0` зацикливает `pull`.

### 2.13 D-002 (UI framework isolation) — ОК, МЕЛКАЯ УТЕЧКА

✅ Проверено: ни одного `solid-js` импорта вне `apps/playground/**`.
🟢 **`apps/playground/src/adapters/realVite.ts`** на 263 строки уже не "адаптер", а толчок к `@rifty/toolchain-bootstrap` — кандидат на выделение.

---

## 3. Сводная таблица severity

| Severity | Силент-стабы | Нарушения ADR | Всего |
|---|---|---|---|
| 🔴 Критично | 16 | 9 | 25 |
| 🟡 Серьёзно | 14 | 5 | 19 |
| 🟢 Мелкое | 3 | 1 | 4 |

---

## 4. Action items (порядок исполнения)

1. 🔴 `apps/playground/src/main.tsx` — добавить `await initBackend()` (ADR-0013).
2. 🔴 `packages/runtime-js/src/builtins/os.ts:24-30` — вернуть `'rifty'`/`'wasm'` (ADR-0026).
3. 🔴 `packages/npm-client/src/registry.ts:40` — читать `REGISTRY_BASE_URL` (D-004 / ADR-0028).
4. 🔴 `packages/runtime-wasi/src/syscalls/path.ts:36`, `fd.ts:85` — закрыть `path_open`/`fd_fdstat_get` стабы (блокер для esbuild.wasm).
5. 🔴 `packages/vfs/src/opfs.ts:43-46,104-105` — разнести error mapping (ADR-0013).
6. 🔴 `packages/vfs/src/opfs-sync.ts:148,171` — починить `existsSync`/`statSync` (ADR-0014).
7. 🔴 `packages/service-worker/src/preview-bridge.ts:13-18` — реализовать `rifty:preview:ready` handshake (ADR-0016).
8. 🔴 `packages/io/src/buffer.ts`, `buffer-methods.ts` — honor `encoding`/`length`.
9. 🔴 `packages/terminal/src/terminal.ts:108-122` — починить escape-литералы.
10. 🟡 `packages/kernel/src/spawn-worker.ts:172` — синглтон-`SyncRpcDispatcher` (ADR-0011 docstring promise).
11. 🟡 ADR-0017 phase 1 finish: `IncomingMessage` поверх `request.body` ReadableStream.
12. 🟡 ADR-0015 finish: вынести `parseTarget` в `tools/shadow-registry/`.
13. 🟡 ADR-0024 finish: разнести `runtime-js/builtins/crypto.ts` (534 → 4 файла).

---

*Источник: параллельный обзор 11 модулей субагентами, 2026-05-25.*
*Каждый пункт верифицирован по `file:line` ссылке в исходном отчёте субагента.*
