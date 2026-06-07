# ADR 0082: CommandContext gains optional stdin, isTTY, and cancellation fields

Status: Accepted (2026-06-06)
Date: 2026-06-06

## Context

`@riftydev/shell`'s public contract is `CommandContext = {cwd, env, stdout, stderr}` and `ShellCommand = (args, ctx) => Promise<number>` (`packages/shell/src/types.ts`, exported via `index.ts`). It is consumed across package boundaries by `registerCommand` registrants — today `apps/playground/src/glue/npm-shell-command.ts` (wired in `App.tsx`) and test harnesses. Any field added here is a cross-package public-API change.

Three rich-terminal/coreutils work items (research doc `docs/research/rich-terminal-coreutils-2026-06-06.md` §6 #1/#6/#9, §8 Q-ctx-shape/Q-stdin-ctx/Q-cancel/Q-color-tty) are each blocked on the same missing primitive — a new `CommandContext` field:

1. **stdin.** No reader on the context. Blocks `<` input redirect and pipe RHS (both `NotImplementedError` in `shell.ts` `runSegment`, M12). The WASI layer already has the analogue: `fd_read` pulls fd 0 from an `onStdin(): Uint8Array | null` callback, `null`/empty = EOF (ADR-0049). The shell has no equivalent.

2. **isTTY (+ cols/rows).** No TTY awareness. This is a **hard correctness** gap, not cosmetic: GNU `--color=auto` must suppress SGR when stdout is a redirect or pipe, or `ls > f` / `ls | grep` writes escape codes into the file/stream and corrupts the existing redirect feature (`shell.ts` redirect path). `cols` also feeds `ls` column width (fallback 80).

3. **cancellation.** The terminal already emits `onSignal('SIGINT')` on Ctrl+C (`terminal.ts`, echo-before-signal), but a running command cannot observe it — `CommandContext` exposes no signal. `Shell.run` `await`s the handler's returned exit code; a non-terminating foreground process (vite / `node http` dev server) never returns, so the dispatcher hangs forever. This — not background `&` — is the real "Express + vite in browser" blocker. Related but separate: Q-2026-06-05-317 (kernel tears down a long-running *worker* on top-level-await resolve).

Settling these as three separate ADRs would churn the same cross-package boundary three times. They are bundled here into one context-shape change. Checklist item 1 (public API between packages) → IRREVERSIBLE → inline ADR, not OPEN_QUESTIONS. (Same boundary class as Q-2026-06-03-310, which flagged `RiftyTerminalOptions` additions as IRREVERSIBLE.)

## Decision

Add three concerns to `CommandContext`, **all optional**, so every current builtin and `registerCommand` registrant keeps compiling and running unchanged (a command that ignores a field gets today's behavior).

```ts
/** Async stdin reader. `read()` resolves a chunk, or `null` at EOF. Mirrors
 *  the WASI fd_read onStdin model (ADR-0049). Absent ⇒ no input available. */
export interface StdinReader {
  read(): Promise<Uint8Array | null>;
}

export interface CommandContext {
  cwd: string;
  env: Record<string, string>;
  stdout: Writer;
  stderr: Writer;
  /** Present when input is connected (pipe RHS, `<` redirect, interactive). */
  readonly stdin?: StdinReader;
  /** stdout sink is an interactive terminal. Absent/false ⇒ redirect/pipe/non-TTY.
   *  Gate `--color=auto` SGR and column-width on this. */
  readonly isTTY?: boolean;
  /** Terminal width (cols) / height (rows) when isTTY; fall back to 80×24. */
  readonly cols?: number;
  readonly rows?: number;
  /** Aborts when the foreground command is cancelled (Ctrl+C / SIGINT).
   *  Long-running commands observe this to return; absent ⇒ never cancelled. */
  readonly signal?: AbortSignal;
}
```

`ShellCommand`'s type is unchanged (`(args, ctx) => Promise<number>`); only `ctx`'s shape grows, additively.

**Pinned sub-decisions:**

- **stdin — async with explicit EOF (Q-stdin-ctx).** `read(): Promise<Uint8Array | null>`, `null` = EOF. Async because pipe RHS / interactive reads are inherently async on the main thread; bytes (not string) to match the WASI surface and avoid lossy text framing. Optional ⇒ filters that need stdin check for `ctx.stdin` and error cleanly when absent (no silent stub).

- **isTTY built by the shell per sink (Q-color-tty).** The default interactive path sets `isTTY: true` (+ `cols`/`rows`). The **redirect path in `runSegment` and the future pipe RHS MUST set a non-TTY context** (`isTTY` false/absent) so SGR is suppressed into files/streams. Color is the consumer's responsibility (`--color=auto` reads `ctx.isTTY`); the shell only supplies the honest flag.

- **cancellation — `AbortSignal`, not a custom token (Q-cancel).** Web-standard, already understood by `fetch`, `AbortSignal.timeout`, `addEventListener('abort', …)`. A custom token would reinvent it and force every command to learn a rifty-specific API. The shell owns an `AbortController` per foreground run and passes `controller.signal` as `ctx.signal`.

- **`Shell.run` resolves on SIGINT.** `Shell.run`/`runSegment` gains a per-call `signal?: AbortSignal` (on `RunOptions`) supplied by the host. When that fires, the shell aborts its internal per-command controller. A command observing the signal returns an exit code (conventionally `130` = 128+SIGINT). For a command that never returns on its own (dev server), `run` resolves when the signal fires — via `Promise.race` between the handler promise and an abort-listener promise — yielding exit `130`. The handler keeps running until it honors the signal; the contract is "run resolves, command winds down on abort", deliberately *not* a hard kill (no job model here).

- **Terminal wiring.** The host (playground) bridges the existing `RiftyTerminal.onSignal('SIGINT')` to `controller.abort()` on the `AbortController` whose `signal` it passed into the current `Shell.run` call. No change to `RiftyTerminalOptions` (the `onSignal` hook already exists).

**Scope boundary:** this ADR defines only the context shape and the SIGINT-resolves-`run` contract. The actual `|` / `<` orchestration, glob, and the coreutils filters that consume `stdin` are M12 implementation (research §7 Phase 1) and not ratified here. Background `&` / job control stays deferred (Q-2026-06-05-317).

## Alternatives considered

- **Three separate ADRs, one field each.** Rejected: three cross-package boundary churns for fields that land in the same M12 prereq chain and the same interface. One additive change is auditable as a unit and minimizes consumer recompiles.
- **Required (non-optional) fields.** Rejected: breaks every existing registrant at the type level for no benefit — most commands ignore stdin/TTY/cancel. Optional is strictly back-compat.
- **Synchronous stdin reader.** Rejected: pipe RHS and interactive input are async; a sync reader would force buffer-everything-upfront and couldn't model a live terminal. (WASI's `onStdin` is sync only because the guest runs in its own realm with its own buffering — not applicable to the main-thread dispatcher.)
- **Custom cancellation token / boolean flag / throw-to-cancel.** Rejected in favor of `AbortSignal`: standard, composable, zero-dep, idiomatic. A polled boolean can't wake an awaiting command; throwing inverts control awkwardly.
- **`stdin` as a `ReadableStream`.** Rejected for the contract surface: heavier, locking-writer semantics, overkill for byte-chunk pull. A 2-method `StdinReader` is the minimal honest primitive; a stream adapter can wrap it later without a contract change.
- **Hard-kill the command on SIGINT.** Impossible/unsafe for a JS promise; cooperative abort lets a server flush/close. Job control is out of scope.
- **Put cancellation only on `RunOptions`, not `CommandContext`.** Rejected: `RunOptions.signal` is how the *host* triggers cancellation, but the *command* must observe it via `ctx.signal`. Both are needed (host-in, command-out).

## Consequences

- `@riftydev/shell` public surface grows by four optional fields + one exported `StdinReader` interface, and `RunOptions` gains an optional `signal`. No existing consumer needs to change; `npm-shell-command.ts` and builtins compile and behave identically.
- Unblocks the M12 prereq chain: `<` redirect and pipe RHS can construct a non-TTY child context with a `stdin` reader; stdin-filter coreutils (wc/sort/uniq/cut/tr/grep stdin modes) become buildable.
- Color correctness: once consumers gate SGR on `ctx.isTTY`, the redirect/pipe paths stop corrupting files/streams. Until then, no regression (today no builtin emits color).
- Long-running foreground processes (vite / `node http`) become expressible: `Shell.run` resolves on Ctrl+C instead of hanging, with the command observing `ctx.signal`. This is the foreground complement to the worker-lifecycle question Q-2026-06-05-317 — separate decisions (foreground dispatcher contract vs kernel worker teardown), kept decoupled.
- New obligation: any command that reads `ctx.stdin` when it is `undefined` must error cleanly (no silent stub).
- The shell now allocates an `AbortController` per foreground run; negligible cost, and `run` must remove the abort listener on settle (no leak).

## Reversibility classification

**IRREVERSIBLE** — checklist item 1: touches the public API of `@riftydev/shell` (`CommandContext`/`RunOptions` + new `StdinReader`) consumed across package boundaries by `registerCommand` registrants. Recorded as an inline ratified ADR per ADR-0063, not OPEN_QUESTIONS.

## Acceptance

- [ ] `CommandContext` gains optional `stdin: StdinReader`, `isTTY: boolean`, `cols`/`rows: number`, `signal: AbortSignal`; `StdinReader` exported from `packages/shell/src/index.ts`.
- [ ] Existing registrants compile unchanged: `apps/playground/src/glue/npm-shell-command.ts`, all builtins, shell tests typecheck with zero edits (optional fields, no `any`).
- [ ] `stdin.read()` returns `Promise<Uint8Array | null>` with `null` = EOF, mirroring the WASI `onStdin` EOF convention.
- [ ] The `runSegment` redirect path (and any pipe RHS) constructs a context with `isTTY` falsy, so a hypothetical `--color=auto` command emits no SGR into a redirected file. (Test: `ls --color=auto > f` produces no `\x1b[` bytes in `f`.)
- [ ] `RunOptions` gains optional `signal`; firing it causes `Shell.run` to resolve (not hang) even when the handler never returns on its own, yielding exit code `130`. (Unit: never-resolving command + aborting signal → `run` resolves `exitCode: 130`.)
- [ ] A command awaiting a long operation observes `ctx.signal` and returns early. (Unit: cancellable `sleep` returns `130` on abort.)
- [ ] Host wiring documented: `RiftyTerminal.onSignal('SIGINT')` → `controller.abort()` of the current `run`'s controller; no `RiftyTerminalOptions` change.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm check:deps` pass; no new circular deps; no new external dependency.
- [ ] CHANGELOG updated in `packages/shell`; relationship to Q-2026-06-05-317 noted as a complementary, separate kernel decision (not subsumed).
