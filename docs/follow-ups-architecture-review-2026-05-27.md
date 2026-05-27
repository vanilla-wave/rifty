# Follow-ups — architecture review 2026-05-27

Триаж выводов архитектурного ревью (12 параллельных Explore-субагентов: по одному на M0–M10 + ADR-аудит). Источник — текущая сессия. Существующий `follow-ups-2026-05-27.md` относится к предыдущему аудиту (2026-05-26) и не пересекается.

Каждый пункт несёт **Decision (2026-05-27)** строку. Status legend идентичен `follow-ups-2026-05-27.md` (`EXECUTE`, `ADR_THEN_EXECUTE`, `EXECUTE_VIA_SUBAGENT`, `DEFER_M11/M12`, `DOC_DECISION`, `NEEDS_BROWSER`).

---

## Tier 1 — корректность и заявленный контракт

### 1. M6: `WorkerProcessHandle` без `send()` — fork-IPC через Worker упадёт

**Why it matters:** `TASKS.md:115` заявляет «fork(modulePath) возвращает child с IPC ✅», но `packages/kernel/src/process-manager.ts:92` явно комментирует «Does NOT carry send: fork-mode IPC… pending ADR-0011 phase 2 follow-up». `SameRealmProcessHandle` (line 71–76) имеет send/on, `WorkerProcessHandle` — нет. При включённом SAB-режиме `child.send(msg)` упадёт. Это прямое расхождение между декларированным и реальным контрактом, и оно ломает реальные fork-based Node-скрипты (`cluster`, многие CLI-инструменты).

**Action:**
- Завести парный `MessagePort` (parent→child + child→parent) при `spawnWorker(spec)`, привязать к `process.send` / `'message'` в worker-entry.
- Добавить регрессионные парные тесты (parent.send → child reply через postMessage round-trip).
- Phase 2 follow-up ADR-0011: новый ADR-0045 (или ADR-0011 supersede), описывающий IPC frame shape, error-on-disconnect семантику.

**Reversibility:** меняет публичный контракт `ProcessHandle` (новые методы send/on в Worker-варианте), добавляет новый wire-frame в SAB-протокол → **IRREVERSIBLE** (триггеры 1+3 чеклиста).

**Decision (2026-05-27):** `ADR_THEN_EXECUTE` — IRREVERSIBLE. Сначала ADR-0045 (Worker-process IPC: parent↔child MessagePort + frame shape + disconnect semantics), затем имплементация в kernel + runtime-js builtins + 2–3 conformance-теста. Подходит под `EXECUTE_VIA_SUBAGENT` — скоуп локализован в `packages/kernel/src/process-manager.ts` + `packages/runtime-js/src/builtins/child_process.ts`, downstream effects понятны. → **DONE this session** — диспетчирован subagent'у; ADR-0045 + `WorkerProcessHandle.send/disconnect/'message'` + worker-side `process.send/on('message')` + conformance-кейсы.

**Refs:** M6 audit, ADR-0011 (phase 2), `process-manager.ts:92`, `child_process.ts:289-295`.

---

### 2. M6: in-realm `execSync` fallback тихо моделирует процесс через `new Function`

**Why it matters:** `packages/runtime-js/src/builtins/child_process-sync.ts:48-69` при отсутствии SAB-capability исполняет код через `new Function` в текущем realm — без exit code, без stdio изоляции, без выделенного PID. Это нарушает CLAUDE.md «No silent stubs». В CI/Node-окружении (где SAB обычно есть) проблема не видна, но в браузерах без cross-origin isolation поведение разъезжается с заявленным контрактом.

**Action:**
- Заменить fallback на `throw new NotImplementedError('execSync requires SharedArrayBuffer; enable cross-origin isolation (COOP/COEP) or run in a SAB-capable realm')` с указанием на capabilities-detector.
- Обновить `tests/conformance/builtins/exec-sync-worker.test.ts` — добавить case на NotImplementedError в non-SAB окружении.

**Reversibility:** один файл + один тест, контракт не расширяется — добавляется loud-throw. **REVERSIBLE.**

