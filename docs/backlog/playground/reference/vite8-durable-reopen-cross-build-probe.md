# Vite 8 durable reopen cross-build probe

Recorded 2026-07-28 at `23948c3dd54989eaa5c01543fa92e8d717d94f19`.
This is readiness evidence, not acceptance coverage or the repair.

## Fixture

The probe runs from the repository root. It obtains the exact pre-policy
definition source, baked identity, and Vite 8 snapshot from Git commit
`7177b9da13732ba512ccd319d462682443c53f54`. It starts that historical build,
saves Vite 8 project A and stable Vite 7 project B in real Chromium OPFS, then
restarts the current build on the same origin and BrowserContext.

The old snapshot is reconstructed in memory from the committed current
snapshot plus the historical delta. No second 14 MB snapshot is committed. The
Vite config's `rifty:sw-bundle` plugin is explicitly removed, both Vite caches
live in a temporary directory, and the probe fails if repository status changes.
The Vite 7 setup leg uses the real snapshot/registry boundary; nothing being
tested is mocked.

The disposable probe source is retained in reachable commit
`72410f0308f2613176e111003d322535dced24ce` and removed from the terminal split
per `decision-workflow.md` §Refine altitude. To reproduce, check out that commit
in a disposable worktree with the old Git object, installed workspace
dependencies, Chromium, and network access for a cold Vite 7 setup, then run:

```sh
pnpm exec tsx tools/probes/vite8-durable-reopen-cross-build.mts
```

## Exact output

Generated project IDs and names vary. This is the complete successful JSONL
output captured for the run above:

