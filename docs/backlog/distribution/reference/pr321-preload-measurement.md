# PR #321 — persisted Vite preload measurement

2026-09-08; Darwin arm64; Chromium 148.0.7778.96. Measured product
`0e065420ca0e67ac55480c64c09e2c87a03fd970`; baseline
`9a6331194f4b67245c2ab118a72f93920da584c5` (pre-PR main).
Raw samples, phases, native counters, byte counts and snapshot SHA-256:
[pr321-preload-comparison.json](pr321-preload-comparison.json).

## Method and result

Real committed `apps/playground/public/snapshots/{vite,vite8}-node-modules.json.gz`
bytes persisted through native OPFS, fresh browser context per template. Same immutable
persisted tree read in order current/old/old/current/current/old. Full old `opfs.ts`
and `opfs-sync.ts` loaded from pinned git revision; only import locations rewritten.
Imports, snapshot decode, native persistence and exact-byte proof outside preload timing.
Every byte of every cached file checked after every sample. Transparent wrappers count
native calls and time old metadata/content methods; current fused walk/content stays one
phase. No concurrent browser lanes. Final probe: 2/2 passed, 8.4 s.

| Tree | Files / bytes | Old median (range), ms | Current median (range), ms | Median change |
| --- | --- | --- | --- | --- |
| Vite 7 | 250 / 23,588,143 | 85.145 (75.215–85.830) | 70.190 (69.175–80.975) | −17.56% |
| Vite 8 | 363 / 41,462,722 | 94.570 (92.205–120.805) | 97.705 (83.330–112.145) | +3.32% |

Native calls, old → current (`root / directory / fileHandle / getFile`):
Vite 7 `2 / 1051 / 250 / 500 → 1 / 0 / 0 / 250`;
Vite 8 `2 / 1559 / 363 / 726 → 1 / 0 / 0 / 363`.
`arrayBuffer` exactly once per file in both variants.

No consistent elapsed regression demonstrated on these snapshots; Vite 8 ranges overlap.
Three samples each cannot establish statistical equivalence. These are warm persisted-tree
reads, not full-page startup, cold disk-cache trials, or thousands-file scalability proof.
The existing 26k-file drain fixture uses procedural bytes; it was not substituted for real
Vite content. Initial disposable probe double-decompressed Vite's already decoded gzip
response; corrected to `response.json()` before the reported passing measurement.

## Separate CI drain result

