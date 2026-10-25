<!-- Evidence for distribution/browsers-compat-matrix (epic browser-support-floor). Verbatim copy of the 2026-09-16 research wrap-up: external host embedding rifty 0.8, non-COI; product/company names omitted at source. Computed floors, BCD 8.0.13 versions, caniuse-lite 1.0.30001810 ratios, StatCounter 2026-08 market data, findings 3.1-3.12, dead ends, open questions. -->

# Wrap-up: браузерный порог для in-browser песочницы (rifty 0.8) — 2026-09-16

Тема: какие браузеры реально способны запустить встроенную в веб-приложение песочницу-IDE на rifty
(WebContainers-подобный рантайм: Node-совместимый JS + сборка Vite 7 в Web Worker поверх OPFS),
и какая доля аудитории, допущенной правилами browserslist хост-приложения, это потянет.
Названия продукта/компании опущены намеренно; все технические факты и цифры сохранены как есть.

---

## 1. Итоговые числа

Знаменатель — резолв browserslist-конфига хоста; числитель — подмножество, проходящее порог песочницы.
Вес — usage-данные caniuse-lite `1.0.30001810` (свежая копия; в репозитории стояла копия на ~6 мес. старше — на отношение не влияет, проверено).

### Отношение «способны запустить / допущены browserslist»

| Порог | Охват | Регион | Допущено (% всего трафика) | Способны (%) | **Отношение** |
|---|---|---|---|---|---|
| API-floor | все платформы | global | 90.705 | 87.713 | **96.70 %** |
| API-floor | все платформы | RU | 55.744 | 54.530 | **97.82 %** |
| API-floor | desktop | global | 29.196 | 28.677 | **98.22 %** |
| API-floor | desktop | RU | 29.156 | 29.039 | **99.60 %** |
| API-floor | mobile | global | 61.510 | 59.036 | 95.98 % |
| API-floor | mobile | RU | 26.588 | 25.491 | 95.87 % |
| Chromium-only | все платформы | global | 90.705 | 72.823 | **80.28 %** |
| Chromium-only | все платформы | RU | 55.744 | 46.430 | **83.29 %** |
| Chromium-only | desktop | global | 29.196 | 24.273 | 83.14 % |
| Chromium-only | desktop | RU | 29.156 | 25.762 | 88.36 % |
| Chromium-only | mobile | global | 61.510 | 48.549 | 78.93 % |
| Chromium-only | mobile | RU | 26.588 | 20.669 | 77.74 % |

Независимый пересчёт вторым агентом воспроизвёл все шесть headline-значений с расхождением ≤0.02 п.п.;
sum-check `okCov + badCov − total = 0` точно во всех 12 ячейках.

Сравнение порогов (для чувствительности):
- «только 6 проверок capability-гейта хоста» (Chrome 86 / FF 111 / Safari 15.4): **100.00 %** во всех срезах.
- «API-floor, но Safari 17 вместо 26»: 99.99 % global / 99.97 % RU (all), 99.98 % / 99.95 % (desktop).
- Гипотетический порог Cr119/FF121/Sf17.4: 99.34 % global / 98.38 % RU.

### Кого именно отрезает API-floor (вклад в п.п. трафика)

Global: `ios_saf 18.5-18.7` 1.963, `safari 18.5-18.7` 0.294, `ios_saf 17.6-17.7` 0.179, `safari 17.6` 0.133,
`ios_saf 18.3` 0.124, `safari 17.1` 0.087, `ios_saf 18.1` 0.078, `ios_saf 17.5` 0.073, `ios_saf 18.4` 0.056,
`firefox 113` 0.005. Итого 2.992 п.п. — это целиком Safari/iOS ниже 26.

RU: `ios_saf 18.5-18.7` 0.871, `ios_saf 17.6-17.7` 0.079, `ios_saf 18.3` 0.055, `safari 17.6` 0.051,
`safari 17.1` 0.044, `ios_saf 18.1` 0.035, `ios_saf 17.5` 0.032, `ios_saf 18.4` 0.025, `firefox 113` 0.007,
`firefox 111` 0.007, `safari 18.5-18.7` 0.007. Итого 1.214 п.п.

Исключающее множество — ровно 15 строк из 101 в резолве.

---

## 2. Порог браузера (доказанный код-ревью + прогоном)

