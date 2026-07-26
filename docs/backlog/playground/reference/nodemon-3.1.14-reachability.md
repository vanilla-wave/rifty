# nodemon 3.1.14 reachability oracle

Captured 2026-07-26 on:

```text
{"node":"v24.16.0","platform":"darwin","arch":"arm64"}
npm 11.17.0
```

## Acquisition

```sh
npm install --prefix /private/tmp/rifty-pr152-oracle \
  nodemon@3.1.14 --save-exact --ignore-scripts
shasum -a 256 /private/tmp/rifty-pr152-oracle/package-lock.json
```

```text
45fa9b0667b298d6b01ba8f82ed05e04b770d0da41a98c0f169d32704aa82477
```

The resolved forcing closure was:

```text
anymatch@3.1.3
balanced-match@4.0.4
binary-extensions@2.3.0
brace-expansion@5.0.7
braces@3.0.3
chokidar@3.6.0
debug@4.4.3
fill-range@7.1.1
fsevents@2.3.3
glob-parent@5.1.2
has-flag@3.0.0
ignore-by-default@1.0.1
is-binary-path@2.1.0
is-extglob@2.1.1
is-glob@4.0.3
is-number@7.0.0
minimatch@10.2.5
ms@2.1.3
nodemon@3.1.14
normalize-path@3.0.0
picomatch@2.3.2
pstree.remy@1.1.8
readdirp@3.6.0
semver@7.8.5
simple-update-notifier@2.0.0
supports-color@5.5.0
to-regex-range@5.0.1
touch@3.1.1
undefsafe@2.0.5
```

Load-bearing integrities from that lock:

```text
nodemon@3.1.14 sha512-jakjZi93UtB3jHMWsXL68FXSAosbLfY0In5gtKq3niLSkrWznrVBzXFNOEMJUfc9+Ke7SHWoAZsiMkNP3vq6Jw==
chokidar@3.6.0 sha512-7VT13fmjotKpGipCW9JEQAusEPE+Ei8nl6/g4FBAmIm0GOOLMua9NDDo/DWp0ZAxCr3cPq5ZpBqmPAQgDda2Pw==
minimatch@10.2.5 sha512-MULkVLfKGYDFYejP07QOurDLLQpcjk7Fw+7jXS2R2czRQzR56yHRveU5NDJEOviH+hETZKSkIk5c+T23GjFUMg==
pstree.remy@1.1.8 sha512-77DZwxQmxKnu3aR542U+X8FypNzbfJ+C5XQDk3uWjWxn6151aIMGthWYRXTqT1E5oJvg+ljaa2OJi+VfvCOQ8w==
```

The npm tarball itself was:

```text
sha1   8487ca379c515301d221ec007f27f24ecafa2b51
sha512 8da923662f7752d0778c7316b172faf055d2028b1b2df634227e60b4aab79e22d292b5b39eb541cd714d38430951f73df8a7bb4875a8019b2232434fdefaba27
```

Retained executable commands, fixture generation, and captured output:

- `nodemon-3.1.14-node-probe.md` — EventEmitter, CJS records, spawn/env/files,
  stdio, JSON IPC, recursive PPID/PID discovery, SIGUSR2 exit, and stream drain;
- `nodemon-3.1.14-loop-probe.md` — exact nodemon start, mutations, HTTP
  responses on one port, syntax recovery, rapid-edit convergence, live
  descendant count, SIGINT, process search, and closed-port teardown.

## Consumer reachability

Pinned package source proves these paths without inference:

- `nodemon/lib/utils/bus.js:5-9` calls `EventEmitter.call(this)` then
  `util.inherits`.
- `nodemon/lib/version.js:17` reads `module.parent.filename`;
  `nodemon/lib/utils/index.js:22-31` walks the parent chain.
- `nodemon/lib/monitor/run.js:57-59,116-138` turns `--no-stdin` into inherited
  stdio and forks a Node entry with one appended `ipc` slot.
- `nodemon/lib/monitor/run.js:283-314,451-472` gates every stdin
  pipe/unpipe/end operation on the now-false stdin option or a non-null child
  stream.
- `nodemon/lib/config/defaults.js:20` selects `SIGUSR2`.
- `pstree.remy/lib/index.js:6-8` probes `exec('ps')`;
  `pstree.remy/lib/tree.js:8-31` consumes
  `spawn('ps', ['-A', '-o', 'ppid,pid'])`.
- `nodemon/lib/monitor/run.js:410-435` calls `child.kill(signal)`, then
  `exec('kill -<signal> <pid>')`, and waits on the same process-tree query.

Workbench starts nodemon as a normal installed-bin spawn, so nodemon's own
`process.send` is absent. Nodemon forks the application, so only the app child
has public Node IPC.

## Node probes

The exact executable for every primitive result below is retained in
`nodemon-3.1.14-node-probe.md`; its command extracts the fenced program from
the committed markdown, generates all fixtures in a fresh temporary directory,
and records Node/nodemon/pstree versions in the same JSON result.

### Callable EventEmitter

The probe calls `EventEmitter.call(target)`, constructs the
`util.inherits` form, subclasses with `class`, installs listeners through the
same prototype, and emits once through each initialized target:

