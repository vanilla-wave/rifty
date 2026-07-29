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
node -pe "JSON.stringify({argv:process.argv,execArgv:process.execArgv})" alpha
node -p
node --print
node -e
node --eval=
```

Normalized stdout/status:

```text
v24.16.0
{"argv":["<node>","alpha","two words"],"execArgv":["-e","<source>"]}       # 0
{"argv":["<node>","alpha"],"execArgv":["--eval=<source>"]}                # 0
{"argv":["<node>","alpha"],"execArgv":["-p","<source>"]}                  # 0
{"argv":["<node>","alpha"],"execArgv":["--print=ignored","<source>"]}     # 0
{"argv":["<node>","alpha"],"execArgv":["-pe","<source>"]}                 # 0
undefined                                                               # 0
undefined                                                               # 0
node: -e requires an argument                                            # 9
node: --eval= requires an argument                                       # 9
```

`--print=<rhs>` is a boolean option spelling: the RHS is ignored and the next
argument is source. Missing `-p`/`--print` source evaluates `undefined`;
missing `-e` and empty `--eval=` are usage errors. `--` immediately after
source is consumed; later arguments, including option-looking ones, are script
arguments. `-pe` is accepted; `-ep`, attached short-option source, `-p=`, and
`-e=` are bad options.

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
const { join } = require('node:path');

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
  return normalize({
    name,
    argv: value.argv,
    execArgv: value.execArgv,
    moduleFilename: value.module.filename,
    firstModulePath: value.module.paths[0],
    resolved: value.resolved,
    child: value.child,
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
      }
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
      }
    }
  ],
  "concurrentMatchesSequential": true
}
```

The assertions also pin empty stderr/status 0, global-script identity,
undefined main/parent surfaces, false `loaded`/cache membership, and each
fixture's exact cwd-anchored first module path.

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
