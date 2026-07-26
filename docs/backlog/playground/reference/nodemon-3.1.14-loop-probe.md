# nodemon 3.1.14 native loop probe

Captured 2026-07-26 on Node v24.16.0. The retained script creates its own
temporary CommonJS HTTP fixture, launches the exact consumer command, mutates
the entry, probes the same port, inspects the live process tree, sends SIGINT,
and verifies both process and port teardown.
Fenced source SHA-256:
`6b83e81fba19f49de351fdb01dbc1430b3ef3f434e6e3016a9950246b361eec4`.

After the pinned acquisition in `nodemon-3.1.14-reachability.md`:

```sh
probe_dir="$(mktemp -d)"
awk '/^```cjs loop-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/playground/reference/nodemon-3.1.14-loop-probe.md \
  > "$probe_dir/nodemon-loop.cjs"
node "$probe_dir/nodemon-loop.cjs" /private/tmp/rifty-pr152-oracle
```

```cjs loop-probe
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('usage: node nodemon-loop.cjs <nodemon-install-prefix>');

const nodemonBin = path.join(packageRoot, 'node_modules/.bin/nodemon');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rifty-nodemon-loop-'));
const entry = path.join(fixtureRoot, 'src/main.js');
fs.mkdirSync(path.dirname(entry), { recursive: true });
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), '{"type":"commonjs"}\n');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execFileAsync = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }),
    ),
  );

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });

const appSource = (port, generation) => `const http = require('node:http');
const generation = ${JSON.stringify(generation)};
const server = http.createServer((_request, response) => {
  response.end(generation);
});
server.listen(${port}, '127.0.0.1', () => {
  console.log('APP_READY ' + generation);
});
`;

const get = (port) =>
  new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.once('error', reject);
  });

const processRows = async () => {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'ppid,pid,command']);
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match
        ? { ppid: Number(match[1]), pid: Number(match[2]), command: match[3] }
        : null;
    })
    .filter(Boolean);
};

const descendantsOf = (rows, rootPid) => {
  const ids = new Set([rootPid]);
  const descendants = [];
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        descendants.push(row);
        added = true;
      }
    }
  }
  return descendants;
};

async function run() {
  const port = await reservePort();
  fs.writeFileSync(entry, appSource(port, 'v1'));

  const args = [
    '--legacy-watch',
    '--no-stdin',
    '--no-update-notifier',
    'src/main.js',
  ];
  const child = spawn(nodemonBin, args, {
    cwd: fixtureRoot,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const waiters = [];
  const receive = (chunk) => {
    output += chunk.toString('utf8');
    for (const waiter of [...waiters]) {
      if (waiter.pattern.test(output)) {
        clearTimeout(waiter.timer);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  const waitFor = (pattern, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      pattern.lastIndex = 0;
      if (pattern.test(output)) return resolve();
      const waiter = {
        pattern,
        resolve,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`timeout waiting for ${pattern}\n${output}`));
        }, timeoutMs),
      };
      waiters.push(waiter);
    });

  try {
    await waitFor(/APP_READY v1/);
    const v1 = await get(port);

    fs.writeFileSync(entry, appSource(port, 'v2'));
    await waitFor(/APP_READY v2/);
    const v2 = await get(port);

    fs.writeFileSync(entry, "const generation = ;\n");
    await waitFor(/app crashed - waiting for file changes before starting/);

    fs.writeFileSync(entry, appSource(port, 'v3'));
    await waitFor(/APP_READY v3/);
    const v3 = await get(port);

    fs.writeFileSync(entry, appSource(port, 'v4'));
    fs.writeFileSync(entry, appSource(port, 'v5'));
    await waitFor(/APP_READY v5/);
    const v5 = await get(port);

    const liveRows = await processRows();
    const liveDescendants = descendantsOf(liveRows, child.pid);
    const liveAppRows = liveDescendants.filter((row) => row.command.includes('src/main.js'));

    const closed = new Promise((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    child.kill('SIGINT');
    const supervisorExit = await closed;

    let portClosed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await get(port);
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          portClosed = true;
          break;
        }
      }
      await delay(50);
    }
    const afterRows = await processRows();
    const afterDescendants = descendantsOf(afterRows, child.pid);
    const selectedOutput = output
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .filter(
        (line) =>
          line.includes('[nodemon]') ||
          line.includes('APP_READY') ||
          line.includes('SyntaxError') ||
          line.includes('Node.js v'),
      );

    console.log(
      JSON.stringify(
        {
          versions: {
            node: process.version,
            nodemon: require(path.join(packageRoot, 'node_modules/nodemon/package.json'))
              .version,
          },
          command: [nodemonBin, ...args],
          mutations: ['v1', 'v2', 'invalid-syntax', 'v3', 'v4+v5-without-wait'],
          responses: { v1, v2, v3, v5 },
          live: {
            descendantCount: liveDescendants.length,
            appCount: liveAppRows.length,
            rows: liveDescendants,
          },
          teardown: {
            signalSent: 'SIGINT',
            supervisorExit,
            processSearch: "ps -A -o ppid,pid,command | descendantsOf(supervisorPid)",
            afterDescendants,
            portClosed,
          },
          output: selectedOutput,
        },
        null,
        2,
      ),
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

run().finally(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
```

Captured output:

```json
{
  "versions": {"node":"v24.16.0","nodemon":"3.1.14"},
  "command": [
    "/private/tmp/rifty-pr152-oracle/node_modules/.bin/nodemon",
    "--legacy-watch",
    "--no-stdin",
    "--no-update-notifier",
    "src/main.js"
  ],
  "mutations": ["v1","v2","invalid-syntax","v3","v4+v5-without-wait"],
  "responses": {
    "v1":{"status":200,"body":"v1"},
    "v2":{"status":200,"body":"v2"},
    "v3":{"status":200,"body":"v3"},
    "v5":{"status":200,"body":"v5"}
  },
  "live": {
    "descendantCount": 1,
    "appCount": 1,
    "rows": [{
      "ppid": 89098,
      "pid": 89186,
      "command": "/Users/vanilla-wave/.nvm/versions/node/v24.16.0/bin/node src/main.js"
    }]
  },
  "teardown": {
    "signalSent": "SIGINT",
    "supervisorExit": {"code":130,"signal":null},
    "processSearch": "ps -A -o ppid,pid,command | descendantsOf(supervisorPid)",
    "afterDescendants": [],
    "portClosed": true
  },
  "output": [
    "[nodemon] 3.1.14",
    "[nodemon] to restart at any time, enter `rs`",
    "[nodemon] watching path(s): *.*",
    "[nodemon] watching extensions: js,mjs,cjs,json",
    "[nodemon] starting `node src/main.js`",
    "APP_READY v1",
    "[nodemon] restarting due to changes...",
    "[nodemon] starting `node src/main.js`",
    "APP_READY v2",
    "[nodemon] restarting due to changes...",
    "[nodemon] starting `node src/main.js`",
    "SyntaxError: Unexpected token ';'",
    "Node.js v24.16.0",
    "[nodemon] app crashed - waiting for file changes before starting...",
    "[nodemon] restarting due to changes...",
    "[nodemon] starting `node src/main.js`",
    "APP_READY v3",
    "[nodemon] restarting due to changes...",
    "[nodemon] starting `node src/main.js`",
    "APP_READY v5"
  ]
}
```

PIDs and the reserved port vary. The stable oracle is exact command, response
sequence on one port, syntax crash/recovery, final `v5` without a `v4`
readiness wait, one live app descendant, exit 130, empty descendant search, and
closed port after SIGINT.
