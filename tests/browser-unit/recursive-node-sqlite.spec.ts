import { Worker as NodeWorker } from 'node:worker_threads';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  execLineUntil,
  gotoHarness,
  runDefaultProjectOnce,
  writeOwnerFile,
} from './fixtures.ts';

const MISSING_RUNTIME_CONFIG_ERROR = 'node-entry worker bootstrap config is not configured';
const MUST_NOT_LOAD_BOOTSTRAP_PATH = '/__recursive-node-bootstrap-must-not-load__.js';

interface WorkerContextOracle {
  readonly env: string;
  readonly envKeys: readonly string[];
  readonly parentAbsent: boolean;
  readonly cwdInherited: boolean;
  readonly data: number;
}

function nodeServerPlan(
  starterId: string,
  port: number,
  files: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    kind: 'node-server',
    id: 'scratch',
    starterId,
    templateId: `browser-unit:${starterId}`,
    files: Object.freeze({
      '/package.json': `${JSON.stringify({
        name: starterId,
        private: true,
        type: 'module',
      })}\n`,
      ...files,
    }),
    firstMaterialization: Object.freeze({ kind: 'install' }),
    entryPath: '/server.mjs',
    port,
  });
}

function nativeWorkerContextOracle(): Promise<WorkerContextOracle> {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(
      `const { parentPort, workerData } = require('node:worker_threads');
parentPort.postMessage({
  env: process.env.CONTEXT_SENTINEL,
  envKeys: Object.keys(process.env).sort(),
  parentAbsent: process.env.PARENT_ONLY === undefined,
  cwdInherited: process.cwd() === workerData.parentCwd,
  data: workerData.answer,
});`,
      {
        eval: true,
        env: { CONTEXT_SENTINEL: 'worker-exact' },
        workerData: { answer: 42, parentCwd: process.cwd() },
      },
    );
    worker.once('message', (message: WorkerContextOracle) => resolve(message));
    worker.once('error', reject);
  });
}

test('execSync child inherits exact context and initializes node:sqlite before entry', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-recursive-node-sqlite',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(
      page,
      '/scratch/sqlite-child.mjs',
      `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('sqlite-ready');");
const row = db.prepare('SELECT value FROM values_table').get();
process.stdout.write(
  'NESTED_SQLITE|' + row.value + '|cwd=' + process.cwd() + '|env=' + process.env.CONTEXT_SENTINEL + '\\n',
);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/sqlite-parent.mjs',
      `import { execSync } from 'node:child_process';
const stdout = execSync('node sqlite-child.mjs', {
  cwd: '/',
  env: { CONTEXT_SENTINEL: 'exact-child' },
});
process.stdout.write(stdout);
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });

    const result = await execLine(page, 'node sqlite-parent.mjs');
    expect(result.exit, result.out).toBe(0);
    expect(result.out).toContain('NESTED_SQLITE|sqlite-ready|cwd=/|env=exact-child');
  } finally {
    await closeOwner(page);
  }
});

