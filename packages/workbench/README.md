# @riftydev/workbench

Headless controllers for wiring rifty editor sync, previews, npm install, and
real-project runtime sessions from any UI framework.

## Host requirements

The host page must provide:

- COOP/COEP headers so `crossOriginIsolated` and `SharedArrayBuffer` are true.
- A module Worker URL for the kernel entry, passed to `setKernelWorkerUrl(...)`.
- A same-origin `/sw.js` bundled from `@riftydev/service-worker/sw`.
- A same-origin `/npm-registry` proxy, or a custom `registryFetch` passed to
  `runProjectWorker(...)`.

## Minimal session

After host boot, only `bootstrapWorkerUrl` is required to start the default
project session. The controller uses the default Vite template, `/workspace`,
the template port, `setup: 'instant'`, and no-op logging.

```ts
import { setKernelWorkerUrl } from '@riftydev/kernel';
import { registerServiceWorker } from '@riftydev/service-worker';
import { initBackend } from '@riftydev/vfs';
import {
  createEditorSync,
  createPreviewBinding,
  createRuntimeSession,
} from '@riftydev/workbench';
import kernelWorkerUrl from './rifty-kernel-worker.ts?worker&url';
import projectWorkerUrl from './rifty-project-worker.ts?worker&url';

setKernelWorkerUrl(kernelWorkerUrl);
await initBackend();
await registerServiceWorker('/sw.js');

const session = await createRuntimeSession({ bootstrapWorkerUrl: projectWorkerUrl });
await session.ready;

const preview = createPreviewBinding({ session });
iframe.src = preview.url; // /preview/5174/

const editor = createEditorSync({
  session,
  onSnapshot: (snapshot) => renderFileTree(snapshot),
});

editor.writeEntry('document.body.textContent = "hello";\n');
```

The Worker bootstrap URL is host-owned because only the consuming bundler knows
where it emitted the project Worker asset. A minimal Vite-style worker adapter
is:

```ts
// rifty-project-worker.ts
import { runProjectWorker } from '@riftydev/workbench/project-worker';

await runProjectWorker();
```

SQLite templates need a same-origin sql.js WASM asset:

```ts
import { runProjectWorker } from '@riftydev/workbench/project-worker';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

await runProjectWorker({ sqlWasmUrl });
```

## Custom project

```ts
import { createRuntimeSession, resolveProjectSpec } from '@riftydev/workbench';

const session = await createRuntimeSession({
  bootstrapWorkerUrl: projectWorkerUrl,
  template: resolveProjectSpec('express-sqlite'),
  setup: 'from-scratch',
  onLog: (chunk) => terminal.write(chunk),
});
await session.ready;

console.log(session.previewUrl);
```

## Terminal controller

```ts
import { createTerminalManager, createTerminalPersistence } from '@riftydev/workbench';

const persistence = await createTerminalPersistence('/workspace');
const manager = createTerminalManager({
  cwd: persistence.initialState.cwd,
  env: persistence.initialState.env,
});

const session = manager.sessions()[0]!;
manager.attachWriter(session.id, (chunk) => terminal.write(chunk));
await manager.runLine(session.id, 'echo hello');
```

## SDK subpath

One-install users can import the same controllers through `@riftydev/sdk`:

```ts
import { createRuntimeSession } from '@riftydev/sdk/workbench';
```
