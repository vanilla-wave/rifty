# ADR 0137: Shell PATH-style node_modules/.bin resolution + injected BinExecutor seam

Status: Accepted (2026-06-13)
Date: 2026-06

> TL;DR: A shell command miss walks up to the nearest `node_modules/.bin/<name>` shim and runs it through an injected `BinExecutor`; the host runs the shim via a `kind:'url'` node-entry bootstrap that imports the launcher target through the module loader (Opt-Y), so installed CLIs (`eslint`, `tsc`, …) are invokable by name. `child_process.spawn('node', …)` shares the same bootstrap.

## Context

`install()` writes `node_modules/.bin/<cmd>` launcher shims (`#!/usr/bin/env node` + `import('../<pkg>/<bin>')`) but the shell had no PATH-style lookup — a bare `eslint` hit "command not found" (exit 127). `npm run` special-cased `vite`/dev-script in the host runner. Closes `docs/backlog/shell/node-modules-bin-execution.md`.

Executing a Node program needs a Worker realm; the shell layer's deps are only `@riftydev/io` + `@riftydev/vfs` (no kernel). So execution can't live in the shell.

## Decision

**Resolution order (shell):** registered (builtins + `registerCommand`) → walk-up nearest `node_modules/.bin/<name>` → miss. `bin-resolver.ts` walks cwd→`/`, first file hit wins. Bare names only — a name containing `/` is a path, never a PATH lookup (bash). `which` reports the resolved shim path for installed CLIs.

**Execution (injected, not imported):** `ShellOptions.execBin?: BinExecutor` — the host supplies it. Rejected importing `@riftydev/kernel` into the shell: widens a leaf package's dep graph; the host already owns Worker spawn; mirrors the existing `npm run` `runScript` injection precedent. A resolved shim runs through the normal handler path (inherits SIGINT abort-race + `>` redirect flush).

**Exit codes:** shim found + no `execBin` → 126 ("installed, cannot execute here"), distinct from the 127 miss — never a silent stub. Executor exit code is the segment exit code.

**Host executor (playground), Opt-Y:** `createBinExecutor` spawns the `kind:'url'` **node-entry bootstrap** (`workers/node-entry-bootstrap.ts`) via `globalProcessManager.spawnWorker`, passing the shim path as `argv[1]` and `RIFTY_BIN=1`. In the worker the bootstrap calls runtime-js `runNodeEntry`: it reads the shim, pulls its launcher target (`import('../<pkg>/<bin>')`), and imports THAT through `createModuleLoader` — so the bin runs with relative imports resolved against the VFS. stdout/stderr stream to the context; `ctx.signal` kills the worker. SAB-IPC-gated (`NotImplementedError` when COI is absent).

> Rejected (and the original mistake): spawning the shim TEXT as a `kind:'source'` worker. The kernel runs `kind:'source'` via `new AsyncFunction`, which (a) throws `SyntaxError` on the shim's `#!/usr/bin/env node` line, and (b) never routes the shim's dynamic `import()` to the VFS loader — so it cannot run a real shim. `sourceUrl` is only a `//# sourceURL=` stack-trace pragma, NOT an import anchor; `allowHashBang` lives in the ESM AST path this never reaches. The execSync/realVite precedents use `kind:'url'`, so they did not transfer.

**Loader shebang (Node parity):** the module loader did not strip a leading `#!` — the CJS path threw, and the ESM executor re-wrapped the shebang too (`allowHashBang` only helped the parse). Both now strip it at source read (`resolver.ts`), matching Node's `Module._compile`. This is the shared fix every Node-entry path needs (parity cases `modules/{cjs,esm}-shebang`), and the reason a launcher target (CJS or ESM) now runs.

**child_process consistency:** the worker path of `child_process.spawn('node', [script])` routes through the SAME node-entry bootstrap (injected via `setNodeEntryWorkerUrl`, mirroring the kernel's `setKernelWorkerUrl`), so a spawned `node <script>` with a shebang / relative import runs via the loader too. `execSync`'s recursive runner stays on `kind:'source'` for now (its conformance runner executes the spec in Node, where the `kind:'url'` bootstrap can't load) — tracked in the backlog.

## Consequences

- Installed CLIs invokable by name at the prompt; `which <cli>` resolves; background (`cli &`) threads `execBin` to the clone.
- Registered commands still shadow same-named shims — the playground keeps `vite` lifecycle ownership.
- New public API (IRREVERSIBLE): shell `BinExecutor` type + `ShellOptions.execBin`; runtime-js `setNodeEntryWorkerUrl`/`getNodeEntryWorkerUrl` host-wiring seam (mirrors `setKernelWorkerUrl`) + the `runNodeEntry` primitive. Additive — existing callers unchanged.
- The module loader now strips a leading shebang (CJS + ESM) — Node parity; benefits every "run a VFS Node entry" path.
- Verification split (honest): the execution MECHANISM (`runNodeEntry` + loader + launcher-target resolve) is proven by node unit tests + parity. NOT YET working end-to-end in the browser — a draft COI e2e showed the spawned bin worker's `syncMirror` is an empty in-worker realm that does not hold the installed `node_modules`, so a real CLI `ENOENT`s on its shim. The shell contract (resolve / dispatch / `which` / 126-127) IS delivered + tested; the playground execution is wired but the worker-VFS transport is incomplete.
  - **Corrected (2026-06-14, ADR-0143):** the original parenthetical here — "after ADR-0135 `install()` runs in the worker/OPFS realm" — was WRONG. That describes the PREVIEW/install flow; the SHELL's ad-hoc `npm install` writes to **PAGE memory** (ADR-0135: page is memory-backed, sync OPFS is worker-only, no shared OPFS), so the bin worker can never reach it by "opening the install realm's OPFS". The fix is a transport/ownership decision, settled as **D (owner-worker)** in ADR-0143.
- Follow-ups (tracked in `docs/backlog/shell/node-modules-bin-execution.md`): the bin worker-VFS transport — **decided D (owner-worker) in ADR-0143** (the old "make the bin worker read the install realm's OPFS-backed VFS" premise was wrong, see Corrected above); `execSync` shebang/relative via the node-entry bootstrap (lands inside D — the standalone flip regresses `execsync-sab.spec.ts`, see `docs/backlog/runtime-js/execsync-node-entry-loader.md`); routing `npm run` script lines through `.bin` (replacing the hardcoded vite/dev switch).