| Браузер | Минимум | Связующее требование |
|---|---|---|
| Chrome / Edge | **110** | `Array.prototype.toSorted` (OPFS sync handles — 102, module workers — 80) |
| Firefox | **115** | `toSorted` 115 > module workers 114 > `DecompressionStream` 113 > OPFS 111 |
| Safari / iOS Safari | **26** | `FileSystemFileHandle.createWritable` |
| Chrome Android | **110** | `toSorted`; вся OPFS-семья на Android — с 109 |
| Firefox Android | 115 | то же, что desktop FF |
| Samsung Internet | 21.0 | `createWritable` / `createSyncAccessHandle` / `toSorted` — все 21.0 |
| Opera | 96 | = Chromium 110 |
| Opera Mobile | 74 | = Chromium 109 |

Эффективный видимый пользователю пол = max(этот порог, UA-гейт хоста) →
Chrome/Edge ≥118–120, FF ≥115, Safari ≥26, Chrome Android ≥118, Samsung ~23.

### Версии API (MDN BCD 8.0.13, сверено с релиз-нотами вендоров)

| API | Chrome | Firefox | Safari | Chrome Android | Samsung |
|---|---|---|---|---|---|
| `navigator.storage.getDirectory` | 86 | 111 | 15.2 | 109 | 21.0 |
| `createSyncAccessHandle` | 102 | 111 | 15.2 | 109 | 21.0 |
| sync-форма методов SAH (`getSize/truncate/flush/close`) | 108 | 111 | **16.4** | — | — |
| `createWritable` (+`FileSystemWritableFileStream`) | 86 | 111 | **26** | 109 | 21.0 |
| `createSyncAccessHandle({mode})` | 121 | нет | нет | 121 | 25 |
| `FileSystemHandle.remove()` | 110 | нет | нет | 110 | 21.0 |
| `removeEntry` | 86 | 111 | 15.2 | 109 | 21.0 |
| Module workers | 80 | **114** | 15 | 80 | 13.0 |
| Вложенные dedicated workers | 69 | 34 | 16.4 | — | — |
| Web Locks | 69 | 96 | 15.4 | 69 | 10.0 |
| `Compression/DecompressionStream` (gzip) | 80 | **113** | 16.4 | 80 | 13.0 |
| `Array.prototype.toSorted` | **110** | **115** | 16 | 110 | 21.0 |
| `Array.prototype.at`, `Object.hasOwn` | 92/93 | 90/92 | 15.4 | — | — |
| `crypto.randomUUID` | 92 | 95 | 15.4 | — | — |
| `Atomics.waitAsync` | 90 | **145** | 16.4 | 90 | 15.0 |
| `Object.groupBy` / `Promise.withResolvers` | 117/119 | 119/121 | 17.4 | — | — |
| `Array.fromAsync` | 121 | 115 | 16.4 | — | — |
| `Scheduler.postTask` | 94 | 142 | нет | — | — |
| `StorageManager.estimate` | 61 | 57 | 17 | — | — |

Даты релизов: Safari 16.4 — 27.03.2023 («Made all FileSystemSyncAccessHandle methods synchronous»),
Safari 26.0 — 15.09.2025 (File System WritableStream API), Firefox 111 — 14.03.2023, FF 113 — 09.05.2023,
FF 114 — 06.06.2023, FF 145 — 11.11.2025, Chrome 102 — 24.05.2022, Chrome 108 — 29.11.2022,
Chrome 110 — 07.02.2023, Chrome Android 109 — 10.01.2023, Chrome 121 — 23.01.2024.
Samsung Internet → Chromium: 28.0 = 130 (02.04.2025), 29.0 = 136 (25.10.2025), 30.0 = 143 (11.05.2026).

---

## 3. Findings с доказательствами

### 3.1 `createWritable` — решающее ограничение (CONFIRMED, статически и эмпирически)

- При передаче объекта `storage` в `createSandbox` rifty 0.8 всегда выбирает **replica-layout**
  (`boot.ts: storage === undefined ? 'files' : 'replica'`). В replica sync access handle используется
  **только** для `writer.lock` (`opfs-replica-store.ts:62`, в него не пишут), а все durable-байты идут через
  `writeNative()` → `file.createWritable()` (`opfs-replica-store.ts:87-105`; в минифицированном виде —
  функция `oe` на смещении ~39242 в `chunk-JZCW7RWJ.js`), вызывается безусловно дважды за коммит
  (сегмент + HEAD, `:257-258`).
- Альтернативного пути нет: `enqueue(op, paths, replica ? undefined : task)` + жёсткая проверка
  «OPFS drain requires exactly one execution mode» (`opfs-drain-scheduler.ts:251`). В non-replica layout
  `OpfsVfs.writeFile` тоже идёт через `createWritable` (`opfs.ts:148`).
