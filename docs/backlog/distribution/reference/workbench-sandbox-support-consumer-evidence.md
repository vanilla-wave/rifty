# Consumer evidence: checkSandboxSupport on a real non-COI SDK host

Verbatim wrap-up handed in by the user on 2026-09-15 (anonymized by its author; no
host names). Source of item `workbench-sandbox-support-consumer-fit`. Observed on
Chrome 152 / macOS against `packages/workbench/src/support/*` @ `f63da13f9`.

---

# Wrap-up: `checkSandboxSupport` (rifty PR #340) на реальном потребителе

Дата: 2026-09-15. Предмет: `vanilla-wave/rifty` PR #340, ветка
`t3code/workbench-sandbox-support-details`, head `f63da13f9` (на момент прогона — open).
Контекст: сторонний продуктовый потребитель rifty SDK, который встраивает песочницу в веб-приложение.

Ниже — только то, что относится к самому API: что подтвердилось прогоном, что расходится
с потребностями потребителя и что стоит починить. Деталей встраивающего проекта нет намеренно.

## Профиль потребителя (без имён)

Веб-приложение, которое собирается бандлером, отдаёт воркеры с собственного same-origin
статического каталога (не с CDN) и открывает песочницу через SDK:

```
createSandbox({
    requireCrossOriginIsolation: false,
    skipServiceWorker: true,
    toolchain: { workerUrl: '<same-origin>/toolchain-worker.js' },
    storage: { persistence: 'required' },
})
```

Плюс собственный Web Lock на ориджине, чтобы вторая вкладка не открыла песочницу параллельно.
То есть ровно композиция `sdk-toolchain` / non-COI, **без** Service Worker, **с** обязательным
OPFS и **с** обязательным `navigator.locks`.

До этого потребитель гейтил открытие песочницы собственным пассивным детектором (наличие
`isSecureContext`, `Worker`, module-worker через геттер `type`, `navigator.serviceWorker`,
`navigator.storage.getDirectory`, `navigator.locks`).

## Как прогонялось

`@riftydev/workbench@0.8.0` (последний опубликованный) `checkSandboxSupport` не содержит:
в `exports` нет `./support`, в `dist/assets/` нет `support-*.js`, символа в пакете нет.
Поэтому исходники `packages/workbench/src/support/*.ts` были собраны из PR-ветки локально:
4 carrier'а с `bundle: false` (как в `tools/publishing/build-workbench-assets.mjs:106-115`) и
`check-sandbox-support.ts` отдельным bundled-ESM модулем. Выход — в тот же same-origin статический
каталог, откуда потребитель отдаёт свои воркеры; оба URL отдаются с `application/javascript`.
`package.json`/лок-файл потребителя не трогались.

Среда: Chrome 152 / macOS, живая страница с уже открытой песочницей (origin lease удерживается).
Контекст страницы: `isSecureContext: true`, `crossOriginIsolated: false`, `SharedArrayBuffer`
отсутствует, `navigator.serviceWorker`/`navigator.locks`/`navigator.storage.getDirectory` есть,
`navigator.storage.persisted() === false`.

## Что подтвердилось

**1. Рецепт хостинга ассетов для bundler-потребителя работает как написано в гайде.**
Это был открытый вопрос («Playground потребляет workbench из source через Vite, `dist/assets` он
не хостит»). У продуктового потребителя вопроса нет вовсе: у него уже есть same-origin статический
каталог для воркеров (воркеры обязаны оставаться same-origin, даже когда приложение раздаётся с
CDN), и 4 ассета кладутся туда тем же шагом сборки, `probeBaseUrl` указывает на этот каталог.
Same-origin-ограничение `probeBaseUrl` (`check-sandbox-support.ts:36-51`) совпадает с тем
ограничением, из-за которого такой каталог у потребителя и так существует. Никаких `?url`/`public/`
плясок не потребовалось.

**2. Отчёт на non-COI хосте честный и полный.**
`checkSandboxSupport({ probeBaseUrl, persistence: 'required' })`:

- `modes.nonCoi`: **`supported`**, `reasons: []`, `limitations: []`.
- `modes.coi`: `unsupported` — ровно `cross-origin-isolated` и `shared-memory`.
- Из 18 чеков failed только эти два, `deployment-control` — `incomplete` по дизайну, **остальные 15
  passed**: `js-eval`, `wasm`, `module-import`, `nested-worker`, `opfs`, `page-locks`,
  `message-port`, `broadcast-channel`, `crypto`, обе SW-регистрации (classic и module).
- `cleanup: passed`.

Ценность против пассивного детектора — в том, что исполняется, а не проверяется на наличие:
`js-eval` (CSP реального ориджина разрешает динамический eval в воркере), `module-import`
(настоящая загрузка ESM в воркере, а не факт чтения опции `type`), `opfs` (реальные
write/read/delete через sync access handles, а не `typeof navigator.storage.getDirectory`).
Все три — именно те места, где пассивный детектор даёт зелёный там, где рантайм умрёт.