```jsonl
{"proof":"environment","node":"v24.16.0","pnpm":"11.5.2","tsx":"4.22.3","vite":"5.4.21","playwright":"1.60.0","platform":"darwin-arm64","gitHead":"23948c3dd54989eaa5c01543fa92e8d717d94f19","oldCommit":"7177b9da13732ba512ccd319d462682443c53f54"}
{"proof":"historical-delta","currentSnapshotId":"sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da","oldSnapshotId":"sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582","currentCompressedBytes":14260705,"oldCompressedBytes":14260599,"packageJsonBytes":148,"lockfileBytes":10312,"changedFiles":[{"path":"postcss/lib/processor.js","encodedBytes":2320},{"path":"postcss/lib/stringifier.js","encodedBytes":15620},{"path":"postcss/package.json","encodedBytes":3332}],"deltaJsonBytes":33093,"byteExactReconstruction":true}
{"proof":"browser","chromium":"148.0.7778.96"}
{"proof":"old-save","origin":"http://127.0.0.1:5173","storage":"opfs","projectA":"Old-Vite8-A-1785243289077","projectAId":"project-c02cbf79-ec90-437a-b698-dbb17e5e6f92","projectB":"Stable-Vite7-B-1785243289077","projectBId":"project-2000be3f-c7dd-4feb-940a-12be7e9628e3","manifest":{"dependencies":{"vite":"8.0.16"},"name":"rifty-vite8-app","private":true,"scripts":{"dev":"vite","vite":"vite"},"type":"module","version":"0.0.0"},"runtimeVersion":"1.1.6","scratchStamp":{"root":"/.rifty/workbench/v1/projects/scratch/tree","slug":"scratch","requestBytesMatch":true,"installArtifactIdentity":"sha256:de9e5426b878f6dda62f03b119e74a7b90dc71e29a859cc5625e196cf88c282d","lockfileSha256":"b3a9d99a1e207ca4e15976050f45460e40505077c8709cafc6ff301131958031","packages":20,"trusted":true},"savedStamp":{"root":"/.rifty/workbench/v1/projects/project-c02cbf79-ec90-437a-b698-dbb17e5e6f92/tree","slug":"project-c02cbf79-ec90-437a-b698-dbb17e5e6f92","requestBytesMatch":true,"installArtifactIdentity":"sha256:de9e5426b878f6dda62f03b119e74a7b90dc71e29a859cc5625e196cf88c282d","lockfileSha256":"b3a9d99a1e207ca4e15976050f45460e40505077c8709cafc6ff301131958031","packages":20,"trusted":true},"definition":{"definitionIdentitySha256":"sha256:514115c04aafa99ee4907d30afe48dace86bd28e694ed7ec12b1194dc18800e8","catalogMatchesDefinition":true,"expectedBuildIdentityMatches":true},"acquisitionRequests":["/snapshots/vite8-node-modules.json.gz","/snapshots/vite-node-modules.json.gz","/npm-registry/esbuild-wasm","/npm-registry/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz"]}
{"proof":"current-mismatch","origin":"http://127.0.0.1:5173","reopenedName":"Stable-Vite7-B-1785243289077","liveBefore":1,"staleProject":"Old-Vite8-A-1785243289077","errorText":"Project switch failed: ProjectDefinitionMismatchError: project \"project-c02cbf79-ec90-437a-b698-dbb17e5e6f92\" has a different definition","acquisitionRequests":[],"currentHalfSwitchRed":{"chip":"Choose project","live":0,"projectAActive":"true","projectBActive":"false"}}
{"proof":"current-reset","manifest":{"dependencies":{"vite":"8.0.16"},"name":"rifty-vite8-app","overrides":{"@napi-rs/wasm-runtime":"npm:@napi-rs/wasm-runtime@1.1.6"},"private":true,"scripts":{"dev":"vite","vite":"vite"},"type":"module","version":"0.0.0"},"runtimeVersion":"1.1.6","stamp":{"root":"/.rifty/workbench/v1/projects/project-c02cbf79-ec90-437a-b698-dbb17e5e6f92/tree","slug":"project-c02cbf79-ec90-437a-b698-dbb17e5e6f92","requestBytesMatch":true,"installArtifactIdentity":"sha256:de9e5426b878f6dda62f03b119e74a7b90dc71e29a859cc5625e196cf88c282d","lockfileSha256":"64aceec273c90e7ae52264bbb604a5d95bf79884860ad6f25145bf828667089f","packages":20,"trusted":true},"definition":{"definitionIdentitySha256":"sha256:bbed42c9613e512aa17d5831387107ba0c520b2c414deb7219056c7293285f8c","catalogMatchesDefinition":true,"expectedBuildIdentityMatches":true},"definitionChanged":true,"acquisitionRequests":["/snapshots/vite8-node-modules.json.gz"]}
{"proof":"offline-reopen","switchedFrom":"Stable-Vite7-B-1785243289077","activeName":"Old-Vite8-A-1785243289077","runtimeVersion":"1.1.6","acquisitionRequests":[],"elapsedMs":38778}
{"proof":"repository-state","unchanged":true}
```

## Historical delta

Old and current snapshots have the same dependency request, package count,
install-artifact identity, node_modules root, and 367 file paths. There are no
added or removed files. The byte-exact old serialization differs only in:

| field or file | historical bytes |
| --- | ---: |
| `packageJsonText` | 148 |
| `lockfile` | 10,312 |
| `postcss/lib/processor.js` encoded content | 2,320 |
| `postcss/lib/stringifier.js` encoded content | 15,620 |
| `postcss/package.json` encoded content | 3,332 |
| complete JSON delta | 33,093 |

The reconstruction hashes to
`sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582`;
the current snapshot hashes to
`sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da`.

## Observed contract gap

The current build reopens B live. Clicking stale A rejects its historical
definition before any snapshot or registry request. The current implementation
has already closed B and activated A in the catalog, however: the chip says
`Choose project`, no runtime is live, and A is marked active.

The probe intentionally asserts that present half-switch RED and therefore exits
zero while the finding remains reproducible. It must not be used as post-fix
acceptance. Reset then proves the current manifest, snapshot, definition,
trusted durable tree, and runtime; the final offline B-to-A reopen makes zero
acquisition requests.
