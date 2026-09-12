# FS dirty-stamp — full finding disposition

2026-09-10; raw input: the user's 2026-08-30 FS dirty-stamp wrap-up, supplied
as `/tmp/wrap-up-fs-dirty-stamp-2026-08-30.md`. Source baseline:
`e5122ed5f39ecf4eb411419b03c390306d381ebc`; branch changes are documentation only.
This supplements `project-open-ide-boundaries-refine.md`, whose raw reopening
scenario, user answer, native probe and original dirty-ownership direction stand.

## Final user frontier

User: «в общем если нужно - спрашивай и дооформляй по правилам».

Question 1:

> Оформить ли отдельную задачу на видимый прогресс первого открытия тяжёлого проекта — чтобы было понятно, что браузер ещё сохраняет файлы? Это не обещает ускорения: его сначала нужно измерить.

Answer: **«Да, оформить прогресс (рекомендую)»**.

Question 2:

> По скорости первого открытия тяжёлого проекта: достаточно сначала измерить, куда уходит время, или нужен отдельный результат — открытие должно стать быстрее? Старые 40 секунд не являются актуальным замером.

Answer: **«ничего не нужно, со скоростью отдельно разберемся(вроде даже есть ПР с планом)»**.

Selected outcomes: accessible saved files/terminal without implicit install,
IDE-owned Scratch dirty with existing classification, and visible real first-open
persistence progress. Speed profiling/optimization is explicitly outside this
work. No new performance plan, budget, acceptance ratio or background-promotion
policy is inferred. This is refinement, not implementation authorization.

## Full source → disposition inventory

| Original finding / proposal | Current evidence or boundary | Disposition / owner |
|---|---|---|
| install-stamp and Scratch dirty are different mechanisms | installation proof versus IDE edit state; persistence is a third, separate property | preserve distinction in the two existing drafts |
| ordinary source edits lose install trust | classifier does not do that; manifest mutation is distinct | false broad concern; no new task |
| package.json/lock drift blocks saved open | `package-acquisition-authority.ts:717`; accepted native-like outcome | `playground/install-stamp-invalidation` owns accessible files/terminal and point-of-use command errors |
| simply re-promote after manifest-only edits | an unchanged tree need not meet a changed dependency request | rejected as the route to reopening; do not certify a new install without evidence |
| every install waits for drain | terminal provenance resolves before promotion at `package-acquisition-authority.ts:1301`; dependent child work still waits | corrected; the reopen unit must cover child readiness, not only delete an open guard |
| all slow reopen is a lost stamp; historical 40.4/41.9s | no current timing evidence; startup also reads files and launches runtime | unsupported generalization; speed work explicitly excluded |
| background first-open promotion | ADR-0394 requires settled snapshot result before catalog publication | no chosen guarantee change; retain current snapshot apply/commit/recovery behavior |
| progress missing | owner counts exist; `open-workbench.ts:271` drops them; app has a delayed preparing spinner | `playground/project-open-persistence-progress`; new visible surface, not a claim of zero prior feedback |
| nine dirty kinds, no-op dependency, transit treeRevision | `playground-project-authority.ts:208,2311`; first flip writes catalog, already-dirty exits early | cleanup candidates in `playground/scratch-dirty-ide-ownership`; no new dirty policy or blanket VFS-revision removal |
| three durable JSON writes and two npm notifications | catalog transaction is paid on first dirty flip, not each node_modules write; second dirty notification can return early | retain exact cost description; no measured speed claim |
| optimistic page markDirty duplicates live writer | active app directly creates PageStore and subscribes to catalog; old wrapper is not the active path | old explanation corrected; no blanket page-state deletion |
| page keepLocalDirty ignores owner clean | executed real-store true→false probe remains true; full Reset browser path unproven | `playground/scratch-reset-keeps-page-dirty`, linked from ownership work |
| duplicate same-starter guard | app/owner both protect an existing dirty Scratch | preserve baseline behavior; simplification needs real transition proof, not a new scope interview |
| privileged claimIo can leave stale phase:trusted | `install-stamp-authority.ts:414–444` rereads and downgrades based on actual claim bytes; catalog rollback reconciles captured claims | unproven technical hypothesis, not an established false-trust bug; reopen pickup must inspect real crossings without adding a speculative guard |
| one production stamp instance / all async readers dead | `readInstallStamp` is used at `no-coi-toolchain-worker.ts:115` and `install-stamp-reading.ts:93`; no-COI install has its own context | single-path inventory is not universal; retain live readers and installer-boundary consumers |
| installStampSatisfied helper exports unused | 2026-09-10 scoped code search found no external production calls to the three convenience predicates | directly related cleanup at reopen pickup, after rechecking consumers |
| stale ADR-0187 comments / old source paths | `install-stamp.ts:14`, `project-deps.ts:83`; several backlog paths still use old app glue | touched backlog links corrected; related source comments travel with owner changes, no source edit in this preparation |
| sync SHA-256 price / number of checks | same comparison across sync realms is intentional; current cost not measured | no hash cache, async-only weakening or performance promise; speed work excluded |
| generic TrustedState and fence placement | existing primitive draft explicitly waits for second real consumer | gate preserved; no framework extraction or fence relocation selected |
| old automatically reinstall-on-open promises | trusted-state epic and persist-ledger consumer row overlap the accepted saved-open scenario | align their wording with the recorded user amendment; new consumer RED remains pending |
| OPFS ratio flake, 16 lanes, learned-pin TTLs, 490ms tail | historical measurements/policies in raw report; not fresh observations | keep as context only; no timing gate changes or extra performance task |
| rejected dep-set key, whole-tree surveillance, serial drain, sleep proof, giant JSON trees, dropping claim on Save, total-duration deadline | existing ADRs describe why those routes failed; Save rebind and own write-proof guarantees remain | no revival or speculative replacement; unrelated cache/learned-pin behavior unchanged |

Unqualified code paths in the table are under `packages/workbench/src/workers/`
unless they are `install-stamp*.ts` / `project-deps.ts` (under `src/glue/`) or
`open-workbench.ts` (under `src/workbench/`). The table is read-only source
evidence; it does not claim executed browser acceptance or new latency results.

## Independent frontier audit

Fresh read-only `/root/audit_refine_frontier` read the whole raw report, actual
draft set, ADRs and reachable code before the final questions. Verdict:

> Аудит: выбранные reopen/IDE-dirty направления дополнительных вопросов не требуют. Остатки raw wrap-up нельзя считать ими закрытыми.

The critic identified the two independent added-scope questions above and the
overlapping trusted-state epic wording. Both questions have explicit answers;
the old automatic-install clauses follow the existing amendment. Technical
choices remain at pickup and are not falsely presented as user decisions.

## Preparation limits

The prior real PageStore and native Node probes retain their stated limits.
Full interrupted npm/browser reopen and Reset proof, progress API/UI proof,
precise runtime reconstruction and applicable ADR changes remain implementation
preparation. No product code, runtime guarantee or test oracle was changed here.
The final written-result review covers the actual related draft set and these
sources, not merely this inventory or the early critic's conclusion.
