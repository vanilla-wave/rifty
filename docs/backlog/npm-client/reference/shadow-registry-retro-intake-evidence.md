# Shadow-registry retro intake — evidence

Source: retro review of the shadow-substitution series (2026-08-04, Claude
session 7dd8ff93, 6 + 5 review lenses, majors adversarially verified; not an
in-repo artifact). Every finding below re-verified on main `99fdf6c91`
(2026-09-27). Node v24, npm registry queries dated 2026-09-27.

## Closed on main before this intake (no item)

- Terminal silence during project open — `7f725b31c` (2026-07-23) removed the
  "restoring project dependencies…" consumer; since `3e574deb2` the page shows
  `apps/playground/src/glue/project-open-progress.ts`; readiness is binary at
  the stamp (declined-concepts row 2026-09-01). Residual: dead `beforeRun`
  hook → `distribution/workbench-void-guard-machinery`.
- Storage class after silent downgrade — closed. The chip
  (`StatusBar.tsx:33-41`, `093c5b885` 2026-06-12) shows `OPFS · persisted` /
  `OPFS · best effort` / `Memory · session only`; `storageMode()` is set from
  the owner snapshot (`playground-app.tsx:718`, `c413b3934` 2026-07-16); when
  memory, `DegradedBanner` (`playground-app.tsx:1750-1760`,
  `DegradedBanner.tsx:19` "Persistence is off — this session only") explains
  it. Only the raw owner failure reason (`owner-storage.ts:74`
  `fallback.reason`) is unread — advice, no item. The `storage-layout` health
  issue (`8ecbffa65`) covers legacy/corrupt layout text only.
- installer.ts god-file → PR #288; esbuild asset chain (CAS/port) → PR #289
  (ADR-0371); ADR-0006 disable-flag → correction + declined row 2026-08-23.
- ADR-0299 "removed without pointer" — finding false: 0299 is a quarry-branch
  ADR that never reached main (`git log HEAD -S'0299' -- docs/adr/README.md`
  → none; only `--all` hit is `499e29713` on the unmerged
  `codex/implement-honest-shadow-substitutions` branch); `tools/refs/check.mjs`
  QUARRY set lists it; ADR-0308 (`1fe12c7b9`) records "Not adopted from the
  quarry: Shadow-specific Eddy asset source (quarry ADR-0299)". No README row.

## I1 — eddy decline reason is console-only

```
$ grep -n 'console.warn' packages/npm-client/src/eddy-fast-path.ts
493:  console.warn(`npm: fast install (eddy) unavailable, using standard install — ${reason}`);
$ sed -n '859p;867p;893p' packages/workbench/src/glue/npm-shell-command.ts
        `npm: eddy cached resolution (as-of ${result.resolvedAt ?? 'unknown'}), refreshing in background\n`,
            `npm: WARNING: eddy pin refresh failed (${(err as Error).message}) — retrying on the next install\n`,
    const via = result.source === 'eddy' ? ' via eddy (fast)' : '';
$ grep -rn 'unavailable, using standard\|declineEddy' packages/npm-client/src/*.test.ts packages/workbench/src/glue/*.test.ts
(no output)
$ grep -n 'eddyFallback' packages/npm-client/src/installer.ts packages/workbench/src/glue/npm-shell-command.ts
installer.ts:211:  readonly eddyFallback?: { readonly reason: string };
installer.ts:532:      ...(eddyFallbackReason === undefined ? {} : { eddyFallback: { reason: eddyFallbackReason } }),
(npm-shell-command.ts: no hit — the result field is never printed)
$ sed -n '890p' packages/workbench/src/glue/npm-shell-command.ts
          console.warn(`npm: learned pin write failed: ${(err as Error).message}`);
$ sed -n '14,22p' packages/workbench/src/workbench/internal/project-runtime-acquisition.ts   # from-scratch open → terminal install
  if (acquisition?.kind !== 'install') return runtimeLine;
  const notices = acquisition.snapshotFailures.map(
    (failure) => `echo ${shellWord(`${failure.snapshotId}: ${failure.reason}`)}`,
  );
  const root = projectRelativePath('/', cwd);
  const install =
    root === '.' ? 'npm install' : `npm --prefix ${projectRuntimeShellWord(root)} install`;
  return [...notices, install, runtimeLine].join(' && ');
}
$ sed -n '41p' apps/playground/src/adapters/playground-project-plan.ts
  if (setup === 'from-scratch') return Object.freeze({ kind: 'install' as const });
```