**Decision (2026-05-27):** `EXECUTE` — single-file loud-throw, без ADR. Удалит молчаливый stub, явно зашьёт capability-зависимость в API. → **DONE this session** — `child_process-sync.ts` теперь бросает `NotImplementedError('child_process.execSync', ...)` вне SAB-Worker-окружения; `tests/conformance/builtins/child_process.test.ts` `describe('child_process.execSync')` переписан на assert NotImplementedError, `exec-sync-worker.test.ts` получил парный `skipIf(sabReady)` describe-блок для non-SAB пути. CLAUDE.md hard-rule "no silent stubs" соблюдён.

**Refs:** M6 audit, CLAUDE.md «Hard rules → No silent stubs», ADR-0011.

---

### 3. M9: ADR-0028 prod proxy — Vercel Edge Function отсутствует

**Why it matters:** ADR-0028 помечен **Accepted**, acceptance criteria #1 требует файл `apps/playground/api/npm-registry/[...path].ts`. Файла нет. `OPEN_QUESTIONS.md` и `PROJECT_PLAN.md` указывают вопрос как решённый. Это **ADR-as-aspiration** — самый опасный паттерн, потому что выглядит как готовое решение. При попытке деплоя в прод npm-install не доедет до registry.

**Action (выбрать одно):**
- **A.** Имплементировать Edge Function: handler, route mapping, кеширование (или explicit no-cache), README; обновить ADR-0028 с реальными ссылками на код.
- **B.** Откатить статус ADR-0028 в **Provisional** + вернуть Q-2026-05-24-007 в `OPEN_QUESTIONS.md` как живой вопрос «prod-proxy decision deferred — Vercel chosen *as candidate*, implementation TBD by deploy-time».

**Reversibility:** вариант A — новый файл + Vercel runtime dependency → **IRREVERSIBLE**. Вариант B — изменение статуса ADR + восстановление OPEN_QUESTIONS-записи → **REVERSIBLE** (доковая правка).

**Decision (2026-05-27):** `DOC_DECISION` — выбираем B. Реальный деплой ещё не делался, имплементация Edge Function без живого URL и тестов с registry легко скиснет до первой деплой-сессии. Лучше честный provisional + tracked Q-... чем мёртвый ADR. Когда дойдём до фактического деплоя — отдельный ADR-0046 (или ratify ADR-0028 v2) с реальным кодом. → **DONE this session** — ADR-0028 helper-секция «Status update — 2026-05-27» переводит статус в Provisional; Q-2026-05-24-007 восстановлен в Active в `OPEN_QUESTIONS.md`; `PROJECT_PLAN.md §9` отражает повторное открытие.

**Refs:** ADR-0028, `OPEN_QUESTIONS.md` Q-2026-05-24-007, M9 audit, `apps/playground/api/` (не существует).

---

## Tier 2 — архитектурный долг, не блокирует следующий шаг

### 4. M7: cross-realm preview-port — buffered only, нет streaming

**Why it matters:** `packages/net/src/cross-realm/preview-port.ts:24-29` явно комментирует «Buffered request/reply only». Main-thread путь (M7 done) поддерживает streaming через `packSerializedResponse`. Worker-realm путь (после ADR-0043) — нет. Real Vite в Worker отдаёт SSR-страницы и большие модули — буферизация в `Uint8Array` через `BroadcastChannel` сожрёт память и убьёт latency на больших файлах.

**Action:**
- Расширить wire-frame `bridgeCrossRealmPreview` на streaming chunks (`{kind: 'chunk', seq, data}` + `{kind: 'end'}`).
- Bump `SW_FRAME_VERSION` (ADR-0040) — handshake уже умеет mismatch.
- Парные тесты: large-body round-trip, error mid-stream.

**Reversibility:** новый wire-frame + version bump → **IRREVERSIBLE** (ADR_THEN_EXECUTE). Требует ADR-0046 (streaming cross-realm preview).

