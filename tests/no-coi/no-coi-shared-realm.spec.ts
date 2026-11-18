import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';

// No-COI project commands run every `node` in one reused toolchain realm
// (ADR-0418 §5); Node starts each process in a fresh one.
//
// (a) Node v24.16.0 lib/internal/process/execution.js runScriptInContext (via
// evalScript) defines `[eval]`'s module, exports, __dirname, require (in the
// `[eval]-wrapper`) and __filename on globalThis. They die with that process:
// a later `node` sees none of them, and a guest value an earlier command left
// under one of those names is still there after the eval process ends. A
// `node` also never sees rifty's console `require` (runtime-js worker-entry.ts):
// a Node process has no global `require`. A binding the realm cannot return (a
// guest made it non-configurable) fails the command loudly and replaces the
// Worker, so the next `node` is fresh again.
// (b) What else an earlier command leaves in the realm, measured against live
// Node. Declared persisting state (compat process.md, "Shared realm across
// no-COI `node` invocations"): rifty prints exactly the declared value and Node
// does not, so any other output or a fix fails until the declaration changes.
// Everything else must match Node.

const ROOT = '/shared-realm';
const NAMES = ['require', 'module', 'exports', '__filename', '__dirname'] as const;

interface Step {
  /** Native argv after the Node executable. */
  readonly argv: readonly string[];
  /** The same process as a project command line. */
  readonly line: string;
  /** Stop the command once its stdout carries this marker (native: SIGINT). */
  readonly stopAfter?: string;
}

interface NativeRun {
  readonly code: number | null;
  readonly stdout: string;
}

