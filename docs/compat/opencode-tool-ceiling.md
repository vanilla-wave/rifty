# opencode tool-execution ceiling — feasible vs impossible

> Source of truth for the no-tool-execution boundary of the opencode server
> facade (M12). Cross-linked from
> [`docs/opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md).
> Authored by feature-09 (tool-ceiling marker), decision D3 / Q-2026-05-30-062.

rifty runs **JavaScript + WASI WebAssembly only** — it can never spawn an OS
process, open a real PTY, or load a native `.node` addon (see
[`incompatible-packages.md`](./incompatible-packages.md) and `PROJECT_PLAN.md`
non-goals). That single architectural limit draws a hard line through opencode's
tool layer: every tool that only **reads and matches bytes** is feasible as an
in-realm substitute, and every tool that **spawns a process or a native binary**
is fundamentally impossible. The opencode *server* (Effect HTTP + LLM
round-trips over `fetch`) is portable; the part that makes it an agent that
*edits code* is the ceiling.

This is the WebContainers tool-layer-substitution model bounded by the spawn
ceiling: replace each read-only tool with a JS/VFS equivalent, and refuse the
ones that need a process. opencode's own tool wiring is **not** modified here —
this doc records the rifty-side capability and the boundary that a later
tool-substitution integration would consume.

## Feasible — read-only substitutes (in-realm `node:fs`, zero spawn)

Each substitute is exactly the existing in-realm `node:fs` surface running over
rifty's VFS sync mirror (`syncMirror()`) — no process is spawned. The table
column **Pinned by** names the test that proves it.

| opencode tool intent | rifty substitute (`node:fs` over VFS) | Status | Pinned by |
|---|---|---|---|
| read a file's contents | `fs.readFileSync(path, 'utf8')` / `fs.promises.readFile(path)` | ✅ | F09-T1 parity (`recursive-read.case.ts`) |
| list a directory | `fs.readdirSync(dir, { withFileTypes: true })` | ✅ | F09-T1 parity (`recursive-read.case.ts`) |
| recursive read / walk a tree | recursive `readdirSync(withFileTypes)` + `readFileSync('utf8')` | ✅ | F09-T1 parity (`recursive-read.case.ts`) |
| grep / search file contents | `vfsGrep(pattern, root, opts)` — pure-JS walk + JS `RegExp`, 1-based line/column (ripgrep/Node-grep convention) | ✅ | F09-T2/T3 unit (`utils/vfs-grep.test.ts`) |
| stat a path | `fs.statSync(path)` (`Dirent.isFile()`/`isDirectory()`) | ✅ | F09-T2 unit (`vfsGrep` walk classifies dir vs file via `Dirent`) |
| glob / include filter | `vfsGrep`'s `include` option — minimal **suffix/extension** match (e.g. `'*.ts'`), NOT full glob | ⚠ | F09-T3 unit (`include filter only scans matching paths`) |

Notes on the ⚠ row: `include` is a deliberate suffix match, not minimatch — a
full glob engine would be a new dependency (IRREVERSIBLE by reversibility rule 2)
and is out of scope for a ceiling marker (Q-2026-05-30-061). It widens to real
glob only behind explicit ratification.

Failure-mode contracts pinned by F09-T3 (each catches a specific articulated
failure mode, not coverage padding): `maxResults` bounds the walk (no unbounded
scan); `ignoreCase`; recursive descent into subdirectories; and a missing root
**propagates the underlying `node:fs` ENOENT** rather than swallowing it into an
empty result (no silent stub).

## Impossible — fundamentally unsupported (process spawn / native binary)

Every impossible opencode tool bottoms out in `child_process.spawn` of a real
binary, or a native C++ addon. In a browser/WASI realm there is no shell and no
process spawn, so any command other than `node <script>` falls through
`spawnViaSameRealm` → `execScript` and surfaces `spawn <cmd> ENOENT\n` on stderr
with **exit code 127** — it does **not** fake-succeed (`child_process-exec.ts:54-58`,
`child_process.ts:20-21` "there is no shell"). **Design TO these, never around
them.**

| opencode tool | What it needs | rifty status | Pinned by |
|---|---|---|---|
| bash / shell tool | `ChildProcess.make('bash', ['-c', …])` — a real shell process | ❌ ENOENT-127 (no shell) | F09-T4 conformance (`spawn('bash')` → 127, `spawn bash ENOENT`) |
| git tool | `Git.run` → `ChildProcess.make('git', …)` — the `git` binary | ❌ ENOENT-127 (no `git` binary) | F09-T4 conformance (`spawn('git')` → 127, `spawn git ENOENT`) |
| ripgrep search tool | spawns the **ripgrep BINARY** | ❌ ENOENT-127 (no binary spawn) | F09-T4 conformance (same `spawn(non-node)` → 127 substrate) |
| PTY / interactive sessions | `#pty` → `bun-pty` / `@lydell/node-pty`, native C++ | ❌ throws on session create (`#pty` stub) | feature-04 (`#pty` throw-on-create stub) |
| any tool writing to a spawned child's stdin | a real child process stdin port | ❌ `child.stdin.write` throws `NotImplementedError` (in-realm fallback has no worker stdin port) | F09-T4 conformance (`child.stdin.write` throws `NotImplementedError`) |

F09-T4 (`builtins/child_process-ceiling.test.ts`) is a **conformance** contract,
not a Node-parity case: real Node *would* spawn `git`/`bash`, so a parity diff is
the wrong tool. It asserts on `git`/`bash` only — both always fall through the
same-realm fallback, independent of the SAB / kernel-worker-url gate (which only
ever routes `node <script>` to the Worker path). opencode is **not** vendored;
the test pins rifty's own spawn substrate, which is what every impossible
opencode tool transitively hits.

## Observed at boot / first DB-read request — degraded-but-non-fatal

Driving the real server (BOOT + DB-READ opt-in gates,
`tests/integration/opencode-{boot,dbread}.opt-in.test.ts`) surfaced two
server-internal capabilities that hit the same native ceiling but which
**opencode itself degrades gracefully** — they log and continue, so the request
still returns 200. These are NOT spawn-tool calls; they are recorded here so the
degradation is disclosed rather than silent.

| opencode capability | What it needs | rifty status | Observed |
|---|---|---|---|
| file watching (`FileWatcher.init`) | native `@parcel/watcher-<platform>-<arch>` addon | ❌ no native addon → **no-op watch** | `service=file.watcher … watcher backend not supported` then continues (`file/watcher.ts:84-85`); `GET /session` still 200 |
| plugin/dependency auto-install | dynamic `import('@npmcli/arborist')` (npm install machinery — a tool-execution concern, intentionally outside the KEEP deps) | ❌ module absent → **background install fails, swallowed** | `WARN service=config … background dependency install failed: Cannot find module '@npmcli/arborist'`; backgrounded, request unaffected |

Both are consistent with the no-tool-execution facade: a browser/WASI realm has
no native file-watch backend and does not run npm installs. opencode's own
error-handling keeps them non-fatal, so they need no stub and no ADR — the
underlying limit is the same "no native addon / no spawn" line already drawn by
the rows above. If a future need makes either load-bearing (e.g. real file-watch
via a polling/chokidar fallback), open a fresh ADR then.

## Deferred (NOT adopted — behind explicit ADR ratification)

These would make the *feasible* side more capable but each is a **new external
dependency** → IRREVERSIBLE by reversibility rule 2, so none is adopted by the
marker. They are recorded here so a future search/git tool effort knows the gate
exists (Q-2026-05-30-061, decision 2).

| Candidate | Would provide | Why deferred |
|---|---|---|
| ripgrep-WASM (run via `runWasi`, like esbuild) | production-grade search fidelity + speed on large trees | vendors a `ripgrep.wasm` artifact + a build-time fetch → NEW dep → IRREVERSIBLE; needs its own ADR |
| isomorphic-git / wasm-git | read-only git (`log`, `readBlob`) as a second feasible substitute | NEW dep → IRREVERSIBLE; broader than a marker needs |

The marker deliberately stays on the pure-JS / existing-`node:fs` path. Promote
to ripgrep-WASM or isomorphic-git only if/when the facade's search or git tool is
actually exercised — and only via the ADR named
*"read-only tool substitutes for the opencode facade — JS-first,
ripgrep-WASM/isomorphic-git deferred"*.

## Bottom line

opencode's server slice is a **no-tool-execution agent facade**: it can read and
search the VFS (✅ rows above) but cannot run code, git, grep-the-binary, or a
PTY (❌ rows). The feasible substitutes are in-realm `node:fs` + JS matching; the
impossible ones are walled off by rifty's spawn ceiling, pinned as a behavioral
contract rather than asserted in prose.
