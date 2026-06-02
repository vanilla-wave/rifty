# @rifty/shell

A tiny bash-flavoured shell for [rifty](https://github.com/vanilla-wave/rifty),
backed by [`@rifty/vfs`](../vfs). It parses a command line and runs a small set of
built-ins against a virtual filesystem; higher-level commands (`npm install`,
`npm run`, …) plug in via `registerCommand`, so the shell stays free of
upper-layer dependencies. Isomorphic — no DOM, no UI framework.

## Install

```bash
npm install @rifty/shell      # or: npm install rifty  →  import from 'rifty/shell'
```

## Usage

```ts
import { Shell } from '@rifty/shell';

const sh = new Shell({ cwd: '/proj' }); // backed by its own in-memory VFS mirror
const result = await sh.run('mkdir -p src && echo "hi" > src/a.txt && cat src/a.txt && ls src');

console.log(result.exitCode); // 0
console.log(result.stdout);   // "hi\na.txt\n"
```

Stream output live (e.g. to a terminal) with `onChunk`:

```ts
await sh.run('ls -la', { onChunk: (chunk, stream) => terminal.write(chunk, stream) });
```

Register a custom command — `(args, ctx) => Promise<exitCode>`:

```ts
sh.registerCommand('hello', async (args, ctx) => {
  ctx.stdout.write(`hello ${args[1] ?? 'world'}\n`);
  return 0;
});
await sh.run('hello rifty'); // stdout: "hello rifty\n"
```

## API

- **`Shell`** — `new Shell({ cwd?, env? })`. Built-ins over the VFS (`cd`, `pwd`,
  `mkdir`, `ls`, `cat`, `echo`, `rm`, …), `&&` chaining, and `> file`
  redirection. `run(line, { onChunk? })` → `Promise<RunResult>` (`{ exitCode,
  stdout, stderr }`). `registerCommand(name, fn)` adds your own.
- **`tokenize(line)`** — split a command line into argv-style tokens.
- Types: `ShellOptions`, `RunOptions`, `RunResult`, `ChunkStream`,
  `CommandContext`, `ShellCommand`, `Writer`.

See the [repo README](https://github.com/vanilla-wave/rifty#readme) and
[`examples/standalone-usage`](https://github.com/vanilla-wave/rifty/tree/main/examples/standalone-usage)
(`src/04-shell.ts`) for a runnable example.

## License

MIT
