# Node v24.16.0 CLI eval probe

Reference host: Node v24.16.0, Darwin arm64, 2026-07-30. Paths below normalize
the executable to `<node>` and the repository cwd to `<cwd>`.

Run from the repository root:

```sh
node -v
node -e "console.log(JSON.stringify({argv:process.argv,execArgv:process.execArgv}))" alpha "two words"
node --eval="console.log(JSON.stringify({argv:process.argv,execArgv:process.execArgv}))" alpha
node -p "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node --print=ignored "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node --print=not-the-source "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node --print= "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node -pe "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node -pe
node -p
node --print
node -e
node --eval=
node -ep "1"
node '-eSRC'
node '-e=SRC'
node '-pSRC'
node '-p=SRC'
node '-peSRC'
node '-pe=SRC'
node '-epSRC'
node '-ep=SRC'
```

Normalized stdout/status:

```text
v24.16.0
{"argv":["<node>","alpha","two words"],"execArgv":["-e","<source>"]}       # 0
{"argv":["<node>","alpha"],"execArgv":["--eval=<source>"]}                # 0
{"argv":["<node>","alpha"],"execArgv":["-p","<source>"]}                  # 0
{"argv":["<node>","alpha"],"execArgv":["--print=ignored","<source>"]}     # 0
{"argv":["<node>","alpha"],"execArgv":["--print=not-the-source","<source>"]} # 0
{"argv":["<node>","alpha"],"execArgv":["--print=","<source>"]}            # 0
{"argv":["<node>","alpha"],"execArgv":["-pe","<source>"]}                 # 0
node: --eval requires an argument                                        # 9
undefined                                                               # 0
undefined                                                               # 0
node: -e requires an argument                                            # 9
node: --eval= requires an argument                                       # 9
node: bad option: -ep                                                    # 9
node: bad option: -eSRC                                                  # 9
node: bad option: -e=SRC                                                 # 9
node: bad option: -pSRC                                                  # 9
node: bad option: -p=SRC                                                 # 9
node: bad option: -peSRC                                                 # 9
node: bad option: -pe=SRC                                                # 9
node: bad option: -epSRC                                                 # 9
node: bad option: -ep=SRC                                                # 9
```

`--print=<rhs>` is a boolean option spelling: the RHS is ignored and the next
argument is source. Missing plain `-p`/`--print` source evaluates `undefined`;
bare `-pe`, missing `-e`, and empty `--eval=` are usage errors. `--`
immediately after source is consumed; later arguments, including
option-looking ones, are script arguments. `-pe <source>` is accepted; `-ep`,
and every attached short-option source spelling in the matrix above are bad
options.

Separated empty tokens are not missing arguments. Run:

```sh
node -e ''
node --eval ''
node -pe ''
node -p ''
node --print ''
node --print=ignored ''
node --print=not-the-source ''
node --print= ''
```

Exact normalized status/stdout/stderr:

| argv | status | stdout | stderr |
|---|---:|---|---|
| `-e` | 9 | empty | `<node>: -e requires an argument\n` |
| `-e ''` | 0 | empty | empty |
| `--eval` | 9 | empty | `<node>: --eval requires an argument\n` |
| `--eval ''` | 0 | empty | empty |
| `-pe` | 9 | empty | `<node>: --eval requires an argument\n` |
| `-pe ''` | 0 | `undefined\n` | empty |
| `-p` | 0 | `undefined\n` | empty |
| `-p ''` | 0 | `undefined\n` | empty |
| `--print` | 0 | `undefined\n` | empty |
| `--print ''` | 0 | `undefined\n` | empty |
| `--print=ignored` | 0 | `undefined\n` | empty |
| `--print=ignored ''` | 0 | `undefined\n` | empty |
| `--print=not-the-source` | 0 | `undefined\n` | empty |
| `--print=not-the-source ''` | 0 | `undefined\n` | empty |
| `--print=` | 0 | `undefined\n` | empty |
| `--print= ''` | 0 | `undefined\n` | empty |

The mandatory-source eval forms consume the empty token into `process.execArgv`.
The optional-source print forms leave it in `process.argv`, distinct from the
otherwise output-equivalent bare print invocation. This preload probe exposes
that identity without changing the eval source:

```sh
probe='--import=data:text/javascript,console.log(JSON.stringify(%7BexecArgv%3Aprocess.execArgv%2Cargv%3Aprocess.argv.slice(1)%7D))'
NODE_OPTIONS="$probe" node -e ''
NODE_OPTIONS="$probe" node --eval ''
NODE_OPTIONS="$probe" node -pe ''
NODE_OPTIONS="$probe" node -p
NODE_OPTIONS="$probe" node -p ''
NODE_OPTIONS="$probe" node --print
NODE_OPTIONS="$probe" node --print ''
NODE_OPTIONS="$probe" node --print=ignored
NODE_OPTIONS="$probe" node --print=ignored ''
NODE_OPTIONS="$probe" node --print=not-the-source
NODE_OPTIONS="$probe" node --print=not-the-source ''
NODE_OPTIONS="$probe" node --print=
NODE_OPTIONS="$probe" node --print= ''
```

Exact normalized stdout:

```text
{"execArgv":["-e",""],"argv":[]}
{"execArgv":["--eval",""],"argv":[]}
{"execArgv":["-pe",""],"argv":[]}
undefined
{"execArgv":["-p"],"argv":[]}
undefined
{"execArgv":["-p"],"argv":[""]}
undefined
{"execArgv":["--print"],"argv":[]}
undefined
{"execArgv":["--print"],"argv":[""]}
undefined
{"execArgv":["--print=ignored"],"argv":[]}
undefined
{"execArgv":["--print=ignored"],"argv":[""]}
undefined
{"execArgv":["--print=not-the-source"],"argv":[]}
undefined
{"execArgv":["--print=not-the-source"],"argv":[""]}
undefined
{"execArgv":["--print="],"argv":[]}
undefined
{"execArgv":["--print="],"argv":[""]}
undefined
```

The option terminator is part of the source grammar, not a uniform
post-source cleanup. Cross every separated spelling with missing, empty, and
nonempty source:

```sh
for option in -e --eval -pe -p --print --print=ignored --print=not-the-source --print=; do
  NODE_OPTIONS="$probe" node "$option" --
  NODE_OPTIONS="$probe" node "$option" '' -- x
  NODE_OPTIONS="$probe" node "$option" 42 -- x
done
```

The preload JSON line exposes `execArgv` and `argv`; `result` is any following
eval/print output. These are the exact normalized rows:

| option | source state | raw argv after option | status | `execArgv` | `argv` | result / stderr |
|---|---|---|---:|---|---|---|
| `-e` | missing | `--` | 9 | n/a | n/a | `<node>: -e requires an argument\n` |
| `-e` | empty | `'' -- x` | 0 | `["-e",""]` | `["x"]` | empty |
| `-e` | nonempty | `42 -- x` | 0 | `["-e","42"]` | `["x"]` | empty |
| `--eval` | missing | `--` | 9 | n/a | n/a | `<node>: --eval requires an argument\n` |
| `--eval` | empty | `'' -- x` | 0 | `["--eval",""]` | `["x"]` | empty |
| `--eval` | nonempty | `42 -- x` | 0 | `["--eval","42"]` | `["x"]` | empty |
| `-pe` | missing | `--` | 9 | n/a | n/a | `<node>: --eval requires an argument\n` |
| `-pe` | empty | `'' -- x` | 0 | `["-pe",""]` | `["x"]` | `undefined\n` |
| `-pe` | nonempty | `42 -- x` | 0 | `["-pe","42"]` | `["x"]` | `42\n` |
| `-p` | missing | `--` | 0 | `["-p"]` | `[]` | `undefined\n` |
| `-p` | empty | `'' -- x` | 0 | `["-p"]` | `["","--","x"]` | `undefined\n` |
| `-p` | nonempty | `42 -- x` | 0 | `["-p","42"]` | `["x"]` | `42\n` |
| `--print` | missing | `--` | 0 | `["--print"]` | `[]` | `undefined\n` |
| `--print` | empty | `'' -- x` | 0 | `["--print"]` | `["","--","x"]` | `undefined\n` |
| `--print` | nonempty | `42 -- x` | 0 | `["--print","42"]` | `["x"]` | `42\n` |
| `--print=ignored` | missing | `--` | 0 | `["--print=ignored"]` | `[]` | `undefined\n` |
| `--print=ignored` | empty | `'' -- x` | 0 | `["--print=ignored"]` | `["","--","x"]` | `undefined\n` |
| `--print=ignored` | nonempty | `42 -- x` | 0 | `["--print=ignored","42"]` | `["x"]` | `42\n` |
| `--print=not-the-source` | missing | `--` | 0 | `["--print=not-the-source"]` | `[]` | `undefined\n` |
| `--print=not-the-source` | empty | `'' -- x` | 0 | `["--print=not-the-source"]` | `["","--","x"]` | `undefined\n` |
| `--print=not-the-source` | nonempty | `42 -- x` | 0 | `["--print=not-the-source","42"]` | `["x"]` | `42\n` |
| `--print=` | missing | `--` | 0 | `["--print="]` | `[]` | `undefined\n` |
| `--print=` | empty | `'' -- x` | 0 | `["--print="]` | `["","--","x"]` | `undefined\n` |
| `--print=` | nonempty | `42 -- x` | 0 | `["--print=","42"]` | `["x"]` | `42\n` |

Thus a mandatory form rejects `--` as a missing source but consumes a
separated empty token and the following terminator. An optional form consumes
`--` as a missing-source terminator, while a preceding empty token ends option
parsing and preserves both that token and the later `--` in `process.argv`.
`node -p -- x` instead selects `x` as a program entry and is outside the eval
carrier.

The optional-print program boundary is reproducible against the repository's
existing CommonJS config entry:

```sh
probe='--import=data:text/javascript,console.log(JSON.stringify(%7BexecArgv%3Aprocess.execArgv%2Cargv%3Aprocess.argv.slice(1)%7D))'
for option in -p --print --print=ignored --print=not-the-source --print=; do
  NODE_OPTIONS="$probe" node "$option" -- .dependency-cruiser.cjs alpha "two words" -x
done
NODE_OPTIONS="$probe" node --print=not-the-source -- '' alpha -x
```

Normalized output:

```text
{"execArgv":["-p"],"argv":["<cwd>/.dependency-cruiser.cjs","alpha","two words","-x"]}
{"execArgv":["--print"],"argv":["<cwd>/.dependency-cruiser.cjs","alpha","two words","-x"]}
{"execArgv":["--print=ignored"],"argv":["<cwd>/.dependency-cruiser.cjs","alpha","two words","-x"]}
{"execArgv":["--print=not-the-source"],"argv":["<cwd>/.dependency-cruiser.cjs","alpha","two words","-x"]}
{"execArgv":["--print="],"argv":["<cwd>/.dependency-cruiser.cjs","alpha","two words","-x"]}
{"execArgv":["--print=not-the-source"],"argv":["","alpha","-x"]}
undefined
```

The nonempty post-terminator token is a program entry and retains the exact
print option in `execArgv`; an empty first token keeps entryless eval and is
not skipped in search of a later program.

Run the identity and resolver probe from a cwd containing `marker.cjs`:

```sh
node -e "console.log(JSON.stringify({filename:__filename,dirname:__dirname,module:{id:module.id,filename:module.filename,path:module.path,paths:module.paths,parent:module.parent,loaded:module.loaded},requireMain:require.main,mainModule:process.mainModule,thisGlobal:this===globalThis,argumentsType:typeof arguments,cached:Object.values(require.cache).includes(module),resolved:require.resolve('./marker.cjs'),marker:require('./marker.cjs')}))"
```

Normalized result:

```json
{
  "filename": "[eval]",
  "dirname": ".",
  "module": {
    "id": "[eval]",
    "filename": "<cwd>/[eval]",
    "path": ".",
    "paths": ["<cwd>/node_modules", "<cwd-parent>/node_modules", "...", "/node_modules"],
    "loaded": false
  },
  "thisGlobal": true,
  "argumentsType": "undefined",
  "cached": false,
  "resolved": "<cwd>/marker.cjs",
  "marker": "<fixture-value>"
}
```

