# OPFS preload / handle evidence

2026-09-08; source baseline 6288fe1f188ed4e8f055a7b8d50d3d7ba267ed39;
Node v24.16.0, Chromium 148.0.7778.96. Real OPFS in a fresh no-COI dedicated
Worker, eight native files at `/preload-<uuid>/a/b/file-N.txt`; fixture cleans
only its own generated directory. Prototype instrumentation delegates receiver
and arguments with Reflect.apply; fault modes reject only native storage reads.

## Command and observed RED

```sh
RIFTY_PLAYGROUND_PORT=5334 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-preload-handles.spec.ts
```

Executed before product changes: three designed failures, one preservation pass.

```json
{"mode":"preload","calls":{"root":2,"directory":24,"fileHandle":8,"getFile":16},"elapsedMs":2.299999952316284,"actual":["file-0.txt","file-1.txt","file-2.txt","file-3.txt","file-4.txt","file-5.txt","file-6.txt","file-7.txt"]}
{"mode":"unreadable","boot":{"ok":true},"preload":{"ok":true},"read":{"ok":true,"value":[]},"copy":{"ok":true},"copied":true}
{"mode":"concurrent","initialCalls":12,"rejected":{"ok":false,"error":"NotAllowedError"},"recovered":{"ok":true}}
{"mode":"native","before":"file-0.txt","fresh":"changed","current":"recreated","oldView":{"ok":false,"error":"NotFoundError"},"missing":{"ok":false,"error":"VfsError"},"invalidReceiver":{"ok":false,"error":"TypeError"},"invalidArgument":{"ok":false,"error":"TypeError"}}
```

Expected delivered native-call shape for this tree: root 1, directory 0,
fileHandle 0, getFile 8. Byte loading still eager. Timing is an observation,
not a promised speedup. Native preservation passed against the current source;
no new proxy is proposed, so native methods/handles stay structurally untouched.

Separate follow-up command (same versions/source):

```sh
RIFTY_PLAYGROUND_PORT=5334 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-preload-handles.spec.ts -g unreadable-bytes
```

One designed failure: successful getFile followed by injected native
Blob.arrayBuffer NotReadableError also produces
`{"boot":{"ok":true},"preload":{"ok":true},"read":{"ok":true,"value":[]},"copy":{"ok":true},"copied":true}`.
The fixture establishes its explicit indexed-but-uncached copy/read instance
without read denial, then enables denial for preload; an implementation may
therefore honestly reject an index walk as well as a preload.

Final full-file rerun after that fixture adjustment: four designed failures
(preload, unreadable, unreadable-bytes, concurrent), one native preservation pass;
12.1s overall. Same calls and bytes; preload elapsed 4.5ms. This is the final
pre-implementation RED artifact.

## Mechanism alternatives / owner sweep

- **One-pass eager traversal**: keep enumerated raw handles only during traversal;
  obtain one fresh File per entry, use its metadata and arrayBuffer bytes. Kills
  the repeated path walk, requires no global handle invalidation or wrapper.
- **Long-lived path/native-wrapper cache**: unnecessary to attain these counts;
  introduces foreign deletion/recreation, old-view and receiver semantics which
  the raw traversal avoids. Rejected pending stronger forcing evidence.
- **Lazy content loading**: cannot satisfy the synchronous first read contract;
  not part of this goal's I5.
- **Unreadable-file error ledger**: preserves availability of other files but
  adds per-file failure/healing authority. Fail initialization plus uncached-read
  error is smaller and satisfies I3; requires superseding ADR-0072's explicit
  empty fallback before product changes.

ADR-0358 / OpfsDrainScheduler already owns bounded per-path write-through,
structural fences, persist ledger ordering and DrainDirHandleCache. That cache
must die on structural registration and drain idle; boot reuse must not extend
its lifetime. Per-instance init promise belongs in OpfsVfs, resets on rejection;
paired root belongs at installOpfsFs composition. No new global scheduler.

## Preparation limits

Initial sandbox run could not bind ::1:5334; rerun with approved escalation.
An initial fixture import mistakenly requested internal installOpfsFs from the
public package and failed at module load; fixed fixture to use public initBackend
and syncMirror before collecting any baseline above. Neither harness failure is
product RED. No product files changed by this preparation.