- Единственная capability-проверка внутри — `OpfsFsSync.isSupported()` (`opfs-sync.ts:135-146`): проверяет
  worker-realm и `createSyncAccessHandle`. Safari 15.2+ её проходит → `vfs.backend === 'opfs'` →
  хостовая защита «Persistent browser storage is unavailable» не срабатывает.
- **Прогон в реальном Chromium** (Playwright 1.62.1, Chromium 142.0.7444.32 и 148.x в другом заходе),
  конфиг хоста 1:1, без COI, чистый OPFS:
  - инструментальный прогон: boot → `{vfsBackend:'opfs'}`, 0 вызовов `createWritable`;
    первый `openProject()` → OK за 3981 мс, ровно **20** вызовов `createWritable`, 0 записей через sync handle,
    все стеки `toolchain-worker.js → oe → ge.commit → persistReplicaBatch`;
  - эмуляция Safari 15.2–18.x (удалены `FileSystemFileHandle.prototype.createWritable` и
    `FileSystemWritableFileStream`, `createSyncAccessHandle` оставлен): boot по-прежнему успешен,
    `openProject()` реджектится за **3 мс**:
    `SandboxPersistenceError: OPFS persistence failed (2 unhealed): /<project>: (intermediate value).createWritable is not a function; /<project>/.gitignore: …`
  - повторный `openProject()` → снова падает, множество «unhealed» растёт 2 → 3; самолечения нет;
  - тёплый путь (OPFS уже наполнен способным браузером) — чтение работает (sentinel, зависимость `react`),
    сборка — нет.
  - падение наступает **раньше** распаковки gzip-снапшота: `DecompressionStream` даже не вызывается.
- Третий вариант пробы (шим, который удаляет API до вычисления hoisted-импортов) дал байт-идентичный отказ —
  ветки с feature-detect не существует.
- Второй, независимый барьер: публикация собранного плагина пишет через `createWritable` на главном потоке
  (`localPlugin/storage.ts:170,178`), т.е. даже исправление в rifty не снимет Safari <26 для publish.
- Репозиторий сам содержит fault-injection на этот API: приёмочный раннер подменяет
  `FileSystemFileHandle.prototype.createWritable`, считает вызовы и при `failWrites:true` ожидает реджект
  reset/snapshot (`assert.rejects(..., /persist/i)`).

### 3.2 `Array.prototype.toSorted` — реальный вызов, не строка (CONFIRMED)

Единственный ES2023-builtin во всём достижимом графе, 2 колл-сайта в одной 4-строчной функции входного файла:
```
files: Object.freeze(e.toSorted((o,c)=>o.path.localeCompare(c.path))),
directories: Object.freeze(r.toSorted())
```
(минифицировано — смещения 10997 и 11072 в `toolchain-worker.js`; в неминифицированном исходнике
`no-coi-toolchain-worker.js:386-387`, приёмники видимо `const files = []` / `const directories = []`).
Вызывается безусловно в хвосте обработчиков `open`, `apply-snapshot`, `install` и на `command`.
Без него — `TypeError: e.toSorted is not a function` → реджект `openProject()`.
Цена: +17 мажоров Chrome и +23 мажора Firefox к порогу; на Safari не влияет.
Ирония: собственный забандленный TypeScript в том же графе использует `e.slice().sort(t)`.

### 3.3 `DecompressionStream('gzip')` — требуется (CONFIRMED)

- Тарбол зависимостей качает **воркер** (главный поток тянет только JSON-сайдкар метаданных);
  gunzip — через `DecompressionStream`, без фича-детекта и без JS-fallback, решение по magic-байтам `1f 8b`.
- Нужен на **первом** открытии, при смене identity зависимостей, после eviction и при explicit reset;
  обычный тёплый reopen идёт веткой `toolchain.open`, в модуле которой ссылок на compression-streams нет вовсе.
- `CompressionStream` дополнительно нужен на сборке: репортер размеров gzip в Vite включён по умолчанию.
- Порог: Chrome 80 / FF 113 / Safari 16.4 — ниже, чем `toSorted`, поэтому не связывающий (кроме Safari).

### 3.4 SharedArrayBuffer / Atomics — забандлены, но недостижимы (CONFIRMED «не влияет»)

- Все 36 вхождений `Atomics.*` лежат в 6 функциях внутри kernel/SAB-транспорта; все прочие вхождения
  `SharedArrayBuffer` — строковые литералы, `typeof`-гарды или сравнения через `Object.prototype.toString`.
- Единственный вход — `spawnKernelWorker`, который падает первым же стейтментом:
  `kernelWorkerUrl not configured`; переменные URL kernel- и node-entry-воркеров **не присваиваются нигде**
  в достижимом графе.
