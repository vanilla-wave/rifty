# Replay cache profile — refine evidence, 2026-10-23

Input: `/Users/vanilla-wave/ai/artifacts/wrap-up-esbuild-replay-cache-2026-10-23.md`.
Research baseline: `origin/main` = `c392669742a27b1c8c47ca0edaf4c8c579e90edf`.
Node v24.16.0; Vitest v2.1.9. No product implementation.

## Input and dedup

Input scenario: restore prepared dependencies, run installed esbuild/builds,
reopen saved files, reset by reapplying the snapshot. Dependency changes and
reinstall are not offered. Proposed explicit profile omits acquisition archives;
normal snapshots retain replay/integrity guarantees. Host consumer and the
boundary enforcing absence of reinstall were not specified.

Input constraints retained: distinguish intentional omission from a damaged
ordinary snapshot; preserve installed compiler/build/read/restore behavior;
define install/replay behavior without silent network fallback or partial
environment modification. Define compatibility for old producers, loaders and
saved projects explicitly. Its mechanism is unresolved; no migration or
mixed-version rollout promise was selected.

Match: `playground/snapshot-carries-substituted-bytes-twice.md`; its existing
question preserves offline shadow replay. Intake was recorded there; the
settled no-replay scope is `epics/compact-dependency-snapshots/goal.md`.
The earlier replay-preserving question remains independent and unscheduled.
Scanned backlog titles/content/maps, code refs, `docs/process/traps.md` and
`docs/adr/README.md` Declined concepts: no other matching profile or declined
profile. `baked-snapshot-regeneration` concerns refresh cadence, not this format.

## Current authorities

- ADR-0346: exact shadow-acquisition closure + SRI verified before restore;
  shared cache merges before lock publication.
- ADR-0386: tar v4 control/payload namespaces; legacy v3 JSON supported.
- ADR-0398: snapshot-only denies registry acquisition, permits local lock/cache
  replay; not an install ban.
- ADR-0420: no-COI SDK snapshot application reuses replay validation.
- ADR-0543: current tier projection preserves replay validation. In
  `dep-snapshot-runtime-tier.ts`, projection changes generated facade/receipt
  from the lockfile; it is not a full reinstall from tarballs.
- `packages/workbench/src/glue/dep-snapshot-producer.ts`: public producer has no
  replay profile option; it builds and verifies the cache before encoding.
- `packages/workbench/src/glue/dep-snapshot.ts`: shared
  `prepareDepSnapshotForRuntimeTier` verifies cache before projection.
- `packages/rifty/README.md`: direct host `toolchain.install({registryUrl})`
  remains reachable independently of shell registry connection.

An opt-in profile requires an explicit ADR at implementation pickup; the
existing profile cannot silently lose its promised replay. API spelling,
version marker and internal policy carrier are implementation decisions.

## Executed baseline

```sh
node --version
pnpm exec vitest run packages/workbench/src/glue/dep-snapshot.test.ts -t 'refuses to restore a shadow-replay lockfile without its pinned bytes|rejects .* tar replay closure before mutation'
```

PASS: 3 tests, 24 skipped. Real fixture tarballs/MemoryFs; only asset network
boundary supplied by the existing test. Missing JSON cache, missing tar cache
and corrupt tar cache reject before destination mutation. This proves the
current requirement, not a working cache-free profile.

## Size probe

Temporary `packages/workbench/src/glue/replay-cache-refine.tmp.test.ts`, executed
with `pnpm exec vitest run packages/workbench/src/glue/replay-cache-refine.tmp.test.ts`,
then removed. PASS, 1 test. Reproducible body:

```ts
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { it } from 'vitest';
import { encodeDepSnapshotTar } from './dep-snapshot-tar.ts';
import type { DepSnapshotV3 } from './dep-snapshot.ts';

it('measures replay bytes with the current tar encoder', () => {
  for (const name of ['vite', 'vite8', 'typescript']) {
    const snapshot = JSON.parse(gunzipSync(readFileSync(
      `apps/playground/public/snapshots/${name}-node-modules.json.gz`,
    )).toString()) as DepSnapshotV3;
    const full = encodeDepSnapshotTar(snapshot);
    const stripped = encodeDepSnapshotTar({
      ...snapshot, tarballCache: { ...snapshot.tarballCache, files: [] },
    });
    console.log({ name,
      cacheBytes: snapshot.tarballCache.files.reduce(
        (n, f) => n + Buffer.from(f.content, 'base64').length, 0),
      tarGzip: gzipSync(full).length,
      strippedTarGzip: gzipSync(stripped).length,
      saving: gzipSync(full).length - gzipSync(stripped).length,
    });
  }
});
```

| Committed payload | Cache bytes | Current tar + gzip | Cache omitted + gzip | Difference |
|---|---:|---:|---:|---:|
| vite | 3,845,798 | 9,770,964 | 6,025,363 | 3,745,601 |
| vite8 | 3,821,302 | 13,452,030 | 9,639,015 | 3,813,015 |
| typescript | 3,845,798 | 14,173,679 | 10,427,497 | 3,746,182 |

Current encoder over committed legacy trees, Node gzip defaults. These are not
new producer outputs, a universal saving, or valid stripped snapshots. No
promise about a future profile's exact envelope size. No current browser
build/reopen/reset proof was run; that belongs to the chosen acceptance carrier.

## Early independent Challenge (verbatim)

challenge: 2026-10-23 — 2 problems

Ценность подтверждена: переданные измерения текущего tar-представления показывают экономию 3,75–3,81 MB на снимок после удаления replay-архивов. Это оценка передачи, не доказательство допустимости такого restore. Более дешёвого проверенного пути, сохраняющего заявленные загрузку, проверку и восстановление подготовленного окружения, не найдено. `snapshot-only` уже сохраняет локальный replay; запрет install в интеграции сам архив не уменьшает. Старый draft требует сохранения replay, поэтому новый профиль — отдельная граница поведения, не выбранная реализация прежнего обещания.

1. Не определён фактический потребитель: no-COI SDK или Workbench, включая его COI-путь. Это влияет на наблюдаемую применимость результата: оба сегодня требуют replay-validation, а Workbench дополнительно перепроецирует snapshot под runtime tier. Исходник не выбирает потребителя; нельзя молча обещать один путь или все.

2. Отказ от возможности переустановки уже задан исходником; повторный вопрос об этом лишний. Но не выбрана граница гарантии: интеграция просто не предоставляет install либо профиль сам отвергает его, включая прямой host install и доступный общий cache. Действие достижимо через существующие публичные API; успешная переустановка или отказ — разные результаты. Если нужен запрет профиля, его сохранение после reopen/reset входит в тот же сценарий.

Driver verification: both questions grounded in the original input and current
public consumers. Asked together in round 1; no implementation route adopted.

## Round 1 response

- Consumer: «1, но если убирается и в других местах - ок» — no-COI SDK required;
  savings elsewhere permitted, not a required all-consumer expansion.
- Install boundary: «не понял этот вопрос» — unanswered. Clarified with an
  explicit install after compact snapshot restore: retain existing install
  behavior without promising replay, or add a profile-level prohibition.
- Clarification answered: «Редактор не вызывает установку; отдельный запрет не
  нужен (рекомендую)». No new install ban, no promised offline reinstall;
  existing explicit-install outcomes remain, including cache-miss errors.
- Both early Challenge findings resolved by these answers. Post-answer critic
  verdict is recorded verbatim in the goal's `## Challenge`.
