import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

const probes = {
  'fd output ignores public stream method replacement': `const fs=require('fs');
const write=process.stdout.write;process.stdout.write=()=>true;
fs.writeSync(1,'descriptor');process.stdout.write=write;
fs.writeFileSync('result.json','{}');`,
  'sync stdin and EOF': `const fs=require('fs'),b=Buffer.alloc(2);
const n=fs.readSync(0,b,0,2,null);const tail=fs.readFileSync(0,'utf8');
const eof=fs.readFileSync(0,'utf8');fs.closeSync(0);let closed;
try{fs.readSync(0,b,0,1,null)}catch(e){closed=e.code;}
fs.writeFileSync('result.json',JSON.stringify({head:b.toString('utf8',0,n),tail,eof,closed}));`,
  'async fd shares stdin with stream': `const fs=require('fs'),b=Buffer.alloc(2);
fs.read(0,b,0,2,null,(err,n,buffer)=>{
if(err)throw err;let tail='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>tail+=chunk);
process.stdin.on('end',()=>fs.writeFileSync('result.json',JSON.stringify({head:buffer.toString('utf8',0,n),tail})));
});`,
  'stdio fstat and ordered writes': `const fs=require('fs');
const stats=[0].map(fd=>{const s=fs.fstatSync(fd);return [s.isFIFO(),s.isFile(),s.isCharacterDevice(),s.mode & 0o170000]});
const n=fs.writeSync(1,'OUT');process.stdout.write('NEXT');
fs.write(1,Buffer.from('END'),0,3,null,(err,count)=>{
if(err)throw err;fs.writeFileSync('result.json',JSON.stringify({stats,n,count}));
});`,
};
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
for (const [name, source] of Object.entries(probes)) {
  test(`stdio fd parity: ${name}`, async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-stdio-fd-'));
    writeFileSync(join(root, 'probe.cjs'), source);
    // Real shell pipes on both sides; spawn's socketpair would be a different fstat oracle.
    execFileSync(
      'sh',
      ['-c', `printf 'abcd\\n' | ${quote(process.execPath)} probe.cjs | cat > output`],
      { cwd: root, timeout: 10_000 },
    );
    const oracle = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
    const output = readFileSync(join(root, 'output'), 'utf8');
    rmSync(root, { recursive: true, force: true });
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-fs-stdio-${name.replaceAll(' ', '-')}`,
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
      const run = await execLine(page, 'echo abcd | node probe.cjs | cat > output');
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