## I2 — esbuild facade has no declarations

```
$ sed -n '36,48p;481,485p' tools/shadow-registry/src/internal/catalog-source.ts
export const ESBUILD_ALIAS_PACKAGE = JSON.stringify({ name: 'esbuild', version: '0.28.0',
  main: './lib/main.cjs', module: './lib/main.cjs', type: 'commonjs',
  bin: { esbuild: './bin/esbuild' }, exports: { '.': { … './lib/main.cjs' } } }, …)
        files: [
          file('bin/esbuild', ESBUILD_ALIAS_BIN),
          file('lib/main.cjs', ESBUILD_ALIAS_MAIN),
          file('package.json', ESBUILD_ALIAS_PACKAGE),
        ],
$ ls node_modules/.pnpm/esbuild-wasm@0.28.0/node_modules/esbuild-wasm/lib/
browser.d.ts browser.js browser.min.js main.d.ts main.js
$ grep -n '"types"' node_modules/.pnpm/esbuild-wasm@0.28.0/node_modules/esbuild-wasm/package.json
15:  "types": "lib/main.d.ts",
$ grep -n '"exports"\|"types"\|"main"' node_modules/.pnpm/esbuild@0.28.0/node_modules/esbuild/package.json
12:  "main": "lib/main.js",
13:  "types": "lib/main.d.ts",                # real esbuild: no "exports"
$ cmp node_modules/.pnpm/esbuild@0.28.0/node_modules/esbuild/lib/main.d.ts node_modules/.pnpm/esbuild-wasm@0.28.0/node_modules/esbuild-wasm/lib/main.d.ts && echo identical
identical
$ grep -n -i 'declaration\|\.d\.ts' docs/public/compat/esbuild-js-api.md
(no output)
$ grep -n -i 'declaration' docs/public/compat/sass-embedded.md
23:| TypeScript declaration surface | ❌ | No TypeScript declarations or types target are published; …
```

## I3 — lightningcss has no compat page

```
$ grep -rl lightningcss docs/public
(no output)
$ ls docs/public/compat
README.md buffer.md esbuild-js-api.md fs.md git.md http.md incompatible-packages.md
modules.md package-tooling.md process.md sass-embedded.md streams.md ts-language-service.md
vite-command.md wasi.md zlib.md
$ grep -n "sass-embedded\|lightningcss\|esbuild-js-api" tools/compat-matrix-generator/cli.js | head -3
11:const sassPolicyUrl = new URL('../shadow-registry/sass-embedded-policy.json', here);
128:    file: 'esbuild-js-api.md',
$ grep -n "id: 'rifty.shadow-substitution\|kind: 'semver-admits'\|kind: 'exact-only'" tools/shadow-registry/src/internal/catalog-source.ts
458:      id: 'rifty.shadow-substitution.esbuild.v2',
461:        kind: 'semver-admits',
491:      id: 'rifty.shadow-substitution.lightningcss.v2',
494:        kind: 'semver-admits',
523:      id: 'rifty.shadow-substitution.sass-embedded.v2',
526:        kind: 'exact-only',
$ sed -n '492,500p' tools/shadow-registry/src/internal/catalog-source.ts   # lightningcss recipe
      trigger: { name: 'lightningcss', version: '1.32.0' },
      admission: {
        kind: 'semver-admits',
        unsupportedFeature: 'lightningcss.version',
      },
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
```

## I4 — admission refusal text

```
$ sed -n '8,11p' packages/io/src/errors.ts
  constructor(feature: string, hint?: string) {
    const detail = hint ? ` (${hint})` : '';
    super(`Not implemented: ${feature}${detail}`);   # → "Not implemented: esbuild.version (shadow recipe does not admit ^0.21.0)"
$ sed -n '89,98p' packages/npm-client/src/internal/shadow/admission.ts
  const admitted =
    recipe.admission.kind === 'semver-admits'
      ? matchesRange(recipe.trigger.version, requestedRange)
      : requestedRange === recipe.trigger.version;
  if (admitted) return;
  throw new NotImplementedError(
    recipe.admission.unsupportedFeature,
    `shadow recipe does not admit ${requestedRange ?? '*'}`,
  );
```

## sass-embedded admission + reach