**Decision (2026-05-27):** `DEFER_M11` — A-023 уже tracked в `OPEN_QUESTIONS.md`. Сейчас не блокирует ни одну integration-фикстуру (мелкие модули в `examples/vite-like-dev` помещаются в один frame). Поднимается, как только Real Vite начнёт отдавать большие responses (vendor-prebundle, source maps). → **DEFERRED + TRACKED this session** — добавлена «Cross-deferral note (2026-05-27, post-audit)» в `OPEN_QUESTIONS.md` под Q-2026-05-27-002, чтобы streaming-концерн не потерялся параллельно с A-023. Код не трогаем — buffered-shape корректен до первой Real Vite vendor-prebundle response.

**Refs:** M7 audit, ADR-0040, ADR-0043, `preview-port.ts:24-29`, Q-2026-05-27-002.

---

### 5. M7: protocol-mismatch — только 503 без `console.error`

**Why it matters:** `packages/service-worker/src/preview-bridge.ts:204` возвращает структурированный `{kind, expected, got}` через replyPort, но в браузере пользователь видит blank page. Нет console-side диагностики. При апгрейде версии (`SW_FRAME_VERSION` или `SW_ROUTING_VERSION`) разработчик потратит час, пока поймёт, что застрял на старом SW.

**Action:**
- В `preview-bridge.ts:204` и `route-preview.ts:89` добавить `console.error('[rifty:sw] protocol mismatch', {expected, got})` перед 503-ответом.
- Опционально: post в `rifty:diagnostics` channel для UI-ового capabilities panel.

**Reversibility:** 2 файла, чистое логирование → **REVERSIBLE.**

**Decision (2026-05-27):** `EXECUTE` — quick win, повышает dev DX, не меняет контракт. → **DONE this session** — `console.error('[rifty/service-worker] preview request protocol mismatch', { expected, got })` добавлен в `preview-bridge.ts` (main-thread сторона, перед отправкой error-frame обратно в SW) и `route-preview.ts` (SW сторона, когда client возвращает mismatch error). Mirrors паттерн `console.warn` в `ready-clients.ts` для handshake-drift.

**Refs:** M7 audit, ADR-0031, ADR-0040, `preview-bridge.ts:204`, `route-preview.ts:89`.

---

## Tier 3 — документация и счёт

### 6. `docs/adr/README.md` — индекс отстал на 11 ADR

**Why it matters:** README обрывается на ADR-0033, существует 44 файла (0001..0044). Новый контрибьютор не увидит M10/M11-уровневых решений (Vite-in-Worker, esbuild/swc, nested install).

**Action:** дописать строки 0034..0044 в существующую таблицу, проверить supersedes-связи (0024→0033 уже есть; 0025↔0043 — добавить «partially superseded for Real Vite path»; 0031→0040 — добавить «split into frame/routing»).

**Decision (2026-05-27):** `EXECUTE` — 5 минут. → **DONE this session** — добавлены строки 0034..0044, аннотации supersedes-связей 0025↔0043 (partial), 0031→0040 (split).

**Refs:** ADR audit, `docs/adr/README.md`.

---

### 7. `PROJECT_PLAN.md §4` — M11 в roadmap отсутствует, но цитируется в ADR

**Why it matters:** ADR-0011, 0042, 0043 явно ссылаются на M11. Roadmap §4 заканчивается на M10. Cognitive dissonance: ADR-слой реальности расходится с планировочным.

**Action (выбрать одно):**
- **A.** Добавить строку «M11 — post-M10 follow-ups (Vite-in-Worker, nested install, fork-IPC через Worker)» в таблицу §4 с примерным составом.
- **B.** Переименовать «M11» во всех ADR-ах на «M10.x follow-ups» — формально честнее, но требует правки 3 ADR (immutable!) через супершед-цепочку → дорого.

**Decision (2026-05-27):** `EXECUTE` (вариант A) — добавить M11 в roadmap с честным составом из открытых acceptance-пунктов и follow-up ADR. Не требует переписи immutable ADR. → **DONE this session** — `PROJECT_PLAN.md §4` получил M11 строку + детальный блок «M11 — post-M10 follow-ups» с явным разделением landed / in-progress / deferred.