```text
{
  "legacyInstanceof": true,
  "prototypeIdentity": true,
  "legacyCallReturnsSelf": false,
  "targetCallReturnsSelf": false,
  "targetOwnEvents": true,
  "modernInstanceof": true,
  "count": 2
}
```

The false return-value fields mean Node returned `undefined`; the compatibility
constructor must not invent a fluent return.

### CJS records

The fixture requires a module twice, observes an A↔B cycle while A is still
loading, and catches a third module that throws during evaluation:

```text
{
  "fresh": {
    "sameExports": true,
    "duringLoaded": false,
    "afterLoaded": true,
    "childLinkedOnce": 1,
    "pathEqualsDir": true,
    "pathsIsArray": true
  },
  "cycle": {
    "aLoadedDuringA": false,
    "aVisibleDuringB": true,
    "aLoadedDuringB": false,
    "aExportsIdentityDuringB": true,
    "bParentIsA": true,
    "aChildrenContainBOnce": 1,
    "afterLoaded": [true, true]
  },
  "failed": {
    "message": "probe-failure",
    "absentFromCache": true,
    "absentFromParentChildren": true
  }
}
```

The same run of nodemon's real `lib/version.js` returned a loaded record whose
`id === filename`, parent filename was the requiring entry, `path` was the
filename directory, `paths` was an array, and the parent contained that child
exactly once.

### Spawn/fork, shared files, stdio, and IPC

A child invoked by relative entry read `owner-bytes`, wrote
`owner-bytes:child`, and produced:

```text
{
  "inherited": {
    "status": 0,
    "argvTail": ["src/spawn-child.cjs", "arg-one"],
    "env": {"inherited":"yes","replacement":null},
    "input": "owner-bytes",
    "write": "owner-bytes:child"
  },
  "replacement": {
    "status": 0,
    "argvTail": ["src/spawn-child.cjs", "arg-two"],
    "env": {"inherited":null,"replacement":"yes"},
    "input": "owner-bytes",
    "write": "owner-bytes:child"
  }
}
```

Default-pipe stdin writes `one`, `two`, then one EOF produced exact bytes and
terminal order:

```text
{
  "shape": {"stdin":true,"stdout":true,"stderr":true,"stdio":[true,true,true]},
  "stdout": "stdout:onetwo",
  "stderr": "stderr:done",
  "order": [["exit",0,null],["close",0,null]]
}
{"ignore":{"stdin":null,"stdout":null,"stderr":null,"stdio":[null,null,null]}}
{"inherit":{"stdin":null,"stdout":null,"stderr":null,"stdio":[null,null,null]}}
```

The exact nodemon fork plan,
`[process.stdin, process.stdout, process.stderr, 'ipc']`, produced:

```json
{
  "node": "v24.16.0",
  "nodemon": "3.1.14",
  "stdinNull": true,
  "stdoutNull": true,
  "stderrNull": true,
  "stdio": [null, null, null, null],
  "connected": true,
  "stdinUnpipeCalls": 0,
  "restartSignal": "SIGUSR2"
}
```

Default fork JSON omitted a function property, a circular send threw
synchronously, and the same channel then carried another message:

```text
{
  "messages": [{"kept":1},{"after":true}],
  "circularError": {
    "name": "TypeError",
    "code": null,
    "message": "Converting circular structure to JSON"
  },
  "connectedBeforeDisconnect": true
}
{"connectedAfterDisconnect":false}
```

### Process discovery and signal

Against one probe child, the literal consumer calls produced:

```text
{
  "ps": {"errorCode":null,"nonEmpty":true},
  "formatted": {"header":"PPID   PID","foundChild":"34141 34160"},
  "kill": {
    "callbackError": null,
    "exitCode": null,
    "exitSignal": "SIGUSR2"
  }
}
```

PIDs are intentionally not stable; their coherent PPID/PID relation and the
signal result are the oracle.

## Real nodemon loop

The self-contained setup/mutation/probe/teardown command and captured JSON are
retained in `nodemon-3.1.14-loop-probe.md`. The summary below is the earlier
manual capture of the same path.

Fixture:

```js
const http = require('node:http');
const generation = 'v1';
const server = http.createServer((_request, response) => {
  response.end(generation);
});
server.listen(32187, '127.0.0.1', () => {
  console.log(`APP_READY ${generation}`);
});
```

Command:

```sh
/private/tmp/rifty-pr152-oracle/node_modules/.bin/nodemon \
  --legacy-watch --no-stdin --no-update-notifier src/main.js
```

Captured mutation sequence was `v1 → v2 → invalid syntax → v3 → v4 → v5`;
the last two writes were issued without waiting for a restart:

```text
[nodemon] 3.1.14
[nodemon] starting `node src/main.js`
APP_READY v1
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
APP_READY v2
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
SyntaxError: Unexpected token ';'
Node.js v24.16.0
[nodemon] app crashed - waiting for file changes before starting...
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
APP_READY v3
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
APP_READY v4
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
APP_READY v5
^C
```

After Ctrl-C, both
`lsof -nP -iTCP:32187 -sTCP:LISTEN` and a process-table search for nodemon and
`src/main.js` returned no rows. Native Node therefore proves recovery and final
convergence, but the browser acceptance must additionally prove owner-VFS
provenance, fresh realms, routed-response readiness, and Workbench teardown.