**3. Пробы не мешают живой сессии.**
`navigator.locks.query()` непосредственно до и после прогона: тот же удерживаемый lease,
`pending: []`. После прогона `navigator.serviceWorker.getRegistrations()` → **0**; в корне OPFS
остаётся только рабочий namespace приложения — ни одного probe-каталога. Страница продолжает
работать. Это проверялось на живой сессии, а не на fixture-хосте.

**4. Цена прогона — единицы-десятки миллисекунд.**
Полные прогоны с `probeBaseUrl`: **32 / 23 / 11 / 10 мс** (включая прогон сразу после свежей
загрузки страницы, с зелёными SW-регистрациями и `leftoverRegistrations: 0`). То есть гейтить
открытие песочницы отчётом можно без заметной для пользователя задержки — сомнений «не слишком ли
дорого делать это на каждый вход» после прогона нет.

## Что расходится с потребностями потребителя

**A. `page-locks` не входит в `nonCoi.required`, хотя SDK-композиция без Web Locks не стартует.**
`modes()` (`support/report.ts`) кладёт `page-locks` только в `coi`. При этом non-COI-потребитель
держит origin lease через `navigator.locks.request` — без Web Locks открытие падает. На браузере
без Web Locks отчёт скажет `nonCoi: supported`, а потребитель упадёт на старте. Сам чек, кстати,
корректно оговаривает свою границу («origin lease availability is unverified»), так что вопрос
только в составе `required`.

**B. B1 из ревью воспроизводится на реальном потребителе.**
Без `probeBaseUrl`: `modes.nonCoi.conclusion: 'inconclusive'`, 12 чеков `incomplete`, и только
`module-worker` объясняет причину («provide probeBaseUrl pointing to the published probe assets»).
`module-import`, `message-port`, `js-eval`, `opfs` — «operation not completed». Прогон — 1 мс.
Потребитель по отчёту не отличает «я не сконфигурировал probeBaseUrl» от «операция не завершилась»,
и при этом 1 мс против 10–32 мс — единственный косвенный сигнал, что ничего не исполнялось.
Для гейта это опасно: `inconclusive` из-за несконфигурированного каталога нельзя трактовать как
«браузер не тянет» и блокировать пользователя.

**C. SW-чеки — шум для композиций с `skipServiceWorker: true`.**
`service-worker-api` и `service-worker-module-registration` попадают в optional/limitations, а
`deployment-control` всегда `incomplete`. У потребителя, который SW сознательно не использует,
это три строки отчёта, которые нечего показывать и незачем интерпретировать. Отдельно подтверждается
замечание ревью, что `service-worker-module-registration` не соответствует ни одной реальной
композиции — у этого потребителя module-SW не регистрируется нигде.

**D. 18 чеков — слишком много, чтобы показать пользователю.**
API даёт правильные данные, но у потребителя UI-место под «проверки браузера» — это одна строка
и раскрывающийся список. Из отчёта нужно уметь построить короткий вывод: один `conclusion`, и
только те `reasons`/`limitations`, которые относятся к выбранной композиции. Сейчас каждый
потребитель будет писать этот свёртыватель сам, и каждый — по-своему (в частности, решать, что
делать с `incomplete`-чеками и с `deployment-control`).

## Открытые вопросы

- Проверено только на Chrome 152 / macOS. Safari и Firefox не прогонялись — а именно там пассивные
  детекторы врут чаще всего (OPFS sync handles, module workers), и именно там отчёт должен себя
  оправдать.
- Нужен ли non-COI тулчейну WASM по факту (флаг `wasm` / `nonCoiVmEngine: 'quickjs'`) — из кода не
  следует. На прогоне `wasm` passed, так что для этого потребителя флаг безопасен, но вопрос
  «когда его обязан выставлять потребитель» в гайде не закрыт.
- Рекомендуемая трактовка `inconclusive` для гейта (блокировать / пускать / просить конфиг) —
  в гайде не сформулирована, а это первое, что делает любой потребитель.

## Практический итог

Для non-COI SDK-потребителя API подходит: даёт ровно те факты, которых не даёт пассивная детекция
(eval, реальный импорт модуля в воркере, реальная запись в OPFS), стоит десятки миллисекунд,
не трогает живую сессию и чисто убирает за собой. До внедрения имеет смысл закрыть A (состав
`nonCoi.required`) и B (различимость «не сконфигурировано» / «не завершилось»); C и D — вопрос
формы отчёта и гайда, а не корректности.

## Ссылки

- PR: https://github.com/vanilla-wave/rifty/pull/340
- Гайд (PR-ветка): `docs/public/sandbox-support.md`
- ADR: `docs/adr/distribution/0437-bounded-workbench-browser-prerequisite-probes.md`
- Исходники: `packages/workbench/src/support/*` @ `f63da13f9`
