import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import fixture from '../../tools/node-parity-runner/cases/child_process/public-ipc-advanced-proxy.case.ts';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

test('advanced fork IPC rejects Proxy without traps and keeps nonbinary control/getter semantics', async ({
  page,
}) => {
  const oracle = await runInNode(fixture);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'browser-unit-advanced-ipc-proxy',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    for (const [path, source] of Object.entries(fixture.setup?.files ?? {})) {
      await writeOwnerFile(page, `/scratch/${path.replace(/^project\//, '')}`, source);
    }
    await writeOwnerFile(page, '/scratch/proxy-parent.cjs', fixture.code);
    const actual = await execLine(page, 'node proxy-parent.cjs');
    expect(actual.exit, actual.out).toBe(0);
    expect(stripVTControlCharacters(actual.out).replaceAll('\r', '').trim()).toBe(oracle.trim());
  } finally {
    await closeOwner(page);
  }
});

const cloneErrors = `
  function cloneErrors(send) {
    const traps = [];
    const handler = {
      get() { traps.push('get'); }, ownKeys() { traps.push('ownKeys'); return []; },
      getPrototypeOf() { traps.push('getPrototypeOf'); return null; },
    };
    const revoked = Proxy.revocable({}, handler); revoked.revoke();
    const shapes = [];
    for (const value of [() => {}, Symbol('x'), new WeakMap(), Promise.resolve(1),
      new Proxy({}, handler), Proxy.revocable({}, handler).proxy, revoked.proxy]) {
      try { send({ bad: value }); shapes.push(['NO_THROW']); }
      catch (error) { shapes.push([error.name, error.code ?? null, error instanceof DOMException]); }
    }
    const renamed = new Error('guest'); renamed.name = 'DataCloneError';
    let nativeCloneError;
    try { structuredClone(() => {}); } catch (error) { nativeCloneError = error; }
    const getters = [];
    for (const sentinel of [renamed, nativeCloneError]) {
      let reads = 0;
      try { send({ get value() { reads++; throw sentinel; } }); getters.push(['NO_THROW']); }
      catch (error) { getters.push([error === sentinel, reads]); }
    }
    return { shapes, getters, traps };
  }
`;
const errorShapeFixture = {
  kind: 'child-worker' as const,
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/clone-error-child.cjs': `
        ${cloneErrors}
        const seen = [];
        process.on('message', message => {
          seen.push(message.tag);
          if (message.tag === 'control') process.send({ tag: 'done', seen, connected: process.connected });
        });
        process.send({ tag: 'ready', outcome: cloneErrors(value => process.send(value)) });
        setInterval(() => {}, 1000);
      `,
    },
  },
  code: `
    ${cloneErrors}
    const { fork } = require('node:child_process');
    const child = fork('clone-error-child.cjs', [], { serialization: 'advanced', stdio: 'pipe' });
    const result = { seen: [] };
    child.on('error', error => { console.error(error); process.exit(1); });
    child.on('message', message => {
      result.seen.push(message.tag);
      if (message.tag === 'ready') {
        result.child = message.outcome;
        result.parent = cloneErrors(value => child.send(value));
        result.connected = child.connected;
        child.send({ tag: 'control' });
      }
      if (message.tag === 'done') {
        result.childSeen = message.seen;
        result.childConnected = message.connected;
        child.once('exit', () => console.log(JSON.stringify(result)));
        child.kill('SIGUSR2');
      }
    });
  `,
};

function expectedCloneErrors(shape: readonly unknown[]) {
  const outcome = {
    shapes: Array.from({ length: 7 }, () => shape),
    getters: [
      [true, 1],
      [true, 1],
    ],
    traps: [],
  };
  return {
    seen: ['ready', 'done'],
    child: outcome,
    parent: outcome,
    connected: true,
    childSeen: ['control'],
    childConnected: true,
  };
}

test('advanced IPC exposes platform clone errors and preserves getter-thrown error identity in both senders', async ({
  page,
}) => {
  // Deliberate platform distinction: assert each actual shape, never normalize it away.
  expect(JSON.parse((await runInNode(errorShapeFixture)).trim())).toEqual(
    expectedCloneErrors(['Error', null, false]),
  );
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'browser-unit-advanced-ipc-clone-errors',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    for (const [path, source] of Object.entries(errorShapeFixture.setup.files)) {
      await writeOwnerFile(page, `/scratch/${path.replace(/^project\//, '')}`, source);
    }
    await writeOwnerFile(page, '/scratch/clone-error-parent.cjs', errorShapeFixture.code);
    const actual = await execLine(page, 'node clone-error-parent.cjs');
    expect(actual.exit, actual.out).toBe(0);
    expect(JSON.parse(stripVTControlCharacters(actual.out).replaceAll('\r', '').trim())).toEqual(
      expectedCloneErrors(['DataCloneError', 25, true]),
    );
  } finally {
    await closeOwner(page);
  }
});
