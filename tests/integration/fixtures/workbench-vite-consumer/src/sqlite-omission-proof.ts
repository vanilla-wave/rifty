import {
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

const probe = `
function sqliteFailure() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    new DatabaseSync(':memory:');
    throw new Error('SQLite unexpectedly available');
  } catch (error) {
    if (!error.message.includes('deployment.wasm.sqlite')) throw error;
    return 'missing deployment.wasm.sqlite';
  }
}
module.exports = sqliteFailure;
`;

const recursive = `
const { execSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const sqliteFailure = require('./sqlite-probe.cjs');
module.exports = async function prove() {
  const direct = sqliteFailure();
  const child = execSync('node sqlite-leaf.cjs', {
    env: { RIFTY_SQLITE_WASM_URL: '/guest-sqlite-must-not-load.wasm' },
  }).toString().trim();
  const worker = new Worker('/sqlite-thread.cjs', {
    env: { RIFTY_SQLITE_WASM_URL: '/guest-sqlite-must-not-load.wasm' },
  });
  const threaded = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error('worker exited before proof: ' + code)));
  });
  await worker.terminate();
  return { direct, child, threaded };
};
`;

export async function proveSqliteOmission(
  options: PlaygroundWorkbenchOptions,
  snapshot: {
    readonly packageJsonText: string;
    readonly snapshotId: string;
    readonly templateId: string;
  },
): Promise<void> {
  const workbench = await openPlaygroundWorkbench({
    ...options,
    deployment: { ...options.deployment, wasm: {} },
  });
  const definition = workbench.playground.define({
    kind: 'node-server',
    starterId: 'packed-no-sqlite',
    templateId: snapshot.templateId,
    firstMaterialization: {
      kind: 'snapshot',
      snapshot: {
        snapshotId: snapshot.snapshotId,
        templateId: snapshot.templateId,
        assetUrl: new URL('/producer-vite-snapshot.tar.gz', location.href).href,
      },
    },
    id: 'scratch',
    entryPath: '/server.cjs',
    port: 3459,
    files: {
      '/package.json': snapshot.packageJsonText,
      '/sqlite-probe.cjs': probe,
      '/sqlite-leaf.cjs': "console.log(require('./sqlite-probe.cjs')());",
      '/sqlite-thread.cjs': `
const { parentPort } = require('node:worker_threads');
const { execSync } = require('node:child_process');
parentPort.postMessage({
  direct: require('./sqlite-probe.cjs')(),
  nested: execSync('node sqlite-leaf.cjs', { env: {} }).toString().trim(),
});`,
      '/recursive.cjs': recursive,
      '/terminal.cjs':
        "require('./recursive.cjs')().then(proof => console.log(JSON.stringify(proof)));",
      '/server.cjs': `
require('./recursive.cjs')().then(proof => {
  require('node:http').createServer((req, res) => res.end(JSON.stringify(proof))).listen(3459);
});`,
    },
  });
  await workbench.playground.catalog.createScratch({ definition });
  const project = await workbench.openProject(definition);
  const expected = JSON.stringify({
    direct: 'missing deployment.wasm.sqlite',
    child: 'missing deployment.wasm.sqlite',
    threaded: {
      direct: 'missing deployment.wasm.sqlite',
      nested: 'missing deployment.wasm.sqlite',
    },
  });
  const terminal = project.terminals.open();
  let output = '';
  const detach = terminal.attach((chunk) => {
    output += chunk;
  });
  try {
    const command = terminal.run('node terminal.cjs');
    try {
      const exit = await command.exited;
      await command.close();
      if (exit.code !== 0 || !output.includes(expected))
        throw new Error(`No-SQLite recursive Node proof: ${JSON.stringify({ exit, output })}`);
    } finally {
      await command.close();
    }
    const run = project.run();
    try {
      const preview = await run.ready;
      const response = await fetch(preview.url);
      const body = await response.text();
      if (!response.ok || body !== expected)
        throw new Error(`No-SQLite dev-server proof: ${response.status} ${body}`);
    } finally {
      await run.close();
    }
  } finally {
    detach();
    await terminal.close();
    await project.close();
    await workbench.close();
  }
}
