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
[eval]:1 ... Error: boom ... at [eval]:1:7                             # 1
[eval]:1 ... SyntaxError ...                                           # 1
```

The `-p` writer is console single-argument formatting, not unconditional
`util.inspect`: a top-level string is unquoted. Node registers its result
writer for `beforeExit` with `exit` fallback, so timer mutations and Promise
settlement precede output; immediate `process.exit` suppresses output.
Throw/syntax/unhandled-rejection failures exit 1, while explicit
`process.exit(N)` and `process.exitCode=N` retain Node's exit contract.

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
