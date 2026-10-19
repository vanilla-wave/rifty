import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

const probes = {
  'file stdout captures fs write on first access': `const fs=require('fs'),original=fs.writeSync,events=[];
fs.writeSync=(fd,bytes,...args)=>{events.push(fd);return original(fd,bytes,...args)};
process.stdout.write('payload',()=>fs.writeFileSync('result.json',JSON.stringify(events)));`,
  'preinitialized file stdout retains the original fs write': `const fs=require('fs'),original=fs.writeSync,events=[];
void process.stdout;
fs.writeSync=(fd,bytes,...args)=>{events.push(fd);return original(fd,bytes,...args)};
process.stdout.write('payload',()=>fs.writeFileSync('result.json',JSON.stringify(events)));`,
  'file stdout serializes reentrant writes': `const fs=require('fs'),original=fs.writeSync,events=[];let calls=0;
fs.writeSync=(fd,bytes,...args)=>{
if(fd!==1)return original(fd,bytes,...args);
events.push('start:'+ ++calls);
if(calls<3)process.stdout.write(bytes);else original(fd,bytes,...args);
events.push('end:'+calls);return bytes.length;
};
process.stdout.write('payload',()=>fs.writeFileSync('result.json',JSON.stringify(events)));`,
};
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
for (const [name, source] of Object.entries(probes)) {
  test(`file stdout parity: ${name}`, async ({ page }) => {
    test.fail(!name.startsWith('preinitialized'), 'lazy file stdout remains RED');
    const root = mkdtempSync(join(tmpdir(), 'rifty-file-stdout-'));
    writeFileSync(join(root, 'probe.cjs'), source);
    // Real redirected file descriptors; no pipe-to-file substitution.
    execFileSync('sh', ['-c', `${quote(process.execPath)} probe.cjs > output`], {
      cwd: root,
      timeout: 10_000,
    });
    const oracle = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
    const output = readFileSync(join(root, 'output'), 'utf8');
    rmSync(root, { recursive: true, force: true });
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-file-stdout-${name.replaceAll(' ', '-')}`,
      persistence: 'ephemeral',
      plan: {
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'stdio-fd',
        templateId: 'browser-unit:stdio-fd',
        files: { '/package.json': '{"name":"stdio-fd","private":true}', '/probe.cjs': source },
        firstMaterialization: { kind: 'install' },
        entryPath: '/probe.cjs',
      },
    });
    try {
      const run = await execLine(page, 'node probe.cjs > output');
      expect(run.exit, run.out).toBe(0);
      const result = await readOwnerFile(page, '/scratch/result.json');
      expect(result.ok, `${run.out}\n${result.error}`).toBe(true);
      expect(JSON.parse(result.text)).toEqual(oracle);
      const actual = await readOwnerFile(page, '/scratch/output');
      expect(actual.ok, actual.error).toBe(true);
      expect(actual.text).toBe(output);
    } finally {
      await closeOwner(page);
    }
  });
}