- Вывод: браузер без SAB (без COOP/COEP) выполняет **ноль** вызовов Atomics — только два `typeof`-чтения.
  Firefox НЕ поднимается до 145 из-за `Atomics.waitAsync`.

### 3.5 Топология воркеров (PARTIAL — вложенные воркеры НЕ нужны)

- Ровно **один** Worker: страница → `new Worker('/rifty/toolchain-worker.js', { type: 'module' })`.
- Единственный `new Worker(e,{type:"module"})` внутри графа воркера мёртв (его URL никогда не присваивается).
- Модуль `worker-*.js` импортируется динамически **в тот же realm**, а не как дочерний воркер
  (в COI-деплое тот же файл — отдельная точка входа).
- Требуется динамический `import()` внутри воркера (сборка с `splitting: true`): чанки компилятора/установщика
  подтягиваются лениво на стадиях open/install/build.
- Следствие: Safari 16.4 (вложенные воркеры) не является порогом; module workers Safari 15 / FF 114.

### 3.6 Синтаксический и библиотечный пол шипящихся ассетов

- Воркер-бандлы собираются отдельным проходом esbuild с `target: ['es2022']`, `format: 'esm'`,
  `splitting: true`, **без полифилов** — то есть полностью минуют downlevel основной сборки приложения
  (та компилируется под browserslist).
- Собственный acorn-скан 22 достижимых файлов: минимальная `ecmaVersion`, при которой парсится — по файлам
  es2017…**es2022**; единственная причина es2022 — синтаксис полей класса (`class extends Error{code;path;…}`),
  плюс `#private` поля и методы. Ни одного `class static block`, ни одного top-level await.
- AST-скан реальных вызовов (не строк): `.at()`, `Object.hasOwn`, `String.replaceAll`, `crypto.randomUUID`,
  `WeakRef`, `FinalizationRegistry`, `DecompressionStream`, `CompressionStream` (за `typeof`-гардом),
  `structuredClone`, `.toSorted()`. **Нет** `Object.groupBy`, `Promise.withResolvers`, `Array.fromAsync`,
  RegExp-флагов `d`/`v`.

### 3.7 WebAssembly — не связывающее требование

- Rollup подменён на WASM-сборку, esbuild — на esbuild-wasm за шимом.
- Декодировано через wabt: модуль Rollup 577 КБ — нужны sign-extension + bulk-memory; модуль esbuild (Go)
  13.9 МБ — те же плюс non-trapping float-to-int. Ни SIMD, ни threads/atomics, ни reference types, ни GC,
  ни exception handling.
- Порог этих предложений: Chrome 75 / FF 79 (bulk-memory), Safari 15 — то есть ниже всего остального.
- Rollup компилирует модуль **синхронным** `new WebAssembly.Module(bytes)` — на буфере >4 КБ это легально
  только вне главного потока; структурная причина, почему сборка живёт в воркере.

### 3.8 Capability-гейт хоста: 6 проверок, две из них неверные

Проверки: `isSecureContext === true`, `typeof Worker === 'function'`, module-worker-проба,
`Boolean(navigator.serviceWorker)`, `typeof navigator.storage.getDirectory === 'function'`,
`typeof navigator.locks.request === 'function'`. При `ready === false` boot не запускается вовсе,
показывается чек-лист; «попробовать всё равно» нет.

- `serviceWorker` — ложноотрицательная проверка: рантайм явно стартует с `skipServiceWorker: true`.
  SW нужен только для доставки собранного плагина в слот приложения.
- module-worker-проба конструирует `new Worker('', { get type(){…} })` и лишь фиксирует, что геттер прочитан.
  Геттер срабатывает до валидации enum/поддержки → Firefox 111–113 проходит пробу и падает уже на boot.
  Побочный эффект: пустой URL не бросает, а тратит аутентифицированный SSR-запрос на текущий URL страницы
  и течёт Worker при каждом mount.
- Гейт не проверяет ни `createSyncAccessHandle`, ни `createWritable` — ровно то, на чём всё ломается.
- В i18n остались мёртвые ключи `capability-crossOriginIsolated`, `capability-sharedArrayBuffer`,
  `capability-atomicsWaitAsync` для несуществующих проверок.

### 3.9 Серверный UA-гейт (определяет знаменатель)

- Middleware «incompatible browsers» подключается автоматически фреймворком, если не выставлен
  `disableIncompatible` (в конфиге он `true` только для платформы `app`, т.е. для веба гейт включён).
- Логика: боты пропускаются (`isbot`); иначе `matchesUA(userAgent, { browsers, allowHigherVersions: true })`
  против browserslist, загруженного через `browserslist.loadConfig({ path: __dirname })` с fallback на
  пресет дизайн-системы (без хостовой добавки `Firefox >= 109`); при несовпадении рендерится
  отдельная страница-заглушка вместо приложения. Обход — кука `has_applied_incompatible_browser=1`.