```
$ sed -n '524,528p' tools/shadow-registry/src/internal/catalog-source.ts
      trigger: { name: 'sass-embedded', version: '1.100.0' },
      admission: { kind: 'exact-only', unsupportedFeature: 'sass-embedded.version' },
$ sed -n '192,194p' tools/compat-matrix-generator/cli.js
  if (admission.kind !== 'exact-only') {
    throw new Error('sass-embedded policy: admission.kind must be exact-only');
$ sed -n '10,13p' tools/shadow-registry/sass-embedded-policy.json
  "admission": { "kind": "exact-only", "unsupportedFeature": "sass-embedded.version" },
$ npm view vite@7.3.6 peerDependencies.sass-embedded peerDependencies.lightningcss
peerDependencies.sass-embedded = '^1.70.0'
peerDependencies.lightningcss = '^1.21.0'
$ npm view sass-embedded dist-tags --json
{ "latest": "1.105.0" }
$ npm view sass-embedded time --json | grep -E '"1\.100\.0"|"modified"'
  "modified": "2026-09-22T17:44:28.639Z",
  "1.100.0": "2026-05-22T00:56:33.894Z",
$ npm view esbuild version ; npm view vite@6 dependencies.esbuild | tail -1
0.28.2
vite@6.4.3 '^0.25.0'
```

## Catalog trigger-name uniqueness

```
$ sed -n '553,558p' tools/shadow-registry/src/internal/codec.ts
  const recipes = denseArray(item.recipes, 'catalog.recipes').map(…decodeRecipe…);
  sortedUnique(recipes.map((recipe) => recipe.id), 'catalog.recipes', …);
$ sed -n '28,29p' packages/npm-client/src/internal/shadow/admission.ts
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === name,
$ sed -n '134,136p' packages/npm-client/src/internal/shadow/planner.ts
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === name && candidate.trigger.version === version,
$ grep -rn -i 'unique\|duplicate' tools/shadow-registry/src/internal/*.ts | grep -v test
codec.ts:160: function sortedUnique(values, path, subject)      # ids + member lists only
```

## Workbench void guards

```
$ grep -n 'seenRequestIds' packages/workbench/src/workers/playground-session-tools-owner.ts
147:  const seenRequestIds = new Set<string>();
452:    if (seenRequestIds.has(frame.requestId)) {
457:    seenRequestIds.add(frame.requestId);
$ grep -rn 'beforeRun' packages apps --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
packages/workbench/src/workers/pty-server.ts:148:  readonly beforeRun?: (emit: …) => void | Promise<void>;
packages/workbench/src/workers/pty-server.ts:412:        const gate = this.#deps.beforeRun?.((chunk, stream) => {
$ sed -n '386,393p' packages/workbench/src/workers/workbench-project-runtime.ts
  const ptyServer = createPtyServer({ send, makeShell, beforeExit: options.publicationBarrier,
    onPreviewReq, onDevServerReq, onDevConfig });          # no beforeRun
$ git log --oneline -S'restoring project dependencies' -- . | head -1
7f725b31c refactor: extract sealed workbench package
```


## Review record (`RDY-6` final check of the written result, `REV-8`)

Reviewed: main `99fdf6c91` + working tree, 2026-09-27; fresh read-only
general-purpose subagents, no author context. Challenge critic (sonnet):
`challenge: 2026-09-27 — clear`, 1 advisory (cross-link, applied).

| pass | model | verdict | blockers → resolution |
|---|---|---|---|
| 1 | opus | 9 findings | (b) storage class "closed" unproven → re-probed; ADR-0299 row false (quarry ADR) → dropped; 7 transcription/line-ref fixes |
| 2 | opus | 8 findings | I5 (storage fallback reason) premise false — `DegradedBanner` + chip already explain → I5 + child removed; I1 "terminal-less project-open path" claimed → extended (later reverted) |
| 3 | opus | 1 challenge problem + 2 findings | I1 extension premise false — from-scratch open runs `npm install` in the terminal (`project-runtime-acquisition.ts:9-22`) → I1 reverted to terminal-only naming the automatic install; scenario step 3 trigger/twin wording fixed |
| 4 | opus | PASS, 3 transcription fixes | evidence outputs pasted verbatim; §Challenge sentence replaced by this record |

Final state checked in pass 4: I1–I4 false on main and user-observable;
decision attribution matches the user's verbatim answers; no `I5` /
project-open residue; `backlog:check` + `refs:check` OK; ready-epic
requirements of `tools/backlog/check.mjs` met.
