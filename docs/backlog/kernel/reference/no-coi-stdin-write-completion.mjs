// Run against the repository no-COI dev host; exit 1 records the known mismatch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const origin = process.argv[2];
if (!origin) throw new Error('usage: node no-coi-stdin-write-completion.mjs <dev-origin>');
const cases = [
  {
    name: 'delayed reader',
    source:
      "const fs=require('node:fs');\nfs.writeFileSync('child.cjs',\"setTimeout(()=>{require('node:fs').writeFileSync('child-reading','yes');process.stdin.on('data',()=>{});},100)\");\nconst c=require('node:child_process').spawn(process.execPath,['child.cjs'],{stdio:['pipe','ignore','ignore']});\nc.unref();c.stdin.unref();let called=false,marker=false;c.stdin.on('error',()=>{});\nc.stdin.write(Buffer.alloc(8*1024*1024,65),()=>{called=true;marker=fs.existsSync('child-reading');c.stdin.end();});\nprocess.on('exit',()=>console.log(JSON.stringify({called,marker})));",
  },
  {
    name: 'peer exits without reading',
    source:
      "const fs=require('node:fs');\nfs.writeFileSync('child.cjs',\"setTimeout(()=>process.exit(0),100)\");\nconst c=require('node:child_process').spawn(process.execPath,['child.cjs'],{stdio:['pipe','ignore','ignore']});\nc.unref();let callback='none';const errors=[];c.stdin.on('error',e=>errors.push(e.code));\nc.stdin.write(Buffer.alloc(8*1024*1024,65),e=>{callback=e?e.code:null;});\nprocess.on('exit',()=>console.log(JSON.stringify({callback,errors})));",
  },
];
const browser = await chromium.launch();
let mismatches = 0;
try {
  for (const { name, source } of cases) {
    const directory = mkdtempSync(join(tmpdir(), 'rifty-stdin-oracle-'));
    let oracle;
    try {
      writeFileSync(join(directory, 'probe.cjs'), source);
      const result = spawnSync(process.execPath, ['probe.cjs'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 20000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0);
      oracle = {
        status: 'exited',
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    const page = await browser.newPage();
    try {
      await page.goto(new URL('/no-coi-harness.html', origin).href);
      const actual = await page.evaluate(
        async ({ root, source }) => {
          if (crossOriginIsolated) throw new Error('probe requires no-COI');
          const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          const sandbox = await createSandbox({
            requireCrossOriginIsolation: false,
            serviceWorkerUrl: '/sw.js',
            storage: { persistence: 'ephemeral' },
            toolchain: {
              workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            },
          });
          try {
            await sandbox.fs.writeFile('/probe/probe.cjs', source);
            return await sandbox.project({ root: '/probe' }).run('node probe.cjs').completion;
          } finally {
            sandbox.dispose();
          }
        },
        { root: process.cwd(), source },
      );
      const observed = {
        status: actual.status,
        exitCode: actual.exitCode,
        stdout: actual.stdout,
        stderr: actual.stderr,
      };
      console.log(JSON.stringify({ name, node: process.version, oracle, actual: observed }));
      try {
        assert.deepEqual(observed, oracle);
      } catch {
        mismatches++;
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exitCode = mismatches === 0 ? 0 : 1;