- Проверено локально на `browserslist-useragent@4.0.0`: UA вида
  `… Chrome/130.0.0.0 YaBrowser/25.6.0.0 Safari/537.36` резолвится как `{family:'Chrome', version:'130.0.0'}`
  и **проходит** гейт; Chrome/Safari/Firefox — тоже.

### 3.10 Требования вне версий браузера

1. **Память воркера не ограничена и не измерена.** В replica-режиме VFS полностью резидентен в памяти
   (`content.set(path, bytes)` на каждый файл; `openSync`/`refreshIndex` бросают
   «replica has no external per-file surface», ленивого чтения нет). Замеренная нагрузка:
   **23 654 файла node_modules / 90.5 МБ** + 3.7 МБ replay-кэша (внутри — `esbuild-wasm-0.28.0.tgz`),
   плюс три Map по ~23 тыс. записей, плюс сама сборка Vite (**2 733 модуля**). В артефактах замеров —
   только миллисекунды и байты, только Chromium 148 desktop; данных о памяти нет вовсе.
   `os.totalmem()` захардкожен в 1 ГиБ, `os.cpus()` выводится из `navigator.hardwareConcurrency`.
2. **Secure context обязателен** — `crypto.randomUUID`, `navigator.storage`, `navigator.locks`,
   `navigator.serviceWorker`, `crypto.subtle.digest`. Инсталляция по plain `http://` не сможет вообще.
3. **CSP.** Загрузчик модулей rifty построен на `new Function` + непрямом `eval`, плюс нужен WebAssembly.
   Прод-CSP приложения: `script-src` без `'unsafe-eval'` и без `'wasm-unsafe-eval'`, `worker-src: ['self','blob:']`.
   Работает, пока сами воркер-ассеты отдаются **без собственного CSP-заголовка** (воркер берёт политику из
   своего ответа). Приёмочный прогон делается на localhost-origin вообще без CSP — т.е. это не проверено
   ни в одном движке. Если Firefox/Safari наследуют политику документа в module-worker, песочница
   становится Chromium-only независимо от версий.
4. Параметры replica-хранилища: целевой размер сегмента 4 МиБ, компакция при 64 сегментах,
   объекты в OPFS — `.rifty-replica-v1/{HEAD, writer.lock, <content-addressed segments>}`;
   т.е. 23.6 тыс. файлов зависимостей превращаются примерно в один базовый сегмент, а не в 23.6 тыс. файлов OPFS.
5. Замер тёплого открытия: «Warm open made zero instrumented native writes» (`warmWrites: 0`).

### 3.11 Квоты, приватные режимы, прочие «не-версийные» обрывы

- **Firefox**: best-effort квота = min(10 % диска профиля, 10 ГиБ), общая на site-group; persistent —
  50 % диска, cap 8 ТиБ; вытеснение LRU. **OPFS не работает в Private Browsing** (баг открыт с 04.07.2025,
  отдельный баг про SAH в PBM заведён 08.09.2026, патч от 14.09.2026). Нет `{mode:'readwrite-unsafe'}`
  (баг с 03.12.2024 всё ещё NEW; смежный ASSIGNED с патчем от 25.02.2025) — конкурентные SAH на одном файле
  дают `NoModificationAllowedError` и должны сериализоваться через Web Locks. Есть баг (UNCONFIRMED,
  03.08.2026) о том, что SAH `write()` не бросает `QuotaExceededError` за квотой.
- **Chromium**: 60 % полного объёма диска на origin, ~5 % в инкогнито; вытеснение LRU.
  Потолок на Android — память V8: old-gen = physical/4, клэмп [256 МБ, 4 ГБ на 64-бит / 1 ГБ на 32-бит];
  wasm32 — 65 536 страниц (4 ГиБ) на 64-бит, 32 767 (~2 ГиБ) на 32-бит; максимум модуля 1 ГиБ.
- **Safari/iOS**: c 17.0 квота origin ≤60 % диска для браузера (≤15 % для прочих WebKit-приложений),
  общая ≤80 %/≤20 %; cross-origin фрейм получает ~10 % квоты родителя. До 17 — 1 ГиБ и промпт.
  Замер на Safari 26 / macOS (28.05.2026): `estimate().quota = 82 463 372 084` байт (~76.8 ГиБ).
  ITP: всё скриптозаписываемое хранилище удаляется после 7 дней использования браузера без взаимодействия
  с сайтом. **Lockdown Mode с Safari 16.4 отключает Web Locks** (а также Cache API/CacheStorage/ServiceWorkers).
  `navigator.storage.estimate()` — только с Safari 17.