interface RiftyRun {
  readonly status: string;
  readonly exitCode: number | null;
  readonly worker: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

// One row per name: its type and, for an object/function, its own enumerable keys.
const typeofRows = `for (const name of ${JSON.stringify(NAMES)}) {
  const value = globalThis[name];
  const keys = typeof value === 'function' || (typeof value === 'object' && value !== null)
    ? Object.keys(value).sort().join(',') : '';
  console.log('L|' + name + ' ' + typeof value + ':' + keys);
}
`;
// Guest values for every eval binding name, with distinct descriptor shapes.
const setGuest = `const moduleGetter = () => 'guest-module';
globalThis.__guestModuleGetter = moduleGetter;
Object.defineProperty(globalThis, 'require', { value: 'guest-require', writable: false, enumerable: false, configurable: true });
Object.defineProperty(globalThis, 'module', { get: moduleGetter, enumerable: true, configurable: true });
globalThis.exports = 'guest-exports';
Object.defineProperty(globalThis, '__filename', { value: 'guest-filename', writable: true, enumerable: false, configurable: true });
Object.defineProperty(globalThis, '__dirname', { value: 'guest-dirname', writable: false, enumerable: true, configurable: true });
`;
const getGuest = `for (const name of ${JSON.stringify(NAMES)}) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  const shape = d === undefined ? 'absent' : 'get' in d
    ? 'accessor ' + (d.get === globalThis.__guestModuleGetter) + ' ' + typeof d.set
    : 'data ' + JSON.stringify(d.value) + ' ' + d.writable;
  console.log('L|' + name + ' ' + shape + ' ' + (d && d.enumerable) + ' ' + (d && d.configurable));
}
`;

const files: Readonly<Record<string, string>> = {
  'later.mjs': typeofRows,
  'frozen-guest.mjs':
    "Object.defineProperty(globalThis, '__dirname', { value: 'frozen', writable: false, configurable: false });\n",
  'later.cjs': typeofRows,
  'set-guest.mjs': setGuest,
  'get-guest.mjs': getGuest,
  // Oracle for "unchanged": what get-guest reads right after set-guest in one realm.
  'guest-oracle.mjs': "import './set-guest.mjs';\nimport './get-guest.mjs';\n",
  'counter.cjs': 'let n = 0;\nmodule.exports = { inc: () => ++n };\n',
  'counter.mjs': 'let n = 0;\nexport const inc = () => ++n;\n',
  'set-state.cjs': `globalThis.__sharedGlobal = 42;
const fs = require('node:fs');
fs.__sharedProp = 'set';
const readFile = fs.readFile;
fs.readFile = function patchedReadFile(...args) { return readFile.apply(this, args); };
require('node:module').__sharedProp = 'set';
Array.prototype.__sharedProto = 1;
process.__sharedProp = 1;
process.env.SHARED_ENV = '1';
process.on('exit', () => console.log('L|stale-exit-listener'));
process.on('sharedEvent', () => {});
process.stdout.on('sharedEvent', () => {});
require('node:events').defaultMaxListeners = 77;
require('node:diagnostics_channel').subscribe('shared-channel', () => console.log('L|staleChannelSubscriber ran'));
setInterval(() => console.log('L|stale-timer'), 5).unref();
require('./counter.cjs').inc();
`,
  'set-state.mjs': "import { inc } from './counter.mjs';\ninc();\n",
  'get-state.cjs': `const fs = require('node:fs');
const cached = Object.keys(require.cache).some((id) => id.endsWith('counter.cjs'));
const rows = {
  guestGlobal: typeof globalThis.__sharedGlobal,
  evalVar: typeof globalThis.__sharedVar,
  builtinProp: typeof fs.__sharedProp,
  builtinMethod: fs.readFile.name,
  moduleBuiltinProp: typeof require('node:module').__sharedProp,
  intrinsic: typeof [].__sharedProto,
  processProp: typeof process.__sharedProp,
  builtinState: require('node:events').defaultMaxListeners,
  channelSubscriber: require('node:diagnostics_channel').hasSubscribers('shared-channel'),
  consoleRequire: typeof globalThis.require,
  consoleImport: typeof globalThis.__riftyImport,
  riftyNamespace: typeof globalThis.__rifty,
  env: typeof process.env.SHARED_ENV,
  processListeners: process.listenerCount('exit') + process.listenerCount('sharedEvent'),
  stdioListeners: process.stdout.listenerCount('sharedEvent'),
  requireCache: cached,
  cjsCounter: require('./counter.cjs').inc(),
};
require('node:diagnostics_channel').channel('shared-channel').publish('ping');
// Leave time for a leaked 5 ms interval to print.
setTimeout(() => { for (const [k, v] of Object.entries(rows)) console.log('L|' + k + ' ' + v); }, 50);
`,
  'get-state.mjs': `import fs from 'node:fs';
import { inc } from './counter.mjs';
console.log('L|esmBuiltinMethod ' + fs.readFile.name);
console.log('L|esmCounter ' + inc());
`,
};

const STOP_SOURCE =
  "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000); console.log('L|ready')";
const LATE_BINDINGS = NAMES.filter((name) => name !== 'module')
  .map((name) => `typeof ${name}`)
  .join(', ');
const LATE_SOURCE = `setTimeout(() => { console.log('L|timer', ${LATE_BINDINGS}); console.log('L|timer-module', typeof module); }, 10); process.on('exit', () => { console.log('L|exit', ${LATE_BINDINGS}); console.log('L|exit-module', typeof module); })`;

/** Eval sources avoid `"`, `$`, backslash and backtick so one shell line carries them. */
function evalStep(flag: '-e' | '-p', source: string, stopAfter?: string): Step {
  return {
    argv: [flag, source],
    line: `node ${flag} "${source}"`,
    ...(stopAfter === undefined ? {} : { stopAfter }),
  };
}

const file = (name: string): Step => ({ argv: [name], line: `node ${name}` });

interface EvalMode {
  readonly name: string;
  readonly step: Step;
  /** Rifty's declared line for an eval-step row that differs from Node, keyed by row tag. */
  readonly residual?: Readonly<Record<string, string>>;
}

const evalModes: readonly EvalMode[] = [
  { name: 'eval', step: evalStep('-e', '1') },
  { name: 'print', step: evalStep('-p', '1') },
  { name: 'eval-throw', step: evalStep('-e', "throw new Error('boom')") },
  { name: 'eval-exit', step: evalStep('-e', 'process.exit(3)') },
  { name: 'eval-stop', step: evalStep('-e', STOP_SOURCE, 'L|ready') },
  // The bindings live until the process ends: a timer and an 'exit' listener read them.
  // Residual: after the synchronous part Node reads `module` as the builtin
  // (eval_string.js addBuiltinLibsToObject, then runScriptInContext restores
  // origModule); rifty's `-e` installs no builtin-module globals.
  {
    name: 'eval-late',
    step: evalStep('-e', LATE_SOURCE),
    residual: {
      'L|timer-module': 'L|timer-module object',
      'L|exit-module': 'L|exit-module object',
    },
  },
];

async function runNative(dir: string, step: Step): Promise<NativeRun> {
  return await new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['FORCE_COLOR', 'NO_COLOR', 'NODE_OPTIONS']) delete env[key];
    const child = spawn(process.execPath, [...step.argv], { cwd: dir, env });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (step.stopAfter !== undefined && stdout.includes(step.stopAfter)) child.kill('SIGINT');
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

async function nativeOracle(steps: readonly Step[]): Promise<NativeRun[]> {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-shared-realm-'));
  try {
    for (const [path, content] of Object.entries(files)) await writeFile(join(dir, path), content);
    const runs: NativeRun[] = [];
    for (const step of steps) runs.push(await runNative(dir, step));
    return runs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRifty(
  page: import('@playwright/test').Page,
  steps: readonly Step[],
): Promise<RiftyRun[]> {
  await page.goto('/no-coi-harness.html');
  return await page.evaluate(
    async ({ root, projectRoot, files, steps }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        await sandbox.fs.writeFile(`${projectRoot}/.keep`, '');
        for (const [path, content] of Object.entries(files)) {
          await sandbox.fs.writeFile(`${projectRoot}/${path}`, content);
        }
        const project = sandbox.project({ root: projectRoot });
        const runs = [];
        for (const step of steps) {
          const run = project.run(step.line);
          if (step.stopAfter !== undefined) {
            const marker = step.stopAfter;
            let seen = '';
            await Promise.race([
              new Promise<void>((resolve) => {
                run.onOutput(({ chunk }: { chunk: string }) => {
                  seen += chunk;
                  if (seen.includes(marker)) resolve();
                });
              }),
              run.completion,
            ]);
            await run.stop();
          }
          const done = await run.completion;
          runs.push({
            status: done.status,
            exitCode: done.exitCode,
            worker: done.worker,
            stdout: done.stdout,
            stderr: done.stderr,
            error: done.error?.message ?? null,
          });
        }
        return runs;
      } finally {
        sandbox.dispose();
      }
    },
    { root: process.cwd().replaceAll('\\', '/'), projectRoot: ROOT, files, steps },
  );
}

const rows = (stdout: string): string[] =>
  stripVTControlCharacters(stdout)
    .split('\n')
    .filter((line) => line.startsWith('L|') || /^\d+$/u.test(line));

function expectSameRealm(runs: readonly RiftyRun[], label: string): void {
  // A replaced Worker would make every later check vacuous.
  expect(
    runs.map((run) => run.worker),
    label,
  ).toEqual(runs.map(() => 'retained'));
}

function expectSameStatus(rifty: RiftyRun, native: NativeRun, step: Step, label: string): void {
  if (step.stopAfter !== undefined) {
    // A stopped command's status is the Shell's SIGINT 130 (not this seam).
    expect(rifty.status, label).toBe('cancelled');
    return;
  }
  expect({ status: rifty.status, exitCode: rifty.exitCode }, `${label}\n${rifty.stderr}`).toEqual({
    status: 'exited',
    exitCode: native.code,
  });
}

const tagOf = (line: string): string => line.split(' ')[0] ?? line;

for (const mode of evalModes) {
  test(`${mode.name}: a later node sees none of the [eval] bindings`, async ({ page }) => {
    test.setTimeout(120_000);
    const steps = [mode.step, file('later.mjs'), file('later.cjs')];
    const native = await nativeOracle(steps);
    const rifty = await runRifty(page, steps);
    const label = `${mode.name} vs Node ${process.version}\n${JSON.stringify({ native, rifty }, null, 2)}`;
    expectSameRealm(rifty, label);
    const residual = mode.residual ?? {};
    steps.forEach((step, index) => {
      expectSameStatus(rifty[index]!, native[index]!, step, label);
      const expected = rows(native[index]!.stdout).map((line) => residual[tagOf(line)] ?? line);
      expect(rows(rifty[index]!.stdout), `${label}\nstep ${step.line}`).toEqual(expected);
    });
    const nodeRows = native.flatMap((run) => rows(run.stdout));
    for (const [tag, line] of Object.entries(residual)) {
      expect(nodeRows.map(tagOf), `${label}\nNode prints ${tag}`).toContain(tag);
      expect(nodeRows, `${label}\nNode now prints the declared ${line}`).not.toContain(line);
    }
  });

  if (mode.name === 'eval-late') continue;
  test(`${mode.name}: a guest value under an [eval] binding name survives unchanged`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const steps = [file('set-guest.mjs'), mode.step, file('get-guest.mjs')];
    const [oracle, evalRun] = await nativeOracle([file('guest-oracle.mjs'), mode.step]);
    const rifty = await runRifty(page, steps);
    const label = `${mode.name} vs Node ${process.version}\n${JSON.stringify({ oracle, evalRun, rifty }, null, 2)}`;
    expectSameRealm(rifty, label);
    expectSameStatus(rifty[1]!, evalRun!, mode.step, label);
    expect(rows(rifty[2]!.stdout), label).toEqual(rows(oracle!.stdout));
    expect(rows(oracle!.stdout), 'oracle reads the guest values').toHaveLength(NAMES.length);
  });
}

// Declared: rifty's value of each realm state a later `node` sees — what an
// earlier command left, and rifty's own `__riftyImport`/`__rifty` globals.
const SHARED: Readonly<Record<string, string>> = {
  guestGlobal: 'number',
  evalVar: 'number',
  builtinProp: 'string',
  builtinMethod: 'patchedReadFile',
  esmBuiltinMethod: 'patchedReadFile',
  moduleBuiltinProp: 'string',
  intrinsic: 'number',
  processProp: 'number',
  builtinState: '77',
  channelSubscriber: 'true',
  staleChannelSubscriber: 'ran',
  consoleImport: 'function',
  riftyNamespace: 'object',
};

test('declared shared realm: what an earlier node leaves for the next', async ({ page }) => {
  test.setTimeout(120_000);
  const steps = [
    file('set-state.cjs'),
    file('set-state.mjs'),
    evalStep('-e', 'var __sharedVar = 1'),
    file('get-state.cjs'),
    file('get-state.mjs'),
  ];
  const native = await nativeOracle(steps);
  const rifty = await runRifty(page, steps);
  const label = `vs Node ${process.version}\n${JSON.stringify({ native, rifty }, null, 2)}`;
  expectSameRealm(rifty, label);
  steps.forEach((step, index) => expectSameStatus(rifty[index]!, native[index]!, step, label));
  const later = (runs: ReadonlyArray<{ readonly stdout: string }>) =>
    runs.slice(3).flatMap((run) => rows(run.stdout));
  const fields = (lines: readonly string[]) =>
    Object.fromEntries(lines.map((line) => line.slice(2).split(' ') as [string, string]));
  const node = fields(later(native));
  const observed = fields(later(rifty));
  const compared = (shape: Record<string, string>) =>
    Object.fromEntries(Object.entries(shape).filter(([field]) => !(field in SHARED)));
  // Everything else as in Node (a leaked listener or timer prints an extra row).
  expect(compared(observed), label).toEqual(compared(node));
  for (const [field, value] of Object.entries(SHARED)) {
    expect(observed[field], `${label}\ndeclared shared ${field}`).toEqual(value);
    expect(node[field], `${label}\nNode now leaves the declared ${field}`).not.toEqual(value);
  }
});

// The eval makes its own `__dirname` non-configurable: the realm cannot return it.
const UNRESTORABLE = evalStep(
  '-e',
  "Object.defineProperty(globalThis, '__dirname', { configurable: false })",
);

test('an [eval] binding the realm cannot restore fails loudly and replaces the Worker', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const steps = [file('set-guest.mjs'), UNRESTORABLE, file('get-guest.mjs'), file('later.mjs')];
  const native = await nativeOracle(steps);
  const rifty = await runRifty(page, steps);
  const label = `vs Node ${process.version}\n${JSON.stringify({ native, rifty }, null, 2)}`;
  // Declared degradation: Node's process exits 0; rifty names the binding and replaces the realm.
  expect(native[1]!.code, label).toBe(0);
  const failed = rifty[1]!;
  expect(
    { status: failed.status, exitCode: failed.exitCode, worker: failed.worker },
    label,
  ).toEqual({ status: 'failed', exitCode: null, worker: 'replaced' });
  expect(failed.error, label).toContain('globalThis.__dirname');
  // The next `node` is fresh, as every Node process is.
  for (const index of [2, 3]) {
    expect(rifty[index]!.worker, label).toBe('retained');
    expectSameStatus(rifty[index]!, native[index]!, steps[index]!, label);
    expect(rows(rifty[index]!.stdout), label).toEqual(rows(native[index]!.stdout));
  }
});

// Declared: a non-configurable guest global an earlier command left under an
// [eval] name makes a later `-e` throw (Node's wrapper assigns, never defines).
test('a non-configurable guest global under an [eval] name fails a later eval loudly', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const steps = [file('frozen-guest.mjs'), evalStep('-e', '1'), file('later.mjs')];
  const native = await nativeOracle(steps);
  const rifty = await runRifty(page, steps);
  const label = `vs Node ${process.version}\n${JSON.stringify({ native, rifty }, null, 2)}`;
  expectSameRealm(rifty, label);
  expect(native[1]!.code, label).toBe(0);
  expect({ status: rifty[1]!.status, exitCode: rifty[1]!.exitCode }, label).toEqual({
    status: 'exited',
    exitCode: 1,
  });
  expect(rifty[1]!.stderr, label).toContain('TypeError: Cannot redefine property: __dirname');
  // The guest value persists (declared shared realm); the eval's other bindings do not.
  expect(rows(rifty[2]!.stdout), label).toEqual(
    rows(native[2]!.stdout).map((line) =>
      line.startsWith('L|__dirname ') ? 'L|__dirname string:' : line,
    ),
  );
});
