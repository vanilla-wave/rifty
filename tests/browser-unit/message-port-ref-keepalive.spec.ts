import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import {
  messagePortRefCases,
  portRows,
  runNodeOracle,
  runOwnerCommand,
} from './fixtures/message-port-ref-cases.ts';

// ADR-0447: a referenced MessagePort is a counted child-realm keepalive handle.
// Each case runs verbatim in real Node (live oracle) and as rifty `node main.cjs`.
for (const fixture of messagePortRefCases) {
  test(`MessagePort reference matches Node: ${fixture.name}`, async ({ page }) => {
    const oracle = await runNodeOracle(fixture.source);
    expect(oracle.code, oracle.stderr).toBe(0);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-port-ref-${fixture.name}`,
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    try {
      // `node` needs the package-tree readiness stamp that an install publishes.
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/main.cjs', fixture.source);
      const run = await runOwnerCommand(page, 'node main.cjs', 10_000);
      expect(run.timedOut, run.out).toBe(false);
      expect(portRows(run.out), run.out).toEqual(portRows(oracle.stdout));
      expect(run.exit, run.out).toBe(oracle.code);
    } finally {
      await closeOwner(page);
    }
  });
}

// Real package, the wall `vitest run` drains on (vite 8 bundles its config through
// this API): a detached rolldown build holds no handle but emnapi's referenced port.
// Node artifacts (NAPI_RS_FORCE_WASI=1, v24.16.0, rolldown 1.0.3 wasm32-wasi,
// @emnapi/runtime 1.10.0), same sources: docs/backlog/runtime-js/reference/
// message-port-ref-keepalive-evidence.md §Real package.
const ROLLDOWN_SOURCES = {
  '/scratch/src/entry.js': 'export const answer = 6 * 7;\nconsole.log(answer);\n',
  '/scratch/rolldown-awaited.mjs': `import { rolldown } from 'rolldown';
const bundle = await rolldown({ input: './src/entry.js', logLevel: 'silent' });
const out = await bundle.generate({ format: 'esm' });
console.log('ROLLDOWN|awaited|chunks=' + out.output.length + '|entry=' + out.output[0].fileName);
`,
  '/scratch/rolldown-detached.mjs': `import { rolldown } from 'rolldown';
console.log('ROLLDOWN|start');
rolldown({ input: './src/entry.js', logLevel: 'silent' })
  .then((bundle) => bundle.generate({ format: 'esm' }))
  .then((out) => console.log('ROLLDOWN|chunks=' + out.output.length + '|entry=' + out.output[0].fileName + '|code=' + JSON.stringify(out.output[0].code)));
`,
} as const;
const ROLLDOWN_AWAITED_NODE_ROWS = ['ROLLDOWN|awaited|chunks=1|entry=entry.js'];
const ROLLDOWN_DETACHED_NODE_ROWS = [
  'ROLLDOWN|start',
  'ROLLDOWN|chunks=1|entry=entry.js|code="//#region src/entry.js\\nconst answer = 42;\\nconsole.log(42);\\n//#endregion\\nexport { answer };\\n"',
];

function rolldownRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('ROLLDOWN|'));
}

test('detached rolldown build on the vite 8 template completes as under Node', async ({ page }) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-port-ref-rolldown-detached',
    template: 'vite8',
    setup: 'instant',
    persistence: 'ephemeral',
  });
  try {
    for (const [path, content] of Object.entries(ROLLDOWN_SOURCES)) {
      await writeOwnerFile(page, path, content);
    }
    // Precondition: the binding loads and bundles when top-level await holds the
    // entry, so the detached run below can fail only on the drained wait.
    const awaited = await runOwnerCommand(
      page,
      'NAPI_RS_FORCE_WASI=1 node rolldown-awaited.mjs',
      120_000,
    );
    expect(awaited.timedOut, awaited.out).toBe(false);
    expect(rolldownRows(awaited.out), awaited.out).toEqual(ROLLDOWN_AWAITED_NODE_ROWS);
    expect(awaited.exit, awaited.out).toBe(0);

    const detached = await runOwnerCommand(
      page,
      'NAPI_RS_FORCE_WASI=1 node rolldown-detached.mjs',
      120_000,
    );
    expect(detached.timedOut, detached.out).toBe(false);
    expect(rolldownRows(detached.out), `exit=${detached.exit}\n${detached.out}`).toEqual(
      ROLLDOWN_DETACHED_NODE_ROWS,
    );
    expect(detached.exit, detached.out).toBe(0);
  } finally {
    await closeOwner(page);
  }
});