- Сопоставимый продукт (WebContainers у известного облачного IDE): официально «полностью — Chrome и
  Chromium-браузеры, в бете — Firefox и Safari (Safari с 16.4, iOS/iPadOS с 16.4), частично — Android»,
  и **встраивание поддерживается только в Chromium**. Страница помечена «Last update: February 2023».

### 3.12 Проверялось ли на не-Chromium — нет

- Приёмочный раннер импортирует только `chromium`; профилировщик — `chromium.launchPersistentContext`.
- Все 5 JSON-артефактов замеров: `"browser":"148.0.7778.96"`, методы — «Local headless Chromium» /
  «Local disposable Chromium origins». Нулевые совпадения по `firefox|webkit|gecko|safari` в измерениях и тулинге.
- В ревью апгрейда прямо записано: «Не проверены: … Safari/Firefox …».
- Позиция апстрима по рекону: «Chrome-first … Firefox/Safari are explicitly not the target».
- Оценка риска для Firefox 115+: **вероятно работает** — Chromium-специфичных API в слое хранилища не найдено
  (`remove()` не используется, `mode` не передаётся, SAH берётся без опций, число объектов OPFS мало).
  Главный кандидат на поломку — освобождение эксклюзивного лока `writer.lock` при перезагрузке страницы:
  новая страница ретраит 30 с и падает с «OPFS replica writer is unavailable or already occupied».
  Второй — Private Browsing (гейт этого не ловит, сообщение будет неинформативным).
  Известно, что rifty в комментариях полагается на chromium-поведение `.crswap` (атомарный swap `createWritable`).

---

## 4. Рыночные данные (StatCounter; последний полный месяц — август 2026)

Регион RU, все платформы: Chrome 51.56, Yandex Browser 26.26, Safari 5.88, Opera 5.34, Edge 5.14,
Firefox 4.63, Samsung Internet 0.73, Brave 0.21, UC 0.07, Android stock 0.07.
(июнь/июль/сентябрь-частично: Chrome 52.21 / 48.39 / 45.97; Yandex 25.64 / 28.96 / 30.27.)

RU desktop: Chrome 51.21, Yandex 27.62, Edge 6.83, Opera 6.38, Firefox 5.74, Safari 1.49.
RU mobile: Chrome 53.00, Yandex 21.88, Safari 19.09, Opera 2.21, Samsung 1.75, Firefox 1.35.

Worldwide, все платформы: Chrome 69.28, Safari 15.92, Edge 5.39, Firefox 2.98, Samsung 2.02, Opera 1.93,
UC 0.62, Brave 0.57, Yandex 0.28.
Worldwide desktop: Chrome 73.17, Edge 10.51, Firefox 5.31, Safari 5.28, Opera 1.98, Samsung 1.53,
Brave 0.83, Yandex 0.36.

Доли платформ (август 2026): RU — desktop 74.88 %, mobile 24.50 %, tablet 0.62 %;
worldwide — desktop 49.11 %, mobile 49.36 %, tablet 1.54 %.

Версии:
- Chrome desktop на трёх свежих мажорах (150/151/152): RU 36.3 %, WW 53.9 %; на двух (151/152): 25.5 % / 38.7 %;
  **старше Chrome 110: RU 13.5 %, WW 6.3 %** (от numeric-versioned Chrome).
- Safari desktop: 26.x — 62.5 % RU / 63.8 % WW; 18.x — 11.0 % / 12.4 %; 17.x — 8.8 % / 12.0 %
  (Wikimedia, неделя 06.09.2026: 62.37 / 12.22 / 8.58).
- Firefox ESR от всего Firefox (StatCounter desktop): ESR115 RU 10.3 % / WW 5.1 %; ESR128 0.2 % / 0.6 %;
  ESR140 1.8 % / 2.9 % (Wikimedia: 2.30 / 2.53 / 3.87).
- Android Chrome по версиям StatCounter **не отдаёт** (одна строка «Chrome for Android» = 60.14 % WW / 49.75 % RU).
  По Wikimedia (неделя 06.09.2026): старше Chrome 110 — **0.82 %** просмотров Chrome Mobile; старше 100 — 0.55 %;
  старше 90 — 0.30 %; на 152+ — 77.54 %, на 151+ — 89.39 %, на 140+ — 95.85 %.
- Релизы Chrome: 148 — 05.05.2026, 149 — 02.06.2026, 150 — 30.06.2026, 151 — 28.07.2026, 152 — 25.08.2026,
  153 — 08.09.2026 (переход с 4-недельного на 2-недельный цикл), 154 — 22.09.2026.
