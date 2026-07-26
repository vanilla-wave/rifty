# nodemon 3.1.14 Node primitive probe

Captured 2026-07-26. This is the retained executable behind parity evidence
for callable EventEmitter, CJS records, spawn/env/files, stdio, JSON IPC,
recursive process discovery, signal exit, and final stream drain.
Fenced source SHA-256:
`c006c2726ad5dfb60a156fc44e039d9a12f593b772f3b65b9427564e679f007c`.

Install the pinned consumer as described in
`nodemon-3.1.14-reachability.md`, then extract and execute this committed code:

```sh
probe_dir="$(mktemp -d)"
awk '/^```cjs oracle-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/playground/reference/nodemon-3.1.14-node-probe.md \
  > "$probe_dir/probe.cjs"
node "$probe_dir/probe.cjs" /private/tmp/rifty-pr152-oracle
```

```cjs oracle-probe
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { inherits } = require('node:util');
const { exec, fork, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('usage: node probe.cjs <nodemon-install-prefix>');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rifty-nodemon-oracle-'));
const srcRoot = path.join(fixtureRoot, 'src');
fs.mkdirSync(srcRoot, { recursive: true });
fs.mkdirSync(path.join(fixtureRoot, 'cjs'), { recursive: true });

const write = (relative, contents) => {
  fs.writeFileSync(path.join(fixtureRoot, relative), contents);
};
const onceExit = (child) =>
  new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
const execAsync = (command) =>
  new Promise((resolve) =>
    exec(command, (error, stdout, stderr) =>
      resolve({ errorCode: error?.code ?? null, stdout, stderr }),
    ),
  );

async function probe() {
  const result = {
    versions: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      nodemon: require(path.join(packageRoot, 'node_modules/nodemon/package.json')).version,
      pstree: require(path.join(packageRoot, 'node_modules/pstree.remy/package.json')).version,
    },
  };

  function Legacy() {
    this.callResult = EventEmitter.call(this);
  }
  inherits(Legacy, EventEmitter);
  const legacy = new Legacy();
  const target = {};
  const targetReturn = EventEmitter.call(target);
  let count = 0;
  legacy.on('event', () => count++);
  EventEmitter.prototype.on.call(target, 'event', () => count++);
  legacy.emit('event');
  EventEmitter.prototype.emit.call(target, 'event');
  class Modern extends EventEmitter {}
  result.eventEmitter = {
    legacyInstanceof: legacy instanceof EventEmitter,
    prototypeIdentity: Object.getPrototypeOf(Legacy.prototype) === EventEmitter.prototype,
    legacyCallReturnType: typeof legacy.callResult,
    targetCallReturnType: typeof targetReturn,
    targetOwnEvents: Object.hasOwn(target, '_events'),
    modernInstanceof: new Modern() instanceof EventEmitter,
    count,
  };

  write(
    'cjs/fresh.cjs',
    `module.exports = {
  duringLoaded: module.loaded,
  id: module.id,
  filename: module.filename,
  parentFilename: module.parent?.filename ?? null,
  path: module.path,
  pathsIsArray: Array.isArray(module.paths),
};\n`,
  );
  write(
    'cjs/a.cjs',
    `exports.loadedDuringA = module.loaded;
exports.b = require('./b.cjs');\n`,
  );
  write(
    'cjs/b.cjs',
    `const aFilename = require.resolve('./a.cjs');
module.exports = {
  parentFilename: module.parent?.filename ?? null,
  aVisibleInCache: require.cache[aFilename] !== undefined,
  aLoadedDuringB: require.cache[aFilename]?.loaded ?? null,
  aExportsIdentity: require.cache[aFilename]?.exports,
};\n`,
  );
  write('cjs/fail.cjs', `throw new Error('probe-failure');\n`);
  write('cjs/shared.cjs', `module.exports = { token: 'shared' };\n`);
  write('cjs/parent-a.cjs', `module.exports = require('./shared.cjs');\n`);
  write('cjs/parent-b.cjs', `module.exports = require('./shared.cjs');\n`);
  write(
    'cjs/probe.cjs',
    `const path = require('node:path');
const freshFilename = require.resolve('./fresh.cjs');
const first = require('./fresh.cjs');
const second = require('./fresh.cjs');
const freshRecord = require.cache[freshFilename];
const cycle = require('./a.cjs');
const aRecord = require.cache[require.resolve('./a.cjs')];
const bRecord = require.cache[require.resolve('./b.cjs')];
const fromA = require('./parent-a.cjs');
const sharedFilename = require.resolve('./shared.cjs');
const sharedRecord = require.cache[sharedFilename];
const parentARecord = require.cache[require.resolve('./parent-a.cjs')];
const firstParentFilename = sharedRecord.parent?.filename ?? null;
const fromB = require('./parent-b.cjs');
const parentBRecord = require.cache[require.resolve('./parent-b.cjs')];
const failFilename = require.resolve('./fail.cjs');
let failMessage = null;
try { require('./fail.cjs'); } catch (error) { failMessage = error.message; }
module.exports = {
  fresh: {
    sameExports: first === second,
    duringLoaded: first.duringLoaded,
    afterLoaded: freshRecord.loaded,
    childLinkedOnce: module.children.filter((child) => child === freshRecord).length,
    pathEqualsDir: first.path === path.dirname(first.filename),
    pathsIsArray: first.pathsIsArray,
    id: first.id,
    filename: first.filename,
    idEqualsFilename: first.id === first.filename,
    parentFilename: first.parentFilename,
  },
  cycle: {
    aLoadedDuringA: cycle.loadedDuringA,
    aVisibleDuringB: cycle.b.aVisibleInCache,
    aLoadedDuringB: cycle.b.aLoadedDuringB,
    aExportsIdentityDuringB: cycle.b.aExportsIdentity === cycle,
    bParentIsA: cycle.b.parentFilename === aRecord.filename,
    aChildrenContainBOnce: aRecord.children.filter((child) => child === bRecord).length,
    afterLoaded: [aRecord.loaded, bRecord.loaded],
  },
  firstParent: {
    sameExportsAcrossParents: fromA === fromB,
    firstParentIsA: firstParentFilename === parentARecord.filename,
    stableAfterSecondParent: sharedRecord.parent?.filename === firstParentFilename,
    secondParentLinksCachedChildOnce:
      parentBRecord.children.filter((child) => child === sharedRecord).length,
  },
  failed: {
    message: failMessage,
    absentFromCache: require.cache[failFilename] === undefined,
    absentFromParentChildren: !module.children.some((child) => child.filename === failFilename),
  },
};\n`,
  );
  const fixtureRequire = createRequire(path.join(fixtureRoot, 'entry.cjs'));
  result.cjs = fixtureRequire('./cjs/probe.cjs');

  write('shared.txt', 'owner-bytes\n');
  write(
    'src/spawn-child.cjs',
    `const fs = require('node:fs');
const input = fs.readFileSync('shared.txt', 'utf8').trim();
fs.writeFileSync('child.txt', input + ':child');
console.log(JSON.stringify({
  argv: process.argv.slice(1),
  cwd: process.cwd(),
  env: {
    inherited: process.env.INHERITED_PROBE ?? null,
    replacement: process.env.REPLACEMENT_PROBE ?? null,
  },
  input,
}));\n`,
  );
  const inherited = spawnSync(process.execPath, ['src/spawn-child.cjs', 'arg-one'], {
    cwd: fixtureRoot,
    env: { ...process.env, INHERITED_PROBE: 'yes' },
    encoding: 'utf8',
  });
  const inheritedWrite = fs.readFileSync(path.join(fixtureRoot, 'child.txt'), 'utf8');
  fs.unlinkSync(path.join(fixtureRoot, 'child.txt'));
  const replacement = spawnSync(process.execPath, ['src/spawn-child.cjs', 'arg-two'], {
    cwd: fixtureRoot,
    env: { REPLACEMENT_PROBE: 'yes' },
    encoding: 'utf8',
  });
  const replacementWrite = fs.readFileSync(path.join(fixtureRoot, 'child.txt'), 'utf8');
  result.spawn = {
    inherited: {
      status: inherited.status,
      stdout: JSON.parse(inherited.stdout),
      write: inheritedWrite,
    },
    replacement: {
      status: replacement.status,
      stdout: JSON.parse(replacement.stdout),
      write: replacementWrite,
    },
  };

  write(
    'src/stdio-child.cjs',
    `const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
process.stdin.on('end', () => {
  process.stdout.write('stdout:' + chunks.join(''));
  process.stderr.write('stderr:done');
});\n`,
  );
  result.stdio = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/stdio-child.cjs'], { cwd: fixtureRoot });
    const order = [];
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code, signal) => order.push(['exit', code, signal]));
    child.on('close', (code, signal) => {
      order.push(['close', code, signal]);
      resolve({
        pipeShape: {
          stdin: child.stdin !== null,
          stdout: child.stdout !== null,
          stderr: child.stderr !== null,
          stdio: child.stdio.map((slot) => slot !== null),
        },
        stdout,
        stderr,
        order,
      });
    });
    child.stdin.write('one');
    child.stdin.write('two');
    child.stdin.end();
  });
  for (const mode of ['ignore', 'inherit']) {
    const child = spawn(process.execPath, ['-e', ''], { stdio: mode });
    result.stdio[mode] = {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      stdio: child.stdio,
    };
    await onceExit(child);
  }

  write('src/shape-child.cjs', `setInterval(() => {}, 1000);\n`);
  const shapeChild = fork(path.join(srcRoot, 'shape-child.cjs'), [], {
    stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
  });
  result.nodemonForkShape = {
    stdinNull: shapeChild.stdin === null,
    stdoutNull: shapeChild.stdout === null,
    stderrNull: shapeChild.stderr === null,
    stdio: shapeChild.stdio.map((slot) => (slot === null ? null : 'stream')),
    connected: shapeChild.connected,
    stdinUnpipeCalls: 0,
    restartSignal: require(path.join(
      packageRoot,
      'node_modules/nodemon/lib/config/defaults',
    )).signal,
  };
  shapeChild.kill('SIGTERM');
  result.nodemonForkShape.exit = await onceExit(shapeChild);

  write(
    'src/plain-ipc-child.cjs',
    `console.log(JSON.stringify({
  sendType: typeof process.send,
  connected: process.connected ?? null,
  channel: process.channel ?? null,
}));\n`,
  );
  result.plainSpawn = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/plain-ipc-child.cjs'], {
      cwd: fixtureRoot,
    });
    const parent = {
      sendType: typeof child.send,
      connected: child.connected,
      channel: child.channel ?? null,
      stdio: child.stdio.map((slot) => slot !== null),
    };
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('close', (code, signal) =>
      resolve({ parent, guest: JSON.parse(stdout), exit: { code, signal } }),
    );
  });

  const execKillChild = fork(path.join(srcRoot, 'shape-child.cjs'), [], {
    stdio: 'ignore',
  });
  const execKillExit = onceExit(execKillChild);
  const execKillCallback = await execAsync(`kill -USR2 ${execKillChild.pid}`);
  result.execKill = {
    command: `kill -USR2 ${execKillChild.pid}`,
    callback: {
      errorCode: execKillCallback.errorCode,
      stdout: execKillCallback.stdout,
      stderr: execKillCallback.stderr,
    },
    exit: await execKillExit,
  };

  write('src/ipc-child.cjs', `process.on('message', (message) => process.send(message));\n`);
  result.ipc = await new Promise((resolve) => {
    const child = fork(path.join(srcRoot, 'ipc-child.cjs'));
    const messages = [];
    let circularError = null;
    let connectedBeforeDisconnect = null;
    child.on('message', (message) => {
      messages.push(message);
      if (messages.length === 1) {
        const circular = {};
        circular.self = circular;
        try {
          child.send(circular);
        } catch (error) {
          circularError = {
            name: error.name,
            code: error.code ?? null,
            message: error.message.split('\n')[0],
          };
        }
        child.send({ after: true });
        return;
      }
      connectedBeforeDisconnect = child.connected;
      child.disconnect();
    });
    child.on('disconnect', () => {
      const connectedAfterDisconnect = child.connected;
      child.kill();
      resolve({
        messages,
        circularError,
        connectedBeforeDisconnect,
        connectedAfterDisconnect,
      });
    });
    child.send({ kept: 1, dropped() {} });
  });

  write(
    'src/descendant-parent.cjs',
    `const { fork } = require('node:child_process');
const path = require('node:path');
const child = fork(path.join(__dirname, 'shape-child.cjs'), [], { stdio: 'ignore' });
process.send({ grandchildPid: child.pid });
process.on('message', (message) => {
  if (message === 'stop') {
    child.once('exit', () => process.exit(0));
    child.kill('SIGTERM');
  }
});\n`,
  );
  const descendantParent = fork(path.join(srcRoot, 'descendant-parent.cjs'), [], {
    stdio: 'ignore',
  });
  result.processTree = await new Promise((resolve) => {
    descendantParent.once('message', async ({ grandchildPid }) => {
      const bare = await execAsync('ps');
      const formatted = await execAsync('ps -A -o ppid,pid');
      const rows = formatted.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const rowFor = (pid) =>
        rows.find((line) => line.split(/\s+/)[1] === String(pid)) ?? null;
      const parentRow = rowFor(descendantParent.pid);
      const grandchildRow = rowFor(grandchildPid);
      descendantParent.send('stop');
      const exit = await onceExit(descendantParent);
      resolve({
        barePsErrorCode: bare.errorCode,
        header: rows[0],
        parentPid: descendantParent.pid,
        grandchildPid,
        parentRow,
        grandchildRow,
        coherent:
          parentRow?.split(/\s+/)[0] === String(process.pid) &&
          grandchildRow?.split(/\s+/)[0] === String(descendantParent.pid),
        exit,
      });
    });
  });

  write(
    'src/signal-drain-child.cjs',
    `process.once('SIGUSR2', () => {
  process.stdout.write('signal-stdout');
  process.stderr.write('signal-stderr');
  process.kill(process.pid, 'SIGUSR2');
});
process.send('ready');
setInterval(() => {}, 1000);\n`,
  );
  result.signalDrain = await new Promise((resolve) => {
    const child = fork(path.join(srcRoot, 'signal-drain-child.cjs'), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '';
    let stderr = '';
    const order = [];
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('message', () => child.kill('SIGUSR2'));
    child.on('exit', (code, signal) => order.push(['exit', code, signal]));
    child.on('close', (code, signal) => {
      order.push(['close', code, signal]);
      resolve({ stdout, stderr, order });
    });
  });

  return result;
}