test('kernel Worker matches Node context and relays owner FS, execSync, and sqlite', async ({
  page,
}) => {
  const oracle = await nativeWorkerContextOracle();
  expect(oracle).toEqual({
    env: 'worker-exact',
    envKeys: ['CONTEXT_SENTINEL'],
    parentAbsent: true,
    cwdInherited: true,
    data: 42,
  });

  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-recursive-worker-runtime',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(page, '/scratch/worker-data.txt', 'owner-file\n');
    await writeOwnerFile(
      page,
      '/scratch/worker-grandchild.mjs',
      `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('grandchild-sqlite');");
const row = db.prepare('SELECT value FROM values_table').get();
process.stdout.write(row.value + ':' + process.env.GRAND_SENTINEL);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/worker-child.mjs',
      `import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('worker-sqlite');");
const row = db.prepare('SELECT value FROM values_table').get();
const nested = execSync('node worker-grandchild.mjs', {
  cwd: process.cwd(),
  env: { GRAND_SENTINEL: 'grand-exact' },
}).toString();
parentPort.postMessage({
  env: process.env.CONTEXT_SENTINEL,
  envKeys: Object.keys(process.env).sort(),
  parentAbsent: process.env.PARENT_ONLY === undefined,
  cwd: process.cwd(),
  data: workerData.answer,
  file: readFileSync('worker-data.txt', 'utf8').trim(),
  sqlite: row.value,
  nested,
});
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/worker-parent.mjs',
      `import { Worker } from 'node:worker_threads';

process.env.PARENT_ONLY = 'parent';
const parentCwd = process.cwd();
const worker = new Worker(new URL('./worker-child.mjs', import.meta.url), {
  env: { CONTEXT_SENTINEL: 'worker-exact' },
  workerData: { answer: 42 },
});
const message = await new Promise((resolve, reject) => {
  let received = false;
  worker.once('message', (value) => {
    received = true;
    resolve(value);
  });
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (!received) reject(new Error('worker exited before message: ' + code));
  });
});
process.stdout.write(
  'WORKER_RELAY' +
    '|env=' + message.env +
    '|envKeys=' + message.envKeys.join(',') +
    '|parentAbsent=' + message.parentAbsent +
    '|cwdInherited=' + (message.cwd === parentCwd) +
    '|cwd=' + message.cwd +
    '|data=' + message.data +
    '|file=' + message.file +
    '|sqlite=' + message.sqlite +
    '|nested=' + message.nested + '\\n',
);
await worker.terminate();
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });

    const result = await execLine(page, 'node worker-parent.mjs');
    expect(result.exit, result.out).toBe(0);
    expect(result.out).toContain(
      `WORKER_RELAY|env=${oracle.env}|envKeys=${oracle.envKeys.join(',')}|parentAbsent=${oracle.parentAbsent}|cwdInherited=${oracle.cwdInherited}|cwd=/|data=${oracle.data}|file=owner-file|sqlite=worker-sqlite|nested=grandchild-sqlite:grand-exact`,
    );
  } finally {
    await closeOwner(page);
  }
});

// ADR-0326 acceptance: this is deliberately a Workbench terminal probe rather
// than a unit seam. The supervisor, fork child, and grandchild must be three
// physical Worker realms joined to the owner's one live project namespace.
test('real fork Worker crosses owner FS, launch context, recursive IPC, and disconnect control', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-real-fork-worker-boundary',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(
      page,
      '/scratch/plain-spawn.mjs',
      `import { readFileSync, writeFileSync } from 'node:fs';

writeFileSync('/plain-spawn.bin', new Uint8Array([3, 2, 1, 0]));
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    plain: process.env.PLAIN_ONLY,
    inherited: process.env.INHERITED_ONLY ?? null,
  },
  ownerBytes: [...readFileSync('/fork-parent.bin')],
  publicIpc: {
    send: typeof process.send,
    disconnect: typeof process.disconnect,
    connected: typeof process.connected,
    channel: typeof process.channel,
  },
}) + '\\n');
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/fork-inherited.mjs',
      `process.send({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  inherited: process.env.INHERITED_ONLY,
  parentRealmLeaked: globalThis.__forkParentRealm === true,
});
process.disconnect();
setTimeout(() => process.exit(0), 0);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/fork-grandchild.mjs',
      `import { readFileSync, writeFileSync } from 'node:fs';