`module.parent`, `require.main`, and `process.mainModule` are `undefined` and
therefore omitted by JSON. Relative and package resolution stay anchored to the
launch cwd after `process.chdir()`. A required child points back to the
detached eval module, but `[eval]` never appears in `require.cache`.

Eval also exposes five own global CommonJS data bindings with exact values and
flags:

```sh
node -e 'const values={require,module,exports:module.exports,__filename:"[eval]",__dirname:"."};const descriptors=Object.fromEntries(Object.keys(values).map(name=>{const d=Object.getOwnPropertyDescriptor(globalThis,name);return [name,{valueIdentity:d?.value===values[name],writable:d?.writable,enumerable:d?.enumerable,configurable:d?.configurable}]}));console.log(JSON.stringify({descriptors,exportsModuleIdentity:exports===module.exports}))'
```

Every `require`, `module`, `exports`, `__filename`, and `__dirname` row reports
`valueIdentity`, `writable`, `enumerable`, and `configurable` as `true`;
`exportsModuleIdentity` is also `true`.

This retained probe makes the sequential/concurrent isolation claim
reproducible. Extract and run it from the repository root:

```sh
probe_dir="$(mktemp -d)"
awk '/^```cjs oracle-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md \
  > "$probe_dir/probe.cjs"
node "$probe_dir/probe.cjs"
```

```cjs oracle-probe
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'rifty-node-eval-oracle-')));
const source = String.raw`
const child = require('./marker.cjs');
console.log(JSON.stringify({
  argv: process.argv,
  execArgv: [process.execArgv[0], process.execArgv.length],
  filename: __filename,
  dirname: __dirname,
  module: {
    id: module.id,
    filename: module.filename,
    path: module.path,
    paths: module.paths,
    parent: module.parent ?? null,
    loaded: module.loaded,
  },
  requireMain: require.main ?? null,
  mainModule: process.mainModule ?? null,
  thisGlobal: this === globalThis,
  argumentsType: typeof arguments,
  cached: Object.values(require.cache).includes(module),
  resolved: require.resolve('./marker.cjs'),
  child,
}));
`;

for (const name of ['a', 'b']) {
  const cwd = join(root, name);
  mkdirSync(cwd);
  writeFileSync(
    join(cwd, 'marker.cjs'),
    `module.exports={marker:'${name}',parentId:module.parent?.id,parentFilename:module.parent?.filename}\n`,
  );
}

function run(name) {
  return new Promise((resolve, reject) => {
    const cwd = join(root, name);
    const child = spawn(process.execPath, ['-e', source, name], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({
        status,
        stderr,
        value: JSON.parse(stdout),
      });
    });
  });
}

function normalize(value) {
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(process.execPath, '<node>')
      .replaceAll(root, '<fixture>'),
  );
}

function project(name, result) {
  const value = result.value;
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(value.argv, [process.execPath, name]);
  assert.deepEqual(value.execArgv, ['-e', 2]);
  assert.equal(value.filename, '[eval]');
  assert.equal(value.dirname, '.');
  assert.deepEqual(
    value.module,
    {
      id: '[eval]',
      filename: join(root, name, '[eval]'),
      path: '.',
      paths: value.module.paths,
      parent: null,
      loaded: false,
    },
  );
  assert.equal(value.module.paths[0], join(root, name, 'node_modules'));
  assert.equal(value.requireMain, null);
  assert.equal(value.mainModule, null);
  assert.equal(value.thisGlobal, true);
  assert.equal(value.argumentsType, 'undefined');
  assert.equal(value.cached, false);
  assert.equal(value.resolved, join(root, name, 'marker.cjs'));
  assert.deepEqual(value.child, {
    marker: name,
    parentId: '[eval]',
    parentFilename: join(root, name, '[eval]'),
  });
  const expectedModulePaths = [];
  let current = join(root, name);
  for (;;) {
    expectedModulePaths.push(join(current, 'node_modules'));
    if (current === '/') break;
    current = dirname(current);
  }
  assert.deepEqual(value.module.paths, expectedModulePaths);
  return normalize({
    name,
    argv: value.argv,
    execArgv: value.execArgv,
    moduleFilename: value.module.filename,
    firstModulePath: value.module.paths[0],
    resolved: value.resolved,
    child: value.child,
    modulePathsExact: true,
  });
}