[CI run 34243169765](https://github.com/vanilla-wave/rifty/actions/runs/34243169765)
failed the pending-write probe at `tests/browser-unit/opfs-parallel-drain.spec.ts:191`:
`(2.90952500000014 − 2.073399999999674) × 53622 = 44834.69475002498 ms`,
ceiling `15036.300000000001 ms`. Both 26,811-file exact-byte proofs and zero-failure
ledgers passed. Reported speedup `150363 / 39698 = 3.7876714002360816` exceeds
`2.625`; the earlier probe assertion prevented reaching the speedup assertion.

One isolated unchanged test passed locally, 1/1 in 1.3 min:
`41468 / 12924 = 3.208747128778582` speedup;
write-probe delta `6.702711646552806 ms ≤ 4146.8 ms`; both full-tree proofs passed.

```sh
RIFTY_PLAYGROUND_PORT=5374 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-parallel-drain.spec.ts --grep 'durability drain' --workers=1
```

In `tests/browser-unit/fixtures/opfs-parallel-drain-worker.ts`, `runVariant` finishes
`OpfsFsSync.init(surface)` before either drain timer; whole-tree proof also runs outside
the timer. PR changes neither fixture nor `writeFileSync`, `flush`, or scheduler admission.
The CI failure therefore does not measure sequential preload.

The write probe compares serial native writes with 16-lane batched writes; its delta can
include native concurrency effects as well as flush overhead. Their contributions and the
Linux failure's cause remain unproven. A macOS isolated pass does not close CI. If Linux red
repeats, next bounded diagnostic: isolate this same spec on that runner, then separate
native-write phase time from flush bookkeeping. No threshold, timeout or product change
made for either measurement.

## Reproduce the preload probe

Use project root with dependencies installed and the measured product sources available;
reserve the browser interval. Run this script to extract the two fenced probe sources
below and materialize old modules from git. Existing scratch files cause an error.
Old product copies remain disposable; this document does not vendor them.

```sh
python3 - <<'PY_REPRO'
from pathlib import Path
import re
import subprocess

root = Path.cwd()
doc = root / 'docs/backlog/distribution/reference/pr321-preload-measurement.md'
text = doc.read_text()
blocks = re.findall(r'### `(tests/browser-unit/[^`]+)`\n\n```typescript\n(.*?)\n```', text, re.S)
assert len(blocks) == 2
baseline = '9a6331194f4b67245c2ab118a72f93920da584c5'
outputs = {root / path: source + '\n' for path, source in blocks}
for name in ('opfs', 'opfs-sync'):
    source = subprocess.check_output(
        ['git', 'show', f'{baseline}:packages/vfs/src/{name}.ts'], text=True,
    )
    source = re.sub(
        r"(['\"])\./([^'\"]+)\1",
        lambda match: "'../../../packages/vfs/src/" + match.group(2) + "'",
        source,
    )
    outputs[root / f'tests/browser-unit/fixtures/__pr321-old-{name}.ts'] = source
assert not any(path.exists() for path in outputs), 'scratch path already exists'
for path, source in outputs.items():
    with path.open('x') as output:
        output.write(source)
PY_REPRO
RIFTY_PLAYGROUND_PORT=5374 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/__pr321-preload-probe.spec.ts --workers=1
```

After capturing `PR321-PRELOAD` JSON lines, remove only the four generated files:

```sh
rm tests/browser-unit/__pr321-preload-probe.spec.ts tests/browser-unit/fixtures/__pr321-preload-probe-worker.ts tests/browser-unit/fixtures/__pr321-old-opfs.ts tests/browser-unit/fixtures/__pr321-old-opfs-sync.ts
```

### `tests/browser-unit/__pr321-preload-probe.spec.ts`

```typescript
import { expect,test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
for(const template of ['vite','vite8']) test(`PR321 measured persisted ${template}`,async({page,browser})=>{
 test.setTimeout(120_000);await gotoHarness(page);
 const result=await page.evaluate(async ({url,template})=>{
 const workerModule=await import(/* @vite-ignore */url);const worker=new Worker(workerModule.default,{type:'module'});
 try{return await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.ok?resolve(e.data.result):reject(new Error(JSON.stringify(e.data)));worker.onerror=e=>reject(new Error(e.message));worker.postMessage({template});});}finally{worker.terminate();}
 },{url:`/@fs${process.cwd()}/tests/browser-unit/fixtures/__pr321-preload-probe-worker.ts?worker&url`,template});
 console.log(`PR321-PRELOAD ${browser.version()} ${JSON.stringify(result)}`);expect(result).toBeTruthy();
});
```

### `tests/browser-unit/fixtures/__pr321-preload-probe-worker.ts`

```typescript
/// <reference lib="webworker" />
import { OpfsFsSync } from '../../../packages/vfs/src/opfs-sync.ts';
import { OpfsVfs, acquireOpfsRoot } from '../../../packages/vfs/src/opfs.ts';
import { OpfsFsSync as OldSync } from './__pr321-old-opfs-sync.ts';
import { OpfsVfs as OldVfs } from './__pr321-old-opfs.ts';

declare const self: DedicatedWorkerGlobalScope;
const calls = { root: 0, directory: 0, fileHandle: 0, getFile: 0, arrayBuffer: 0 };
const reset = () => { for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = 0; };
for (const [prototype, name, key] of [
  [StorageManager.prototype, 'getDirectory', 'root'],
  [FileSystemDirectoryHandle.prototype, 'getDirectoryHandle', 'directory'],
  [FileSystemDirectoryHandle.prototype, 'getFileHandle', 'fileHandle'],
  [FileSystemFileHandle.prototype, 'getFile', 'getFile'],
  [Blob.prototype, 'arrayBuffer', 'arrayBuffer'],
] as const) {
  const d = Object.getOwnPropertyDescriptor(prototype, name)!;
  Object.defineProperty(prototype, name, { ...d, value: function(this: unknown, ...args: unknown[]) {
    calls[key]++; return Reflect.apply(d.value, this, args);
  }});
}
self.onmessage = async (event) => {
  try {
    const template = event.data.template as string;
    const fetchT0 = performance.now();
    const response = await fetch(`/snapshots/${template}-node-modules.json.gz`);
    const snapshot = await response.json();
    const files = snapshot.nodeModules.files.map((f: {path: string; content: string}) => ({
      path: `/workspace/node_modules/${f.path}`,
      bytes: Uint8Array.from(atob(f.content), c => c.charCodeAt(0)),
    }));
    const decodeMs = performance.now() - fetchT0;
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      await root.removeEntry(name, {recursive: true});
    }
    const writeT0 = performance.now();
    const dirs = new Map<string, FileSystemDirectoryHandle>([['',root]]);
    for(const f of files) {
      const segs = f.path.slice(1).split('/'); const name = segs.pop()!;
      let prefix=''; let parent=root;
      for(const seg of segs) { prefix += '/'+seg;
        let dir=dirs.get(prefix); if(!dir) { dir=await parent.getDirectoryHandle(seg,{create:true}); dirs.set(prefix,dir); } parent=dir;
      }
      const h=await parent.getFileHandle(name,{create:true});const writer=await h.createWritable(); await writer.write(f.bytes); await writer.close();
    }
    const persistMs=performance.now()-writeT0;
    const results=[];
    for(const variant of ['current','old','old','current','current','old'] as const) {
      reset(); const t0=performance.now(); const phases: Record<string,number>={}; let fs: OpfsFsSync | OldSync;
      if(variant==='current') {
        const nativeRoot=await acquireOpfsRoot();const vfs=new OpfsVfs(nativeRoot);phases.rootMs=performance.now()-t0;
        const start=performance.now(); fs=await OpfsFsSync.init(vfs,nativeRoot); phases.walkAndContentMs=performance.now()-start;
      } else {
        const refresh=OldSync.prototype.refreshIndex; const preload=OldSync.prototype.preloadContent;
        OldSync.prototype.refreshIndex=async function(){const s=performance.now();try{return await refresh.call(this);}finally{phases.walkMs=performance.now()-s;}};
        OldSync.prototype.preloadContent=async function(){const s=performance.now();try{return await preload.call(this);}finally{phases.contentMs=performance.now()-s;}};
        try { const vfs=new OldVfs();await vfs.init();phases.rootMs=performance.now()-t0;fs=await OldSync.init(vfs); }
        finally { OldSync.prototype.refreshIndex=refresh;OldSync.prototype.preloadContent=preload; }
      }
      const elapsedMs=performance.now()-t0;const counts={...calls};const proofT0=performance.now();let verifiedBytes=0;
      for(const f of files) { const bytes=fs.readFileBytesSync(f.path);
        if(bytes.length!==f.bytes.length)throw new Error('size mismatch '+f.path);
        for(let i=0;i<bytes.length;i++)if(bytes[i]!==f.bytes[i])throw new Error('byte mismatch '+f.path+'@'+i);
        verifiedBytes+=bytes.length;
      }
      fs.closeAll();results.push({variant,elapsedMs,phases,counts,verifiedBytes,proofMs:performance.now()-proofT0});
    }
    self.postMessage({ok:true,result:{template,files:files.length,dirs:dirs.size-1,bytes:files.reduce((n:number,f:{bytes:Uint8Array})=>n+f.bytes.length,0),decodeMs,persistMs,results}});
  } catch(error) {self.postMessage({ok:false,error:String(error),stack:error instanceof Error?error.stack:''});}
};
```