**Refs:** ADR audit, `PROJECT_PLAN.md:163-175`, ADR-0011, ADR-0042, ADR-0043.

---

### 8. `TASKS.md` — закрыть устаревшие OPEN-пункты

**Why it matters:** ревью обнаружило минимум 4 пункта, помеченные `[ ]`, которые реально реализованы:

| Майлстоун | Пункт | Реальное состояние |
|---|---|---|
| M0 | Prod COOP/COEP headers | `vercel.json` + `public/_headers` готовы |
| M4 | `OpfsFsSync` sync backend | `packages/vfs/src/opfs-sync.ts` (160+ строк) |
| M4 | Unified async + sync VFS | ADR-0037 + `sync-mirror.ts:79-83` готов |
| M8 | WASI file decomposition | `syscalls/{fd,path,proc}.ts` разбит |

**Action:** прогон по TASKS.md, перевести 4 пункта в `[x]` с ссылкой на код, обновить acceptance-снимок.

**Decision (2026-05-27):** `EXECUTE` — 10 минут, чистая правка статусов. → **DONE this session** — M0 prod COOP/COEP, M4 OpfsFsSync, M4 unified async+sync VFS, M8 WASI file decomposition флипнуты в `[x]` со ссылками на код / ADR. M0 переведён в **DONE** (последний open-item закрыт).

**Refs:** все майлстоун-аудиты Tier 1.

---

### 9. `TASKS.md` — пересчёт conformance test counts

**Why it matters:** заявленные и реальные счётчики систематически расходятся:

| Майлстоун | Заявлено | Реально |
|---|---|---|
| M2 | 38 | 52 |
| M3 | 121 | ~107 |
| M5 | «9 stream tests» (неоднозначно) | 6 файлов / 42 it-блока |
| M9 | 18 | 64 |

**Action:** прогнать `find tests -name '*.test.ts' | xargs grep -c "^  it\|^  test"` по областям, обновить TASKS.md единым формулированием («X test cases in Y files»).

**Decision (2026-05-27):** `EXECUTE` — bundle в один doc-commit с пунктом 8. → **DONE this session** — TASKS.md пересчитан по фактическим `grep -cE "^[[:space:]]*(it|test)\("` пробежкам, унифицированная формулировка «X conformance test cases in Y files (+ package-level / integration breakdown)» для M2, M3, M4, M5, M9.

**Refs:** M2/M3/M5/M9 аудиты.

---

## Commit shape (per [[follow-up-triage-style]] — ~6 logical commits)

1. **`feat(kernel): ADR-0045 + WorkerProcessHandle.send/on (M6 fork IPC)`** — item #1 (через subagent, ADR + impl + тесты).
2. **`fix(runtime-js): execSync loud-throw without SAB capability`** — item #2.
3. **`fix(service-worker): console.error on protocol-version mismatch`** — item #5.
4. **`docs(adr): ADR-0028 → Provisional + reopen Q-2026-05-24-007`** — item #3.
5. **`docs(adr): refresh README index 0034..0044 + supersedes annotations`** — item #6.
6. **`docs(plan,tasks): close stale OPEN items, refresh conformance counts, add M11 to roadmap`** — items #4 (DEFER note), #7, #8, #9.

## Subagent dispatch plan

- **Item #1 (M6 fork-IPC)** — `EXECUTE_VIA_SUBAGENT`. Скоуп ограничен `packages/kernel/src/process-manager.ts` + `packages/runtime-js/src/builtins/child_process.ts` + новый ADR. Запустить после ratify ADR-0045 в основной сессии.
- Остальные пункты — серийно в main agent (мелкие, перекрываются с doc-правками).

## Open after this iteration

- M11 nested install следует фактическому состоянию (ADR-0042 уже landed).
- Streaming cross-realm preview (item #4) — ждёт реального triggering use case.
- `swc.wasm` vendoring (M8 + M10 follow-up, ADR-0044) — не входит в эту итерацию, отдельный треж.
- Live registry roundtrip (M9 follow-up) — opt-in test уже есть, ждёт операторского запуска.