(async () => {
  try {
    const sequential = [
      project('a', await run('a')),
      project('b', await run('b')),
    ];
    const concurrentRaw = await Promise.all([run('a'), run('b')]);
    const concurrent = [
      project('a', concurrentRaw[0]),
      project('b', concurrentRaw[1]),
    ];
    assert.deepEqual(concurrent, sequential);
    console.log(JSON.stringify({ sequential, concurrentMatchesSequential: true }, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Captured output:

```json
{
  "sequential": [
    {
      "name": "a",
      "argv": [
        "<node>",
        "a"
      ],
      "execArgv": [
        "-e",
        2
      ],
      "moduleFilename": "<fixture>/a/[eval]",
      "firstModulePath": "<fixture>/a/node_modules",
      "resolved": "<fixture>/a/marker.cjs",
      "child": {
        "marker": "a",
        "parentId": "[eval]",
        "parentFilename": "<fixture>/a/[eval]"
      },
      "modulePathsExact": true
    },
    {
      "name": "b",
      "argv": [
        "<node>",
        "b"
      ],
      "execArgv": [
        "-e",
        2
      ],
      "moduleFilename": "<fixture>/b/[eval]",
      "firstModulePath": "<fixture>/b/node_modules",
      "resolved": "<fixture>/b/marker.cjs",
      "child": {
        "marker": "b",
        "parentId": "[eval]",
        "parentFilename": "<fixture>/b/[eval]"
      },
      "modulePathsExact": true
    }
  ],
  "concurrentMatchesSequential": true
}
```

The assertions also pin empty stderr/status 0, global-script identity,
undefined main/parent surfaces, false `loaded`/cache membership, and each
fixture's complete cwd-ancestor `module.paths` order.

The remaining negative, resolution, formatting, and lifecycle rows are
executable as one compact probe:

```sh
probe_dir="$(mktemp -d)"
awk '/^```cjs print-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md \
  > "$probe_dir/print-probe.cjs"
node "$probe_dir/print-probe.cjs"
```

```cjs print-probe
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = mkdtempSync(join(tmpdir(), 'rifty-node-eval-print-'));

function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return {
    ...result,
    stderr: result.stderr.replaceAll(process.execPath, 'node'),
  };
}

function runMerged(args) {
  const path = join(root, 'merged.log');
  const fd = openSync(path, 'w+');
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  return { status: result.status, output: readFileSync(path, 'utf8') };
}

try {
  const negative = [
    [['-pe'], 'node: --eval requires an argument\n'],
    [['-ep', '1'], 'node: bad option: -ep\n'],
    [['-e=1'], 'node: bad option: -e=1\n'],
    [['-p=1'], 'node: bad option: -p=1\n'],
  ].map(([args, expectedStderr]) => {
    const result = run(args);
    assert.equal(result.status, 9);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, expectedStderr);
    return { args, status: result.status, stderr: result.stderr.trim() };
  });

  const chdir = run([
    '-p',
    "const r=require.resolve('./package.json'); process.chdir('/'); require.resolve('./package.json')===r",
  ]);
  assert.deepEqual(
    { status: chdir.status, stdout: chdir.stdout, stderr: chdir.stderr },
    { status: 0, stdout: 'true\n', stderr: '' },
  );

  const terminatorSource =
    'console.log(JSON.stringify({argv:process.argv,execArgv:process.execArgv}))';
  const terminator = run(['-e', terminatorSource, '--', 'alpha', 'two words']);
  assert.equal(terminator.status, 0);
  assert.equal(terminator.stderr, '');
  assert.deepEqual(JSON.parse(terminator.stdout), {
    argv: [process.execPath, 'alpha', 'two words'],
    execArgv: ['-e', terminatorSource],
  });

  const print = [
    ["'hello'", 'hello\n'],
    ['undefined', 'undefined\n'],
    ['[1,"two"]', "[ 1, 'two' ]\n"],
    ['3n', '3n\n'],
    ['Promise.resolve(42)', 'Promise { 42 }\n'],
    ['new Promise(()=>{})', 'Promise { <pending> }\n'],
    ["const x={name:'root'}; x.self=x; x", "<ref *1> { name: 'root', self: [Circular *1] }\n"],
  ].map(([source, expectedStdout]) => {
    const result = run(['-p', source]);
    assert.deepEqual(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      { status: 0, stdout: expectedStdout, stderr: '' },
    );
    return { source, stdout: result.stdout.trimEnd() };
  });

  const exitCode = run(['-p', "process.exitCode=7; 'value'"]);
  assert.deepEqual(
    { status: exitCode.status, stdout: exitCode.stdout, stderr: exitCode.stderr },
    { status: 7, stdout: 'value\n', stderr: '' },
  );

  const handled = run([
    '-p',
    "const p=Promise.reject(new Error('boom')); p.catch(()=>{}); p",
  ]);
  assert.equal(handled.status, 0);
  assert.equal(handled.stderr, '');
  assert.match(handled.stdout, /^Promise \{\n  <rejected> Error: boom\n/u);

  const unhandled = runMerged(['-p', "Promise.reject(new Error('boom'))"]);
  assert.equal(unhandled.status, 1);
  const resultAt = unhandled.output.indexOf('Promise {');
  const failureMarker = unhandled.output.indexOf('\n[eval]:1\n');
  const failureAt = failureMarker < 0 ? -1 : failureMarker + 1;
  assert.ok(resultAt >= 0 && failureAt > resultAt);
  assert.match(
    unhandled.output.slice(failureAt),
    /^\[eval\]:1\nPromise\.reject\(new Error\('boom'\)\)\n {15}\^\n\nError: boom\n {4}at \[eval\]:1:16/u,
  );

  const topLevel = run(['-p', 'var riftyEvalProbe=7; globalThis.riftyEvalProbe']);
  assert.deepEqual(
    { status: topLevel.status, stdout: topLevel.stdout, stderr: topLevel.stderr },
    { status: 0, stdout: '7\n', stderr: '' },
  );
  const illegalReturn = run(['-e', 'return 1']);
  assert.equal(illegalReturn.status, 1);
  assert.match(
    illegalReturn.stderr,
    /^\[eval\]:1\nreturn 1\n\^\^\^\^\^\^\nReturn statement is not allowed here\n\nSyntaxError: Illegal return statement/u,
  );

  console.log(JSON.stringify({
    negative,
    postChdirResolution: true,
    optionTerminatorConsumed: true,
    print,
    processExitCode: { status: exitCode.status, stdout: exitCode.stdout.trim() },
    rejectedPromise: {
      handledStatus: handled.status,
      stdoutPrefix: handled.stdout.split('\n').slice(0, 2),
      unhandledStatus: unhandled.status,
      resultBeforeFailure: true,
      failurePrelude: unhandled.output.slice(failureAt).split('\n').slice(0, 6),
    },
    unwrappedScript: { globalVar: 7, illegalReturnStatus: illegalReturn.status },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

Captured output:

```json
{
  "negative": [
    {
      "args": [
        "-pe"
      ],
      "status": 9,
      "stderr": "node: --eval requires an argument"
    },
    {
      "args": [
        "-ep",
        "1"
      ],
      "status": 9,
      "stderr": "node: bad option: -ep"
    },
    {
      "args": [
        "-e=1"
      ],
      "status": 9,
      "stderr": "node: bad option: -e=1"
    },
    {
      "args": [
        "-p=1"
      ],
      "status": 9,
      "stderr": "node: bad option: -p=1"
    }
  ],
  "postChdirResolution": true,
  "optionTerminatorConsumed": true,
  "print": [
    {
      "source": "'hello'",
      "stdout": "hello"
    },
    {
      "source": "undefined",
      "stdout": "undefined"
    },
    {
      "source": "[1,\"two\"]",
      "stdout": "[ 1, 'two' ]"
    },
    {
      "source": "3n",
      "stdout": "3n"
    },
    {
      "source": "Promise.resolve(42)",
      "stdout": "Promise { 42 }"
    },
    {
      "source": "new Promise(()=>{})",
      "stdout": "Promise { <pending> }"
    },
    {
      "source": "const x={name:'root'}; x.self=x; x",
      "stdout": "<ref *1> { name: 'root', self: [Circular *1] }"
    }
  ],
  "processExitCode": {
    "status": 7,
    "stdout": "value"
  },
  "rejectedPromise": {
    "handledStatus": 0,
    "stdoutPrefix": [
      "Promise {",
      "  <rejected> Error: boom"
    ],
    "unhandledStatus": 1,
    "resultBeforeFailure": true,
    "failurePrelude": [
      "[eval]:1",
      "Promise.reject(new Error('boom'))",
      "               ^",
      "",
      "Error: boom",
      "    at [eval]:1:16"
    ]
  },
  "unwrappedScript": {
    "globalVar": 7,
    "illegalReturnStatus": 1
  }
}
```

Worker `execArgv` inheritance uses the trusted launch snapshot, including
recursively; mutating the public parent array does not change it. An explicit
override replaces the snapshot:

```sh
node -e "const {Worker}=require('node:worker_threads');const id=a=>a.map((v,i)=>i===1?'SOURCE':v);const trusted=id(process.execArgv);process.execArgv.length=0;const w=new Worker(\"const {parentPort}=require('node:worker_threads');const id=a=>a.map((v,i)=>i===1?'SOURCE':v);parentPort.postMessage(id(process.execArgv))\",{eval:true});w.once('message',child=>console.log(JSON.stringify({trusted,public:process.execArgv,child})))"
node -e "const {Worker}=require('node:worker_threads');const leaf=\"const {parentPort}=require('node:worker_threads');const id=a=>a.map((v,i)=>i===1?'SOURCE':v);parentPort.postMessage(id(process.execArgv))\";const middle=\"const {Worker,parentPort,workerData}=require('node:worker_threads');const id=a=>a.map((v,i)=>i===1?'SOURCE':v);const w=new Worker(workerData,{eval:true});w.once('message',child=>parentPort.postMessage({self:id(process.execArgv),child}))\";const w=new Worker(middle,{eval:true,workerData:leaf});w.once('message',x=>console.log(JSON.stringify(x)))"
node -e "const {Worker}=require('node:worker_threads');const w=new Worker(\"const {parentPort}=require('node:worker_threads');parentPort.postMessage(process.execArgv)\",{eval:true,execArgv:['--trace-warnings']});w.once('message',x=>console.log(JSON.stringify(x)))"
```

Exact normalized output on the pinned host:

```text
{"trusted":["-e","SOURCE"],"public":[],"child":["-e","SOURCE"]}
{"self":["-e","SOURCE"],"child":["-e","SOURCE"]}
["--trace-warnings"]
```

Print and lifecycle probes:

```sh
node -p "'hello'"
node -p "undefined"
node -p "({a:1})"
node -p "Promise.resolve(42)"
node -p "new Promise(()=>{})"
node -p "const x={name:'root'}; x.self=x; x"
node -p "const x={value:'before'}; setTimeout(()=>{x.value='after';console.log('TIMER')},0); x"
node -p "const p=new Promise(r=>setTimeout(()=>r(42),0)); p"
node -p "process.exit(7); 42"
node -p "setTimeout(()=>process.exit(7),0); 42"
node -p "setTimeout(()=>{throw new Error('later')},0); 42"
node -p "setTimeout(()=>Promise.reject(new Error('later rejection')),0); 42"
node -p "queueMicrotask(()=>process.exit(7)); 42"
node -p "queueMicrotask(()=>{throw new Error('microtask later')}); 42"
node -p "Promise.resolve().then(()=>{throw new Error('then later')}); 42"
node -p "queueMicrotask(()=>Promise.reject(new Error('microtask rejection'))); 42"
node -e "throw new Error('boom')"
node -e "const ="
```

Normalized output/status:

```text
hello                                                                  # 0
undefined                                                              # 0
{ a: 1 }                                                               # 0
Promise { 42 }                                                         # 0
Promise { <pending> }                                                  # 0
<ref *1> { name: 'root', self: [Circular *1] }                         # 0
TIMER
{ value: 'after' }                                                     # 0
Promise { 42 }                                                         # 0
                                                                        # 7
42                                                                     # 7
42
[eval]:1 ... Error: later ... at Timeout._onTimeout ([eval]:1:23)      # 1
42
[eval]:1 ... Error: later rejection ... at Timeout._onTimeout ([eval]:1:31) # 1
42                                                                     # 7
42
[eval]:1 ... Error: microtask later ... at [eval]:1:27                 # 1
42
[eval]:1 ... Error: then later ... at [eval]:1:35                      # 1
42
[eval]:1 ... Error: microtask rejection ... at [eval]:1:35             # 1
[eval]:1 ... Error: boom ... at [eval]:1:7                             # 1
[eval]:1 ... SyntaxError ...                                           # 1
```

The `-p` writer is console single-argument formatting, not unconditional
`util.inspect`: a top-level string is unquoted. Node registers its result
writer for `beforeExit` with `exit` fallback, so timer mutations and Promise
settlement precede output. `process.exit()` suppresses output only while initial
evaluation is still running, before that result callback exists. A delayed
exit prints first and retains N; a delayed throw or rejection prints first,
then emits its fatal diagnostic and exits 1. Immediate throw/syntax failures
still exit 1, while `process.exitCode=N` retains Node's exit contract.

The implementation mechanism is independently inspectable in the exact
installed Node:

```sh
node -e "const s=process.binding('natives')['internal/process/execution']; for (const n of ['function evalScript','function createModule','runScriptInContext','process.once(\\x27beforeExit\\x27']) console.log(n,s.includes(n))"
```

The source creates the `[eval]` module, runs a script in the current context,
captures the completion value, and installs the print callback on
`beforeExit`/`exit`. Repeating the identity command in two fixture cwd
directories sequentially and through two simultaneous child processes returns
each fixture's own marker, cwd, argv, stdout, and exit status; neither parent
nor sibling cache contains the synthetic module.

## Residual CLI contexts

This pinned probe separates the eval residuals instead of inferring them from
the CommonJS carrier. Run it from the repository root:

```sh
awk '/^```cjs residual-context-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md |
  node
```

```cjs residual-context-probe
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');

assert.equal(process.version, 'v24.16.0');

function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.signal, null);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function ok(result, stdout) {
  assert.deepEqual(result, { status: 0, stdout, stderr: '' });
  return { status: result.status, stdout: result.stdout };
}

function errorCode(result, code, message) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`\\[${code}\\]`));
  assert.ok(result.stderr.includes(message));
  return { status: result.status, code, message };
}

function usage(result, message) {
  assert.equal(result.status, 9);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.endsWith(`: ${message}\n`));
  return { status: result.status, message };
}

function syntaxError(result, message) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`SyntaxError: ${message}`));
  return { status: result.status, name: 'SyntaxError', message };
}

