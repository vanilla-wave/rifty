ACCEPT — только предложенная точечная PR-4 коррекция критерия. Blockers: 0. Не I5 Final+GREEN PASS.

Scope: HEAD/base be8254b28683778925bdfd26a13b52df7446e4c0 + текущий рабочий diff. Depth1/max1, children=0, tracked read-only; записи только /tmp. Реальный diff: apps/playground/public/sw.js, apps/playground/CHANGELOG.md, tests/e2e/fullstack-demo.spec.ts. Барьер прочитан, ранее принятую семантику заново не сертифицировал (REV-1). Gate/AGENTS/PR-4/DEC и plugin совпадают с git baseline.

Authority / verdict:
- AGENTS.md:21 ограничивает prod SOURCE ради читаемости; tools/checks/file-size.mjs:3–19 объясняет context-cost, :30–43 уже исключает dist/build/generated/vendor. Однако :93 отдельно измеряет bundle как исходник. Это реальное изменение baseline-критерия, а не утверждение, будто исключение уже существует.
- ADR-0016 (docs/adr/service-worker/0016-sw-built-from-ts.md:6,16–20) определяет sw.ts единственным источником, public/sw.js — генерируемым self-contained bundle. sw-plugin.ts:58–63,75–95 подтверждает вход, выход, HEADER и неминифицированную генерацию. Проверены реальные байты, не только заголовок.
- PR-4 (docs/process/rules/pr.md:27–32) разрешает независимо проверенную коррекцию с причиной; запрет — ослабление, скрывающее product defect. Здесь source ratchet сохранён, текущая ошибка — неверная классификация generated output. Отмена именно этой строки и exact-path exclusion честны; повышение cap, minification и broad public skip не приняты. Разделение bundle ради числа строк не обосновано и противоречит self-contained ADR-0016; добавочная machinery не требуется (REV-7).
- DEC-1:23–24: запись в docs/process + CHANGELOG с указанием отменяемого pin/classification. Для общих tools существующий журнал — корневой CHANGELOG.md; tools/CHANGELOG.md отсутствует. Новый ADR/пользовательское разрешение не нужны: ADR не опровергается; DEC-3 и явно предоставленные implement/push samePR wholegoal полномочия достаточны. PR-1/4/5 допускают это в PR316.

Executed proof:
Command: node /tmp/pr316-pr4-criteria-review/proof.mjs (repo cwd); exit 0.
Node v24.16.0; pnpm 11.5.2; Vite 5.4.21; esbuild 0.21.5.
1. pnpm check:file-size: exit 1, ONLY sw.js grew 879 → 928; 42 oversized/42 pinned.
2. Candidate из git baseline: удалить только baseline row sw.js:879; перед измерением пропустить relative(root,abs).split('\\').join('/') === 'apps/playground/public/sw.js'. evaluate() байт-в-байт неизменён; THRESHOLD=800, RECORD_DELTA=150, scan roots, остальные 41 pins сохранены. Measurement массива отличается ровно одним SW; остальные 1096 записей равны.
3. node /private/tmp/pr316-pr4-criteria-review/candidate.mjs (repo cwd): exit 0, 41 oversized/41 pinned, file-size: OK (ratchet holds).
4. Реальные scratch files: apps/playground/public/unrelated.js:801 RED; apps/other/public/sw.js:801 RED; packages/review-proof/src/handwritten.ts:801 RED; packages/shell/src/commands/git.ts 3064→3065 RED. Единственный excluded SW проходит. Boundary800, stale pin, pin retirement и shrink-record ratchet сохранены.
5. esbuild напрямую, cwd apps/playground, те же plugin options: absolute canonical sw.ts, bundle=true, format=esm, platform=browser, target=es2022, minify=false, write=false, sourcemap=false, logLevel=silent; тот же HEADER. Plugin/build hooks не вызваны. Output BYTE-IDENTICAL рабочему App public/sw.js: 34579 bytes, 928 measured lines, protocol7, canonical previewPrefixFromServiceWorkerUrl(self.location.href).
SHA256 de38baa05d3835d5ca3573990acebad5a558d49dd3ad20ac78da62d82991f5cf.
Baseline public artifact:879, protocol6; SHA256 756fca3646b8d404e4989681bf03beeb0c7f2b065191d670c846b0a3a9b51578. Поэтому его возврат оставил бы старые protocol/prefix bytes. Дополнительный esbuild metafile output-identical; все 33 разрешённых canonical inputs совпали с be8254b28.

Artifacts: proof.mjs (полная воспроизводимая команда/options/assertions), output.txt (полный вывод), baseline.mjs, candidate.mjs, regenerated-sw.js, fixture/ — всё /tmp/pr316-pr4-criteria-review/.

Limits / remaining:
- Проверен предложенный scratch candidate. Tracked gate/docs/CHANGELOG ещё не изменены; driver должен внести точное исключение и запись причины, проверить итоговый diff/релевантные gates.
- Full pr:check, App rebuild, browser/e2e, packed asset acceptance и I5 final review не запускались; root fullgate не трогал. Byte proof относится к App public artifact, не удостоверяет опубликованный tarball или runtime correctness; остальные I5 obligations сохраняются.
- Exact-path gate не удостоверяет будущую provenance сам; текущая provenance доказана. Исключение не разрешает впоследствии hand-edit SW — ADR-0016 остаётся действующим.
- Историческое несоответствие ADR-0016 de-VCS/ignore уже записано в docs/backlog/service-worker/generated-sw-js-still-tracked-in-vcs.md; текущая коррекция его не решает/не закрывает. Требование его обязательно решать сейчас не вытекает из данного изменения (REV-1/2).
- Первый scratch CLI вызов через /tmp дал пустой exit0 из-за macOS /private/tmp и import.meta.url guard; не засчитан. Повтор через realpathSync проверил и exit0, и реальную строку OK; assertions scan/evaluate также выполнены. Read-only git предупреждал о невозможности xcrun cache в /tmp, команды чтения успешно вернули данные; scratch proof запускался с разрешённой записью /tmp.
- Новых агентов/codex exec не запускал: --output-last-message принадлежит вызывающему harness; этот файл записан напрямую как review artifact.