- Firefox на 16.09.2026: stable 156.0 (релиз 15.09.2026), ESR 140.16.0esr, ESR-next 153.3.0esr,
  legacy ESR 115.41.0esr (ESR 128 — EOL).

### Дыра в usage-данных

caniuse-lite перечисляет ровно 19 агентов (`ie, edge, firefox, chrome, safari, opera, ios_saf, op_mini,
android, bb, op_mob, and_chr, and_ff, ie_mob, and_uc, samsung, and_qq, baidu, kaios`) — **Yandex Browser
отсутствует и в Chrome не сворачивается, а просто выпадает** (issue закрыт мейнтейнером 26.10.2018:
«Yeah, both are based on existing browser engines, so not in a hurry to include them»; более общий issue
по форкам открыт с 12.03.2025). Отсюда: сумма usage по RU в caniuse-lite 1.0.30001810 — всего **66.66 %**,
а покрытие резолва browserslist по RU — 55.744 % против 90.705 % global.

**Альтернативная модель на StatCounter (RU desktop, август 2026), Yandex/Opera/Edge считаем Chromium
их же версии Chrome:** Chromium-семейство = 51.21+27.62+6.83+6.38 = **92.04** из 99.27 перечисленных
(**≈92.7 %**); Safari 1.49, из них 26.x — 62.5 % → 0.93 способны, 0.56 нет; Firefox 5.74 — практически весь
≥115 (ESR 115 проходит ровно). Итог: **≈99 % способных среди допущенных**, из них **≈93 % на Chromium**.
Версии Chrome старше 118 отсекаются UA-гейтом и выпадают из обеих частей дроби, поэтому отношение не меняется.

---

## 5. Decisions

- **Считать отношение `coverage(подмножество)/coverage(резолва)`, а не абсолютное покрытие.** Абсолютные
  проценты caniuse (90.7 % global / 55.7 % RU) искажены отсутствием Yandex Browser; отношение к этому
  почти нечувствительно.
- **Свежая caniuse-lite ставится в /tmp, а не обновляется в репозитории** (`npx update-browserslist-db`
  тронул бы lock-файл; задача — только отчёт).
- **Три уровня ответа вместо одного числа**: (1) формальный гейт хоста, (2) доказанный API-порог,
  (3) фактически проверенное (Chromium). Одно число без этой разбивки вводит в заблуждение, потому что
  96.7 % держится ровно на одном неохраняемом вызове `createWritable`.
- **Порог валидируется тремя независимыми способами**: чтение минифицированных отдаваемых ассетов,
  чтение неминифицированных двойников (в т.ч. восстановленных из sourcemap `sourcesContent`), и прогон
  в реальном браузере с вырезанным API.
- **Мобильные срезы считаются, но не выносятся в заголовок**: точка входа всё равно desktop-only,
  а caniuse схлопывает все версии мобильных браузеров в одну строку.

---

## 6. Dead ends (не повторять)

- **`Object.groupBy` / `Promise.withResolvers` / `Array.prototype.with` в бандле** — ложные срабатывания
  грепа: это строки в таблицах lib-имён забандленного TypeScript (`es2024:["withResolvers"]`,
  `es2023:[…,"toSorted",…]`) либо одноимённые методы своих объектов (`ChangeTracker.with`, semver `.with`,
  import-атрибут `with`). Проверять AST-скан, а не текстовый греп. Из 13 вхождений `.at()` пять — не Array/String.
- **Гипотеза «Firefox упрётся в `Atomics.waitAsync` (145)»** — снята: SAB-транспорт недостижим.
- **Гипотеза «нужны вложенные воркеры → Safari 16.4»** — снята: воркер ровно один.
- **Гипотеза «sync-форма методов SAH появилась в Safari 17»** — неверна, это **16.4**
  (прямая цитата из релиз-нот WebKit + отдельный ключ `sync_version` в BCD + коммит/баг).
  На 15.2–16.3 `read()/write()` были синхронны, а `getSize/truncate/flush/close` возвращали Promise.
- **Гипотеза «используется Chromium-only `FileSystemHandle.remove()`»** — нет: все найденные `.remove(`
  относятся к claims-слою и к isomorphic-git; OPFS-слой использует стандартный `removeEntry`.
- **`createSyncAccessHandle({mode:'readwrite-unsafe'})`** не используется (вызов без аргументов),
  поэтому Chrome 121 не является порогом.