function loadOrResolveError(result, code, message) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(code));
  assert.ok(result.stderr.includes(message));
  return { status: result.status, code, message };
}

const esmEval = run([
  '--input-type=module',
  '-e',
  'console.log(await Promise.resolve("esm"))',
]);
const esmPrint = run(['--input-type=module', '-p', '42']);
const sourceTypeScript = run(['-p', 'const value: number = 42; value']);
const commonjsTypeScript = run([
  '--input-type=commonjs-typescript',
  '-p',
  'const value: number = 42; value',
]);
const moduleTypeScript = run([
  '--input-type=module-typescript',
  '-e',
  'console.log(await Promise.resolve(42 as number))',
]);
const moduleTypeScriptPrint = run([
  '--input-type=module-typescript',
  '-p',
  'const value: number = 42; value',
]);
const unsupportedTypeScript = run([
  '--input-type=module-typescript',
  '-e',
  'enum E { A }; console.log(E.A)',
]);
const requireLong = run([
  '--require=./package.json',
  '-p',
  "Boolean(require.cache[require.resolve('./package.json')])",
]);
const requireShort = run([
  '-r',
  './package.json',
  '-p',
  "Boolean(require.cache[require.resolve('./package.json')])",
]);
const importPreload = run([
  '--import=data:text/javascript,globalThis.riftyPreloaded=%22esm-preload%22',
  '-p',
  'globalThis.riftyPreloaded',
]);
const incompletePreloads = {
  omitted: {
    requireShort: usage(run(['-r']), '-r requires an argument'),
    requireLong: usage(run(['--require']), '--require requires an argument'),
    import: usage(run(['--import']), '--import requires an argument'),
  },
  inlineEmpty: {
    require: usage(run(['--require=']), '--require= requires an argument'),
    import: usage(run(['--import=']), '--import= requires an argument'),
  },
};
const separatedEmptyPreloads = {
  requireShort: loadOrResolveError(
    run(['-r', '']),
    'ERR_INVALID_ARG_VALUE',
    "The argument 'id' must be a non-empty string. Received ''",
  ),
  requireLong: loadOrResolveError(
    run(['--require', '']),
    'ERR_INVALID_ARG_VALUE',
    "The argument 'id' must be a non-empty string. Received ''",
  ),
  import: loadOrResolveError(
    run(['--import', '']),
    'ERR_MODULE_NOT_FOUND',
    'Cannot find package',
  ),
};
const explicitCommonjsIdentity = run([
  '--input-type=commonjs',
  '-p',
  'JSON.stringify({argv:[process.argv[0]===process.execPath,...process.argv.slice(1)],execArgv:process.execArgv,filename:__filename,dirname:__dirname})',
  'alpha',
]);
const explicitCommonjsTypeScript = run([
  '--input-type=commonjs',
  '-e',
  'const n: number = 1',
]);

