PASS — независимый review точного pin по ADR-0391. Полный I5 Final+GREEN не заявлен.

Одобрен единственный SHA-256 для `typescript-worker.js`: `388098a2582d8c679a98bcc0e0d94aa3c9b59a1fda779423e4992377c15edaf4`. Размер **10 022 664 B**, delta **0**; имя/лимит 2 MB/остальные исключения не меняются. Старый pin `0b8911fb915145165477c4083c8fde67be00cfc3a58abe89a39f33edef318004` независимо воспроизведён от `8df45fadbff842794142761ea78bc4adb5865522`.

Проверка: фактические options `tools/publishing/build-workbench-assets.mjs`, esbuild 0.28.0, `write:false`; baseline — git-show overrides только изменённых first-party исходников. Builder/config/lock/manifests неизменны от baseline. Все исходники графа/config stable до конца проверки; tracked/dist не записывались.

- Полный граф: **540** входов baseline/current, одинаковый набор; **40** выходов, взаимно однозначное сопоставление; все mapped import edges идентичны.
- Причина старого harness failure: существующий `packages/io/src/preview-protocol.ts` ранее tree-shaken, теперь **1 284 B** в общем io chunk. `chunk-7Z62OEVR.js` (20 inputs, 138 529 B) → `chunk-3LG6FKMX.js` (21 inputs, 139 978 B). Единственный добавленный emitted input; входов компилятора/клиента не добавлено.
- После сопоставления hash-имён содержательно меняются только три выхода: owner (+685 B), net (+551 B), io (+1 449 B). Вклад меняют только девять first-party источников I5; все diff hunks просмотрены, полный diff сохранён.
- Сам TS worker: **46 байт** внутри **шести** восьмисимвольных hashes статических/динамического import. Обратная замена по фактическому графу возвращает весь baseline файл byte-for-byte. Все 17 вкладов worker одинаковы; TypeScript 5.9.3 — **9 937 465 B**.
- Второй compiler `chunk-EMDIREKY.js`: **4 893 418 B**, `39be666ac003c7361e9fbcd88abdda1ed51052350ade9b57b4d2716f1e296498`, неизменен byte-for-byte.
- Generated esbuild client: source SHA `7acc5cd6f0e111810d3505c0959ec2fb5767f25af8dd2c5919a5b36d4f4da553`; один emitted owner, вклад **139 315 B**, весь owner идентичен после hash-import mapping. Нового клиента/источника esbuild WASM нет.
- QuickJS **503 134 B**, SQLite **659 730 B** — исходные точные SHA. Единственный inline WASM — cjs-module-lexer, **22 167 B**, `b40099ca01477f581bd752acc8ed6d25c14b0e8beb9a00e0dc1744a2b041a104`; literal 29 556 символов.

Browser evidence: полный успешный `/tmp/rifty-316-i5-packed-green-kept.log`, SHA `e0ca9d0ac8db893fee1fd2228e367999914fde356d32655bdd882741d9242147`. Проверены carrier и копии: root Vite/HMR/sqlite, strict snapshot-only Vite, copied no-COI `node:vm` → 42, scoped `/sandbox/` Vite build/assets/API/HMR + native SW stop/restart/reload. **Все 40** файлов `consumer/dist/rifty` byte-for-byte совпадают с независимой current-сборкой, WASM pins тоже. Неполный `/tmp/rifty-316-i5-packed-green.log` не использован как PASS.

Граница доказательства: reviewer не запускал Chromium; независимо проверил фактический успешный лог/carrier и именно скопированные bytes. Packed carrier не отправляет прямой language-service запрос в `typescript-worker.js`; новая LSP-семантика не заявляется.

Inventory probe: неизменённый gate даёт ровно одну ожидаемую TS-worker 2 MB/pin violation; тот же evaluator с единственной SHA-подстановкой в памяти даёт **0** violations. Ни directory waiver, ни увеличение ceiling, ни tracked gate edit не делались.

Артефакты: `/tmp/rifty-316-i5-independent-pin-review.json`; `/tmp/rifty-316-i5-independent-pin-reproducer.mjs/.log`; `/tmp/rifty-316-i5-independent-pin-finalize.mjs/.log`; `/tmp/rifty-316-i5-independent-pin-substantive-graph.diff`; `/tmp/rifty-316-i5-independent-pin-baseline-metafile.json`, `/tmp/rifty-316-i5-independent-pin-current-metafile.json`. Raw неуспешные harness attempts сохранены отдельно; исправлены offset encoding/data-URL scaffolding, compiler assertions сохранены.

Осталось у driver: применить ровно одобренный SHA; обычные gate/PR checks и независимый полный I5 Final+GREEN.