- **`browserslist` не резолвит env `onPrem`** из-за `extends`-пакета без префикса `browserslist-config-`
  (`BrowserslistError: … Use dangerousExtend option`); содержимое пришлось читать из самого пакета:
  `['Chrome >= 120','Edge >= 141','Firefox >= 144']` (покрытие 25.06 % global / 27.07 % RU —
  несопоставимо с defaults, т.к. запрос не включает `and_chr`).
- **BSD `xargs` не поддерживает `-a`** (macOS) — из-за этого первый проход грепа по списку файлов дал
  ложные нули по всем паттернам; использовать `xargs … < file`.
- **Ловушка с вложенной копией `caniuse-lite`** внутри `node_modules/browserslist/node_modules/` при сравнении
  свежих и старых данных: её нужно заменять вручную, иначе сравнение бессмысленно.

---

## 7. Open questions

1. **CSP в проде** — наследует ли dedicated module worker политику документа в Firefox и Safari
   (в Chromium проверено: берёт из своего ответа). Один прогон Playwright на движок закрывает вопрос;
   при «наследует» песочница Chromium-only вне зависимости от версий.
2. **Реальный Safari.** Отказ воспроизводился удалением API в Chromium, не на WebKit. Safari 26 не запускался
   вовсе; Playwright WebKit установлен, но это не Safari.
3. **Память.** Переживёт ли сборка из 2 733 модулей рядом с ~90 МБ резидентного VFS вкладку iOS
   (jetsam ~1–1.5 ГБ, на старых устройствах меньше). Замеров нет ни для одного движка.
4. **Квота iOS/iPadOS** против требуемых ~90–95 МБ (пик до ~2× во время компакции сегментов).
5. **Освобождение `writer.lock` в Firefox** при teardown воркера на перезагрузке.
6. **Партиционирование OPFS в Firefox** при cross-origin iframe-встраивании: в списке статически
   партиционируемых API на MDN File System API не упомянут (dFPI включён по умолчанию с Firefox 103).
7. **Chromium-база Yandex Browser официально не публикуется** с 2023 г. Косвенно: UA десктопной линии 26.8 —
   `Chrome/150.0.0.0`; отставание оценивается в 2–3 релиза. Корпоративные сборки: 13 релизов за ~14 месяцев.
   Версионное распределение Android-Chrome по RU публично недоступно ни из одного источника.
8. Насколько накапливаются replica-сегменты между base-rebuild'ами (влияет на квоту).

---

## 8. Воспроизведение расчёта

```js
// floor.mjs — отношение coverage(подмножество)/coverage(резолв)
const GRAVITY=['last 3 years and fully supports es6 and > 0.05%','not dead','not op_mini all',
  'not and_qq > 0','not and_uc > 0','Firefox ESR','Firefox > 0 and last 3 years and > 0.01%'];
const TARGET=[...GRAVITY,'Firefox >= 109'];          // browserslist хоста, env defaults
const FLOOR={chrome:'110',edge:'110',firefox:'115',safari:'26',ios_saf:'26',
             and_chr:'110',and_ff:'115',samsung:'21',opera:'96',op_mob:'74'};
// list = browserslist(TARGET); ok = list.filter(meets FLOOR);
// answer = browserslist.coverage(ok, region) / browserslist.coverage(list, region) * 100
```
Резолв `defaults` — 101 строка, минимумы: chrome 118, edge 119, firefox 109, safari 17.1, ios_saf 17.5,
samsung 28, opera 131, op_mob 80, and_chr 151, and_ff 153.
Проверка версий API — `@mdn/browser-compat-data@8.0.13`; синтаксический пол — acorn 8.18, `sourceType:'module'`,
подбор минимальной `ecmaVersion`; достижимый граф — обход `from "./x.js"` / `import("./x.js")` от точки входа
(22 файла, ~5.02 МБ).


---

## Repo-side computations (2026-09-27, all tracked traffic basis)

Command (repo root; caniuse-lite from `node_modules/.pnpm/caniuse-lite@1.0.30001793`): sum of `agents[a].usage_global[v]` (global) and `region(RU)[a][v]` (RU) over the listed versions; tracked sum = same over every agent/version.

```
caniuse-lite 1.0.30001793 | tracked sum global 96.271 RU 51.342
chrome 108+109: global 0.890 RU 3.440
safari 16.4-25.x: global 0.958 RU 0.239 | ios_saf 16.4-25.x: global 3.937 RU 1.546 | both 4.895 1.784
firefox 114: global 0.000 RU 0.008
and_chr rows: 148
```

Note: the research §1 ratios above use the external host's browserslist resolve as denominator; the numbers here are absolute shares of all tracked traffic (RU tracked sum 51.34 in this copy — Yandex Browser absent).