probe()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .finally(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
```

Captured output:

```json
{
  "versions": {
    "node": "v24.16.0",
    "platform": "darwin",
    "arch": "arm64",
    "nodemon": "3.1.14",
    "pstree": "1.1.8"
  },
  "eventEmitter": {
    "legacyInstanceof": true,
    "prototypeIdentity": true,
    "legacyCallReturnType": "undefined",
    "targetCallReturnType": "undefined",
    "targetOwnEvents": true,
    "modernInstanceof": true,
    "count": 2
  },
  "cjs": {
    "fresh": {
      "sameExports": true,
      "duringLoaded": false,
      "afterLoaded": true,
      "childLinkedOnce": 1,
      "pathEqualsDir": true,
      "pathsIsArray": true,
      "id": "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH/cjs/fresh.cjs",
      "filename": "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH/cjs/fresh.cjs",
      "idEqualsFilename": true,
      "parentFilename": "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH/cjs/probe.cjs"
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
    "firstParent": {
      "sameExportsAcrossParents": true,
      "firstParentIsA": true,
      "stableAfterSecondParent": true,
      "secondParentLinksCachedChildOnce": 1
    },
    "failed": {
      "message": "probe-failure",
      "absentFromCache": true,
      "absentFromParentChildren": true
    }
  },
  "spawn": {
    "inherited": {
      "status": 0,
      "stdout": {
        "argv": [
          "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH/src/spawn-child.cjs",
          "arg-one"
        ],
        "cwd": "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH",
        "env": {"inherited":"yes","replacement":null},
        "input": "owner-bytes"
      },
      "write": "owner-bytes:child"
    },
    "replacement": {
      "status": 0,
      "stdout": {
        "argv": [
          "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH/src/spawn-child.cjs",
          "arg-two"
        ],
        "cwd": "/private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-nodemon-oracle-GqiooH",
        "env": {"inherited":null,"replacement":"yes"},
        "input": "owner-bytes"
      },
      "write": "owner-bytes:child"
    }
  },
  "stdio": {
    "pipeShape": {"stdin":true,"stdout":true,"stderr":true,"stdio":[true,true,true]},
    "stdout": "stdout:onetwo",
    "stderr": "stderr:done",
    "order": [["exit",0,null],["close",0,null]],
    "ignore": {"stdin":null,"stdout":null,"stderr":null,"stdio":[null,null,null]},
    "inherit": {"stdin":null,"stdout":null,"stderr":null,"stdio":[null,null,null]}
  },
  "nodemonForkShape": {
    "stdinNull": true,
    "stdoutNull": true,
    "stderrNull": true,
    "stdio": [null,null,null,null],
    "connected": true,
    "stdinUnpipeCalls": 0,
    "restartSignal": "SIGUSR2",
    "exit": {"code":null,"signal":"SIGTERM"}
  },
  "plainSpawn": {
    "parent": {
      "sendType": "undefined",
      "connected": false,
      "channel": null,
      "stdio": [true,true,true]
    },
    "guest": {
      "sendType": "undefined",
      "connected": null,
      "channel": null
    },
    "exit": {"code":0,"signal":null}
  },
  "execKill": {
    "command": "kill -USR2 4704",
    "callback": {"errorCode":null,"stdout":"","stderr":""},
    "exit": {"code":null,"signal":"SIGUSR2"}
  },
  "ipc": {
    "messages": [{"kept":1},{"after":true}],
    "circularError": {
      "name": "TypeError",
      "code": null,
      "message": "Converting circular structure to JSON"
    },
    "connectedBeforeDisconnect": true,
    "connectedAfterDisconnect": false
  },
  "processTree": {
    "barePsErrorCode": null,
    "header": "PPID   PID",
    "parentPid": 4709,
    "grandchildPid": 4711,
    "parentRow": "4672  4709",
    "grandchildRow": "4709  4711",
    "coherent": true,
    "exit": {"code":0,"signal":null}
  },
  "signalDrain": {
    "stdout": "signal-stdout",
    "stderr": "signal-stderr",
    "order": [
      ["exit",null,"SIGUSR2"],
      ["close",null,"SIGUSR2"]
    ]
  }
}
```

Temporary paths and PIDs vary. The recorded truth is relative argv/cwd, exact
env/file bytes, coherent PPID edges, signal/code values, stream bytes, and
event order.