const grammarRoot = mkdtempSync(join(tmpdir(), 'rifty-node-input-type-'));
const grammarEntry = join(grammarRoot, 'entry.cjs');
const preloadEntry = join(grammarRoot, 'preload-entry.cjs');
const requirePreload = join(grammarRoot, 'preload.cjs');
const importSpecifier =
  'data:text/javascript,globalThis.riftyEsmPreload%3D%22esm-program%22';
writeFileSync(
  grammarEntry,
  'console.log(JSON.stringify({execArgv:process.execArgv,argv:process.argv.slice(1)}))\n',
);
writeFileSync(
  preloadEntry,
  "console.log(JSON.stringify({entry:process.argv[1],execArgv:process.execArgv,cjs:globalThis.riftyCjsPreload??null,esm:globalThis.riftyEsmPreload??null}))\n",
);
writeFileSync(
  requirePreload,
  'globalThis.riftyCjsPreload="cjs-program"\n',
);

function programPreload(args, property, value, execArgv) {
  const result = run([...args, preloadEntry]);
  const observed = JSON.parse(ok(result, result.stdout).stdout);
  assert.equal(observed.entry, preloadEntry);
  assert.deepEqual(observed.execArgv, args);
  assert.equal(observed[property], value);
  return {
    status: result.status,
    execArgv,
    observed: `${property}:${value}`,
    entry: basename(observed.entry),
  };
}

const programPreloads = {
  requireShort: programPreload(
    ['-r', requirePreload],
    'cjs',
    'cjs-program',
    ['-r', '<specifier>'],
  ),
  requireLong: programPreload(
    ['--require', requirePreload],
    'cjs',
    'cjs-program',
    ['--require', '<specifier>'],
  ),
  requireInline: programPreload(
    [`--require=${requirePreload}`],
    'cjs',
    'cjs-program',
    ['--require=<specifier>'],
  ),
  import: programPreload(
    ['--import', importSpecifier],
    'esm',
    'esm-program',
    ['--import', '<specifier>'],
  ),
  importInline: programPreload(
    [`--import=${importSpecifier}`],
    'esm',
    'esm-program',
    ['--import=<specifier>'],
  ),
};

const optionalPrintSpellings = [
  '-p',
  '--print',
  '--print=ignored',
  '--print=not-the-source',
  '--print=',
];
const mandatoryEvalSpellings = [
  { option: '-e', usageMessage: '-e requires an argument', print: false },
  {
    option: '--eval',
    usageMessage: '--eval requires an argument',
    print: false,
  },
  {
    option: '-pe',
    usageMessage: '--eval requires an argument',
    print: true,
  },
];

