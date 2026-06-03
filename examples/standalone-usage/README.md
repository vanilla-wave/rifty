# @riftydev examples — standalone usage

Small, focused examples that each exercise **one** `@riftydev` package, so you can learn a
part without the whole playground. The first four run in plain Node:

```bash
pnpm --filter @rifty-examples/standalone start   # run all four
# or one at a time:
pnpm --filter @rifty-examples/standalone vfs
pnpm --filter @rifty-examples/standalone semver
pnpm --filter @rifty-examples/standalone registry
pnpm --filter @rifty-examples/standalone shell
```

| File | Package(s) | Shows |
|---|---|---|
| [`src/01-vfs.ts`](./src/01-vfs.ts) | `@riftydev/vfs` | in-memory mkdir / writeFile / readFile / readdir / stat |
| [`src/02-semver.ts`](./src/02-semver.ts) | `@riftydev/npm-client` | `parse` / `compare` / `matchesRange` / `pickBestVersion` |
| [`src/03-registry.ts`](./src/03-registry.ts) | `@riftydev/npm-client` | `RegistryClient` with an injected `fetch`, packument → best version |
| [`src/04-shell.ts`](./src/04-shell.ts) | `@riftydev/shell` | running a `mkdir && echo > && cat && ls` command line |

## Browser-only examples

These need a browser (or a Worker-capable bundler) and the prerequisites in the root
[README](../../README.md#consuming-rifty-in-your-own-app--read-this-first) (COOP/COEP,
module Workers). They are reference snippets, not Node-runnable:

**Evaluate JS in a Worker — `@riftydev/runtime-js`:**

```ts
import { spawnRuntime } from '@riftydev/runtime-js';

// workerUrl must resolve to the package's worker entry, e.g. with Vite:
const workerUrl = new URL('@riftydev/runtime-js/worker', import.meta.url);
const rt = spawnRuntime({ workerUrl });
rt.on((e) => { if (e.type === 'stdout') console.log(e.chunk); });
const result = await rt.eval('console.log(1 + 2); 40 + 2');
console.log('result =', result);
rt.dispose();
```

**Run a `.wasm` under WASI — `@riftydev/runtime-wasi`:**

```ts
import { runWasi } from '@riftydev/runtime-wasi';

const wasm = await fetch('./hello.wasm').then((r) => r.arrayBuffer());
const { exitCode, stdout } = await runWasi(wasm, { args: ['hello'], env: {}, preopens: { '/': '/' } });
console.log(exitCode, stdout);
```

The full product demo (editor + terminal + live preview, all packages wired together)
is the [playground](../../apps/playground) — `pnpm dev`.