process.once('message', (message) => {
  const ownerBytes = [...readFileSync('/fork-parent.bin')];
  writeFileSync('/fork-grandchild.bin', new Uint8Array([0, 127, 128, 255]));
  process.send({
    echo: message,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: {
      grand: process.env.GRAND_ONLY,
      child: process.env.CHILD_ONLY ?? null,
      inherited: process.env.INHERITED_ONLY ?? null,
    },
    ownerBytes,
    parentRealmLeaked: globalThis.__forkParentRealm === true,
    childRealmLeaked: globalThis.__forkChildRealm === true,
  });
});
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/fork-child.mjs',
      `import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

globalThis.__forkChildRealm = true;
process.once('message', (message) => {
  const grandchild = fork('./fork-grandchild.mjs', ['grand-argv', 'λ'], {
    cwd: process.cwd(),
    env: { GRAND_ONLY: 'grand-replacement' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const grandchildExit = new Promise((resolve, reject) => {
    grandchild.once('error', reject);
    grandchild.once('exit', (code, signal) => resolve({ code, signal }));
  });
  grandchild.once('message', async (grandchildMessage) => {
    const exit = await grandchildExit;
    writeFileSync('/fork-child.bin', new Uint8Array([255, 128, 127, 0]));
    process.send({
      echo: message,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      env: {
        child: process.env.CHILD_ONLY,
        inherited: process.env.INHERITED_ONLY ?? null,
      },
      ownerBytes: [...readFileSync('/fork-parent.bin')],
      parentRealmLeaked: globalThis.__forkParentRealm === true,
      grandchild: { message: grandchildMessage, exit },
    });
    process.disconnect();
    setTimeout(() => {
      writeFileSync('/fork-after-disconnect.bin', new Uint8Array([9, 8, 7, 6]));
      process.exit(0);
    }, 20);
  });
  grandchild.send({ direction: 'child-to-grandchild', text: 'π\\u0000終' });
});
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/fork-parent.mjs',
      `import { fork, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

globalThis.__forkParentRealm = true;
process.env.INHERITED_ONLY = 'must-not-survive-replacement';
writeFileSync('/fork-parent.bin', new Uint8Array([0, 1, 127, 128, 254, 255]));

const plain = spawn('node', ['./plain-spawn.mjs', 'plain-argv'], {
  cwd: '/scratch',
  env: { PLAIN_ONLY: 'plain-replacement' },
});
let plainOut = '';
let plainErr = '';
const plainEvents = [];
plain.stdout.on('data', (chunk) => {
  plainEvents.push('stdout');
  plainOut += Buffer.from(chunk).toString('utf8');
});
plain.stderr.on('data', (chunk) => {
  plainEvents.push('stderr');
  plainErr += Buffer.from(chunk).toString('utf8');
});
const plainSurface = {
  stdin: plain.stdin === null ? 'null' : 'stream',
  stdout: plain.stdout === null ? 'null' : 'stream',
  stderr: plain.stderr === null ? 'null' : 'stream',
  send: typeof plain.send,
  disconnect: typeof plain.disconnect,
  connected: typeof plain.connected,
  channel: typeof plain.channel,
};
const plainOutcome = await new Promise((resolve, reject) => {
  plain.once('error', reject);
  plain.once('exit', (code, signal) => plainEvents.push('exit:' + code + '/' + signal));
  plain.once('close', (code, signal) => {
    plainEvents.push('close:' + code + '/' + signal);
    resolve({ code, signal });
  });
});

const inheritedChild = fork('./fork-inherited.mjs', ['inherited-argv'], {
  cwd: '/scratch',
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
const inheritedOutcome = await new Promise((resolve, reject) => {
  let message;
  inheritedChild.once('error', reject);
  inheritedChild.once('message', (value) => {
    message = value;
  });
  inheritedChild.once('close', (code, signal) => resolve({ message, code, signal }));
});

const child = fork('./fork-child.mjs', ['child-argv', 'β'], {
  cwd: '/scratch',
  env: { CHILD_ONLY: 'child-replacement' },
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
const events = [];
const outcome = await new Promise((resolve, reject) => {
  let message;
  child.once('error', reject);
  child.once('message', (value) => {
    events.push('message');
    message = value;
  });
  child.once('disconnect', () => events.push('disconnect'));
  child.once('exit', (code, signal) => events.push('exit:' + code + '/' + signal));
  child.once('close', (code, signal) => {
    events.push('close:' + code + '/' + signal);
    resolve({ message, code, signal });
  });
  child.send({ direction: 'parent-to-child', text: 'π\\u0000終' });
});

console.log('REAL_FORK_BOUNDARY|' + JSON.stringify({
  plain: {
    outcome: plainOutcome,
    surface: plainSurface,
    events: plainEvents,
    stdout: plainOut,
    stderr: plainErr,
    bytes: [...readFileSync('/plain-spawn.bin')],
  },
  inheritedOutcome,
  outcome,
  events,
  childBytes: [...readFileSync('/fork-child.bin')],
  grandchildBytes: [...readFileSync('/fork-grandchild.bin')],
  afterDisconnectBytes: [...readFileSync('/fork-after-disconnect.bin')],
}));
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });
    const result = await execLine(page, 'node fork-parent.mjs');
    expect(result.exit, result.out).toBe(0);

    const line = result.out
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith('REAL_FORK_BOUNDARY|'));
    expect(line, result.out).toBeDefined();
    const observed = JSON.parse(line?.slice('REAL_FORK_BOUNDARY|'.length) ?? '') as {
      readonly plain: {
        readonly outcome: { readonly code: number | null; readonly signal: string | null };
        readonly surface: Readonly<Record<string, string>>;
        readonly events: readonly string[];
        readonly stdout: string;
        readonly stderr: string;
        readonly bytes: readonly number[];
      };
      readonly inheritedOutcome: {
        readonly message: {
          readonly argv: readonly string[];
          readonly cwd: string;
          readonly inherited: string;
          readonly parentRealmLeaked: boolean;
        };
        readonly code: number | null;
        readonly signal: string | null;
      };
      readonly outcome: {
        readonly message: {
          readonly echo: unknown;
          readonly argv: readonly string[];
          readonly cwd: string;
          readonly env: Readonly<Record<string, string | null>>;
          readonly ownerBytes: readonly number[];
          readonly parentRealmLeaked: boolean;
          readonly grandchild: {
            readonly message: {
              readonly echo: unknown;
              readonly argv: readonly string[];
              readonly cwd: string;
              readonly env: Readonly<Record<string, string | null>>;
              readonly ownerBytes: readonly number[];
              readonly parentRealmLeaked: boolean;
              readonly childRealmLeaked: boolean;
            };
            readonly exit: { readonly code: number | null; readonly signal: string | null };
          };
        };
        readonly code: number | null;
        readonly signal: string | null;
      };
      readonly events: readonly string[];
      readonly childBytes: readonly number[];
      readonly grandchildBytes: readonly number[];
      readonly afterDisconnectBytes: readonly number[];
    };

    expect(observed).toEqual({
      plain: {
        outcome: { code: 0, signal: null },
        surface: {
          stdin: 'stream',
          stdout: 'stream',
          stderr: 'stream',
          send: 'undefined',
          disconnect: 'undefined',
          connected: 'undefined',
          channel: 'undefined',
        },
        events: ['stdout', 'exit:0/null', 'close:0/null'],
        stdout: `${JSON.stringify({
          argv: ['plain-argv'],
          cwd: '/scratch',
          env: {
            plain: 'plain-replacement',
            inherited: null,
          },
          ownerBytes: [0, 1, 127, 128, 254, 255],
          publicIpc: {
            send: 'undefined',
            disconnect: 'undefined',
            connected: 'undefined',
            channel: 'undefined',
          },
        })}\n`,
        stderr: '',
        bytes: [3, 2, 1, 0],
      },
      inheritedOutcome: {
        message: {
          argv: ['inherited-argv'],
          cwd: '/scratch',
          inherited: 'must-not-survive-replacement',
          parentRealmLeaked: false,
        },
        code: 0,
        signal: null,
      },
      outcome: {
        message: {
          echo: { direction: 'parent-to-child', text: 'π\u0000終' },
          argv: ['child-argv', 'β'],
          cwd: '/scratch',
          env: {
            child: 'child-replacement',
            inherited: null,
          },
          ownerBytes: [0, 1, 127, 128, 254, 255],
          parentRealmLeaked: false,
          grandchild: {
            message: {
              echo: { direction: 'child-to-grandchild', text: 'π\u0000終' },
              argv: ['grand-argv', 'λ'],
              cwd: '/scratch',
              env: {
                grand: 'grand-replacement',
                child: null,
                inherited: null,
              },
              ownerBytes: [0, 1, 127, 128, 254, 255],
              parentRealmLeaked: false,
              childRealmLeaked: false,
            },
            exit: { code: 0, signal: null },
          },
        },
        code: 0,
        signal: null,
      },
      events: ['message', 'disconnect', 'exit:0/null', 'close:0/null'],
      childBytes: [255, 128, 127, 0],
      grandchildBytes: [0, 127, 128, 255],
      afterDisconnectBytes: [9, 8, 7, 6],
    });
  } finally {
    await closeOwner(page);
  }
});