function outcome(result) {
  if (result.code !== undefined) {
    return `${result.status}:${result.code}`;
  }
  if (result.message !== undefined) {
    return `${result.status}:${result.message}`;
  }
  return `${result.status}:stdout=${JSON.stringify(result.stdout)}`;
}

const inputTypeGrammar = [
  'commonjs',
  'module',
  'commonjs-typescript',
  'module-typescript',
].map((inputType) => {
  const prefix = `--input-type=${inputType}`;
  const esm = inputType === 'module' || inputType === 'module-typescript';
  const mandatoryEval = mandatoryEvalSpellings.map(
    ({ option, usageMessage, print }) => {
      const separatedEmpty = run([prefix, option, '']);
      return {
        option,
        missing: outcome(usage(run([prefix, option]), usageMessage)),
        immediateTerminator: outcome(
          usage(run([prefix, option, '--']), usageMessage),
        ),
        separatedEmpty: outcome(
          print && esm
            ? errorCode(
                separatedEmpty,
                'ERR_EVAL_ESM_CANNOT_PRINT',
                '--print cannot be used with ESM input',
              )
            : ok(separatedEmpty, print ? 'undefined\n' : ''),
        ),
      };
    },
  );
  const optionalPrint = optionalPrintSpellings.map((option) => {
    const emptyPrint = run([prefix, option, '--', '']);
    const programPrint = run([prefix, option, '--', grammarEntry, 'alpha']);
    const program = JSON.parse(ok(programPrint, programPrint.stdout).stdout);
    assert.deepEqual(program.execArgv, [prefix, option]);
    assert.deepEqual(program.argv, [grammarEntry, 'alpha']);
    return {
      option,
      empty:
        esm
          ? errorCode(
              emptyPrint,
              'ERR_EVAL_ESM_CANNOT_PRINT',
              '--print cannot be used with ESM input',
            )
          : ok(emptyPrint, 'undefined\n'),
      programExecArgv: program.execArgv,
    };
  });
  return {
    inputType,
    mandatoryEval,
    emptyInlineEval: outcome(
      usage(run([prefix, '--eval=']), '--eval= requires an argument'),
    ),
    optionalPrintSpellings: optionalPrint.map(({ option }) => option),
    emptyPrintTerminator: outcome(optionalPrint[0].empty),
    programExecArgvPreserved: true,
    programArgv: [basename(grammarEntry), 'alpha'],
  };
});
rmSync(grammarRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  version: process.version,
  commonjs: {
    identity: ok(
      explicitCommonjsIdentity,
      '{"argv":[true,"alpha"],"execArgv":["--input-type=commonjs","-p","JSON.stringify({argv:[process.argv[0]===process.execPath,...process.argv.slice(1)],execArgv:process.execArgv,filename:__filename,dirname:__dirname})"],"filename":"[eval]","dirname":"."}\n',
    ),
    typeScriptDisabled: syntaxError(
      explicitCommonjsTypeScript,
      'Missing initializer in const declaration',
    ),
  },
  esm: {
    eval: ok(esmEval, 'esm\n'),
    print: errorCode(
      esmPrint,
      'ERR_EVAL_ESM_CANNOT_PRINT',
      '--print cannot be used with ESM input',
    ),
  },
  typescript: {
    source: ok(sourceTypeScript, '42\n'),
    commonjsInputType: ok(commonjsTypeScript, '42\n'),
    moduleInputType: ok(moduleTypeScript, '42\n'),
    modulePrint: errorCode(
      moduleTypeScriptPrint,
      'ERR_EVAL_ESM_CANNOT_PRINT',
      '--print cannot be used with ESM input',
    ),
    unsupportedSyntax: errorCode(
      unsupportedTypeScript,
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      'TypeScript enum is not supported in strip-only mode',
    ),
  },
  preload: {
    require: ok(requireLong, 'true\n'),
    requireShort: ok(requireShort, 'true\n'),
    import: ok(importPreload, 'esm-preload\n'),
    incomplete: incompletePreloads,
    separatedEmpty: separatedEmptyPreloads,
    program: programPreloads,
  },
  inputTypeGrammar,
}, null, 2));
```

Captured output:

```json
{
  "version": "v24.16.0",
  "commonjs": {
    "identity": {
      "status": 0,
      "stdout": "{\"argv\":[true,\"alpha\"],\"execArgv\":[\"--input-type=commonjs\",\"-p\",\"JSON.stringify({argv:[process.argv[0]===process.execPath,...process.argv.slice(1)],execArgv:process.execArgv,filename:__filename,dirname:__dirname})\"],\"filename\":\"[eval]\",\"dirname\":\".\"}\n"
    },
    "typeScriptDisabled": {
      "status": 1,
      "name": "SyntaxError",
      "message": "Missing initializer in const declaration"
    }
  },
  "esm": {
    "eval": {
      "status": 0,
      "stdout": "esm\n"
    },
    "print": {
      "status": 1,
      "code": "ERR_EVAL_ESM_CANNOT_PRINT",
      "message": "--print cannot be used with ESM input"
    }
  },
  "typescript": {
    "source": {
      "status": 0,
      "stdout": "42\n"
    },
    "commonjsInputType": {
      "status": 0,
      "stdout": "42\n"
    },
    "moduleInputType": {
      "status": 0,
      "stdout": "42\n"
    },
    "modulePrint": {
      "status": 1,
      "code": "ERR_EVAL_ESM_CANNOT_PRINT",
      "message": "--print cannot be used with ESM input"
    },
    "unsupportedSyntax": {
      "status": 1,
      "code": "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
      "message": "TypeScript enum is not supported in strip-only mode"
    }
  },
  "preload": {
    "require": {
      "status": 0,
      "stdout": "true\n"
    },
    "requireShort": {
      "status": 0,
      "stdout": "true\n"
    },
    "import": {
      "status": 0,
      "stdout": "esm-preload\n"
    },
    "incomplete": {
      "omitted": {
        "requireShort": {
          "status": 9,
          "message": "-r requires an argument"
        },
        "requireLong": {
          "status": 9,
          "message": "--require requires an argument"
        },
        "import": {
          "status": 9,
          "message": "--import requires an argument"
        }
      },
      "inlineEmpty": {
        "require": {
          "status": 9,
          "message": "--require= requires an argument"
        },
        "import": {
          "status": 9,
          "message": "--import= requires an argument"
        }
      }
    },
    "separatedEmpty": {
      "requireShort": {
        "status": 1,
        "code": "ERR_INVALID_ARG_VALUE",
        "message": "The argument 'id' must be a non-empty string. Received ''"
      },
      "requireLong": {
        "status": 1,
        "code": "ERR_INVALID_ARG_VALUE",
        "message": "The argument 'id' must be a non-empty string. Received ''"
      },
      "import": {
        "status": 1,
        "code": "ERR_MODULE_NOT_FOUND",
        "message": "Cannot find package"
      }
    },
    "program": {
      "requireShort": {
        "status": 0,
        "execArgv": [
          "-r",
          "<specifier>"
        ],
        "observed": "cjs:cjs-program",
        "entry": "preload-entry.cjs"
      },
      "requireLong": {
        "status": 0,
        "execArgv": [
          "--require",
          "<specifier>"
        ],
        "observed": "cjs:cjs-program",
        "entry": "preload-entry.cjs"
      },
      "requireInline": {
        "status": 0,
        "execArgv": [
          "--require=<specifier>"
        ],
        "observed": "cjs:cjs-program",
        "entry": "preload-entry.cjs"
      },
      "import": {
        "status": 0,
        "execArgv": [
          "--import",
          "<specifier>"
        ],
        "observed": "esm:esm-program",
        "entry": "preload-entry.cjs"
      },
      "importInline": {
        "status": 0,
        "execArgv": [
          "--import=<specifier>"
        ],
        "observed": "esm:esm-program",
        "entry": "preload-entry.cjs"
      }
    }
  },
  "inputTypeGrammar": [
    {
      "inputType": "commonjs",
      "mandatoryEval": [
        {
          "option": "-e",
          "missing": "9:-e requires an argument",
          "immediateTerminator": "9:-e requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "--eval",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "-pe",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"undefined\\n\""
        }
      ],
      "emptyInlineEval": "9:--eval= requires an argument",
      "optionalPrintSpellings": [
        "-p",
        "--print",
        "--print=ignored",
        "--print=not-the-source",
        "--print="
      ],
      "emptyPrintTerminator": "0:stdout=\"undefined\\n\"",
      "programExecArgvPreserved": true,
      "programArgv": [
        "entry.cjs",
        "alpha"
      ]
    },
    {
      "inputType": "module",
      "mandatoryEval": [
        {
          "option": "-e",
          "missing": "9:-e requires an argument",
          "immediateTerminator": "9:-e requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "--eval",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "-pe",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "1:ERR_EVAL_ESM_CANNOT_PRINT"
        }
      ],
      "emptyInlineEval": "9:--eval= requires an argument",
      "optionalPrintSpellings": [
        "-p",
        "--print",
        "--print=ignored",
        "--print=not-the-source",
        "--print="
      ],
      "emptyPrintTerminator": "1:ERR_EVAL_ESM_CANNOT_PRINT",
      "programExecArgvPreserved": true,
      "programArgv": [
        "entry.cjs",
        "alpha"
      ]
    },
    {
      "inputType": "commonjs-typescript",
      "mandatoryEval": [
        {
          "option": "-e",
          "missing": "9:-e requires an argument",
          "immediateTerminator": "9:-e requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "--eval",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "-pe",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"undefined\\n\""
        }
      ],
      "emptyInlineEval": "9:--eval= requires an argument",
      "optionalPrintSpellings": [
        "-p",
        "--print",
        "--print=ignored",
        "--print=not-the-source",
        "--print="
      ],
      "emptyPrintTerminator": "0:stdout=\"undefined\\n\"",
      "programExecArgvPreserved": true,
      "programArgv": [
        "entry.cjs",
        "alpha"
      ]
    },
    {
      "inputType": "module-typescript",
      "mandatoryEval": [
        {
          "option": "-e",
          "missing": "9:-e requires an argument",
          "immediateTerminator": "9:-e requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "--eval",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "0:stdout=\"\""
        },
        {
          "option": "-pe",
          "missing": "9:--eval requires an argument",
          "immediateTerminator": "9:--eval requires an argument",
          "separatedEmpty": "1:ERR_EVAL_ESM_CANNOT_PRINT"
        }
      ],
      "emptyInlineEval": "9:--eval= requires an argument",
      "optionalPrintSpellings": [
        "-p",
        "--print",
        "--print=ignored",
        "--print=not-the-source",
        "--print="
      ],
      "emptyPrintTerminator": "1:ERR_EVAL_ESM_CANNOT_PRINT",
      "programExecArgvPreserved": true,
      "programArgv": [
        "entry.cjs",
        "alpha"
      ]
    }
  ]
}
```

For every accepted input type, omitted mandatory `-e`/`--eval`/`-pe` source
and an immediate `--` are usage errors. A separated empty token is a present
source: `-e`/`--eval` select that input type and succeed in Node, while `-pe`
selects its print context (`undefined` for CommonJS, or
`ERR_EVAL_ESM_CANNOT_PRINT` for ESM). Empty inline `--eval=` remains a usage
error.

Preload grammar has a different empty boundary. Omitted
`-r`/`--require`/`--import` and empty inline `--require=`/`--import=` are usage
errors. Separated empty values are consumed as specifiers: CommonJS require
enters loading and reports `ERR_INVALID_ARG_VALUE`; ESM import enters
resolution and reports `ERR_MODULE_NOT_FOUND`. All five valid preload
spellings also run before a program entry and retain their exact tokens in
`process.execArgv`.

Bare `node` is interactive only on a TTY; piped stdin selects a different
stdin-script mode. This Darwin-host command allocates a PTY, disables history,
and strips only terminal control bytes from the transcript:

```sh
expect -c 'set timeout 5; spawn -noecho env NODE_REPL_HISTORY= node; expect "> "; send "21 * 2\r"; expect "> "; send ".exit\r"; expect eof' |
  sed $'s/\033\\[[0-9;]*[A-Za-z]//g' |
  tr -d '\r'
```

Captured output:

```text
Welcome to Node.js v24.16.0.
Type ".help" for more information.
> 21 * 2
42
> .exit
```