// ADR-0326 acceptance: worker_threads shares its parent's process identity,
// while child_process owns a distinct PID row in the federated owner snapshot.
test('real worker thread stays outside ps while a child process is visible', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-worker-thread-process-table',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(
      page,
      '/scratch/process-table-thread.mjs',
      `import { parentPort, threadId } from 'node:worker_threads';

parentPort.postMessage({
  type: 'ready',
  threadId,
  pid: process.pid,
  ppid: process.ppid,
});
setInterval(() => {}, 1_000);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/process-table-child.mjs',
      `process.stdout.write(
  'PROCESS_CHILD_READY|' + JSON.stringify({
    pid: process.pid,
    ppid: process.ppid,
  }) + '\\n',
);
setInterval(() => {}, 1_000);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/process-table-parent.mjs',
      `import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';

function waitForClose(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function capture(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

const worker = new Worker(new URL('./process-table-thread.mjs', import.meta.url));
const workerReady = await new Promise((resolve, reject) => {
  worker.once('message', resolve);
  worker.once('error', reject);
});

const child = spawn('node', ['./process-table-child.mjs'], {
  cwd: '/scratch',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const childClose = waitForClose(child);
const childReady = await new Promise((resolve, reject) => {
  let stdout = '';
  child.once('error', reject);
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const line = stdout.split(/\\r?\\n/u).find((candidate) =>
      candidate.startsWith('PROCESS_CHILD_READY|'),
    );
    if (line !== undefined) {
      resolve(JSON.parse(line.slice('PROCESS_CHILD_READY|'.length)));
    }
  });
});

const ps = spawn('ps', ['-A', '-o', 'ppid,pid'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const snapshot = await capture(ps);

process.stdout.write(
  'WORKER_THREAD_PROCESS_TABLE|' + JSON.stringify({
    parent: { pid: process.pid, ppid: process.ppid },
    worker: {
      handleThreadId: worker.threadId,
      ready: workerReady,
    },
    child: {
      handlePid: child.pid,
      ready: childReady,
    },
    snapshot,
  }) + '\\n',
);

child.kill('SIGTERM');
await childClose;
await worker.terminate();
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });
    const result = await execLine(page, 'node process-table-parent.mjs');
    expect(result.exit, result.out).toBe(0);

    const line = result.out
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith('WORKER_THREAD_PROCESS_TABLE|'));
    expect(line, result.out).toBeDefined();
    const observed = JSON.parse(line?.slice('WORKER_THREAD_PROCESS_TABLE|'.length) ?? '') as {
      readonly parent: { readonly pid: number; readonly ppid: number };
      readonly worker: {
        readonly handleThreadId: number;
        readonly ready: {
          readonly type: string;
          readonly threadId: number;
          readonly pid: number;
          readonly ppid: number;
        };
      };
      readonly child: {
        readonly handlePid: number;
        readonly ready: { readonly pid: number; readonly ppid: number };
      };
      readonly snapshot: {
        readonly code: number | null;
        readonly signal: string | null;
        readonly stdout: string;
        readonly stderr: string;
      };
    };
    const rows = observed.snapshot.stdout
      .trim()
      .split(/\r?\n/u)
      .slice(1)
      .map((row) => row.trim().split(/\s+/u).map(Number))
      .map(([ppid, pid]) => ({ ppid, pid }));

    expect(observed.worker.ready).toEqual({
      type: 'ready',
      threadId: observed.worker.handleThreadId,
      pid: observed.parent.pid,
      ppid: observed.parent.ppid,
    });
    expect(observed.worker.handleThreadId).toBeGreaterThan(0);
    expect(observed.child.ready).toEqual({
      pid: observed.child.handlePid,
      ppid: observed.parent.pid,
    });
    expect(observed.snapshot).toMatchObject({
      code: 0,
      signal: null,
      stderr: '',
    });
    expect(rows).toContainEqual({
      ppid: observed.parent.ppid,
      pid: observed.parent.pid,
    });
    expect(rows).toContainEqual({
      ppid: observed.parent.pid,
      pid: observed.child.handlePid,
    });
    expect(rows.filter(({ pid }) => pid === observed.parent.pid)).toHaveLength(1);
  } finally {
    await closeOwner(page);
  }
});

// Fault class: sibling-drift — dev-server children must relay one project namespace
// for every nested Node mechanism, not only the node-entry bootstrap sibling.
test('node-server execSync relays the public project root to its nested child', async ({
  page,
}) => {
  const marker = 'DEV_EXEC_RELAY|exec-project-only';
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-dev-server-recursive-exec',
    plan: nodeServerPlan('bu-dev-server-recursive-exec', 3417, {
      '/exec-project-only.txt': 'exec-project-only\n',
      '/nested-exec.mjs': `import { readFileSync } from 'node:fs';
process.stdout.write(readFileSync('/exec-project-only.txt', 'utf8').trim());
`,
      '/server.mjs': `import { execSync } from 'node:child_process';
import { createServer } from 'node:http';

const nested = execSync('node nested-exec.mjs', { cwd: '/' }).toString();
createServer((_request, response) => response.end('ok')).listen(3417, () => {
  console.log('DEV_EXEC_RELAY|' + nested);
});
`,
    }),
  });

  try {
    const result = await execLineUntil(page, 'npm run dev', marker);
    expect(result.out).toContain(marker);
  } finally {
    await closeOwner(page);
  }
});

// Fault class: sibling-drift — worker_threads shares the same nested dispatcher
// contract as execSync, so both siblings need observable acceptance proof.
test('node-server worker_threads relays the public project root to its worker', async ({
  page,
}) => {
  const marker = 'DEV_WORKER_RELAY|worker-project-only';
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-dev-server-worker-thread',
    plan: nodeServerPlan('bu-dev-server-worker-thread', 3418, {
      '/worker-project-only.txt': 'worker-project-only\n',
      '/thread-child.mjs': `import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
parentPort.postMessage(readFileSync('/worker-project-only.txt', 'utf8').trim());
`,
      '/server.mjs': `import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./thread-child.mjs', import.meta.url));
const nested = await new Promise((resolve, reject) => {
  let settled = false;
  worker.once('message', (value) => {
    settled = true;
    resolve(value);
  });
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (!settled) reject(new Error('worker exited before message: ' + code));
  });
});
await worker.terminate();
createServer((_request, response) => response.end('ok')).listen(3418, () => {
  console.log('DEV_WORKER_RELAY|' + nested);
});
`,
    }),
  });

  try {
    const result = await execLineUntil(page, 'npm run dev', marker);
    expect(result.out).toContain(marker);
  } finally {
    await closeOwner(page);
  }
});

// Fault class: frozen-assumption — unit/fake-spawn cannot close the real SAB boundary.
test('real-COI execSync fails loud before recursive spawn when bootstrap config is URL-only', async ({
  page,
}) => {
  const bootstrapRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === MUST_NOT_LOAD_BOOTSTRAP_PATH) {
      bootstrapRequests.push(request.url());
    }
  });

  await gotoHarness(page);
  await page.evaluate(
    async ({ bootstrapPath }) => {
      const { runExecSyncHarness } = await import('/src/execsync-harness.ts');
      await runExecSyncHarness({
        fault: 'missing-node-entry-runtime-config',
        nodeEntryUrl: new URL(bootstrapPath, location.origin).href,
      });
    },
    { bootstrapPath: MUST_NOT_LOAD_BOOTSTRAP_PATH },
  );

  const harness = page.locator('[data-testid="execsync-harness"]');
  expect(bootstrapRequests, 'recursive node bootstrap must not be requested').toEqual([]);
  await expect(harness).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-testid="execsync-config-error"]')).toHaveText(
    `config-error: ${MISSING_RUNTIME_CONFIG_ERROR}`,
  );
});
