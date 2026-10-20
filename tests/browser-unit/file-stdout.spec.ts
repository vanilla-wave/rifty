import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

const probes = {
  'file console retains its first stream': `const fs=require('fs'),console=require('console'),events=[];
console.log('first');Object.defineProperty(process,'stdout',{value:{write(){events.push('replacement')}}});
console.log('second');fs.writeFileSync('result.json',JSON.stringify(events));`,
  'file write failure keeps callback and error order': `const fs=require('fs'),events=[];
fs.writeSync=()=>{throw Error('write-failure')};
process.stdout.on('error',error=>events.push('error:'+error.message));
Promise.resolve().then(()=>events.push('promise'));
process.stdout.write('payload',error=>events.push('callback:'+error.message));
events.push('sync');setTimeout(()=>fs.writeFileSync('result.json',JSON.stringify(events)),10);`,
  'file inherited child retains lazy filesystem writer': `const fs=require('fs');
fs.writeFileSync('child.cjs', ${JSON.stringify("const fs=require('fs'),original=fs.writeSync,events=[];fs.writeSync=(fd,bytes,...args)=>{events.push(fd);return original(fd,bytes,...args)};process.stdout.write('payload',()=>fs.writeFileSync('result.json',JSON.stringify(events)));")});
require('child_process').spawn('node',['child.cjs'],{stdio:'inherit'}).on('close',code=>{if(code!==0)throw Error('child exit '+code)});`,
  'file stdout stays lazy across a piped child spawn': `const fs=require('fs'),original=fs.writeSync,events=[];
fs.writeFileSync('child.cjs','process.exit(0)');
require('child_process').spawn('node',['child.cjs'],{stdio:['ignore','pipe','inherit']});
fs.writeSync=(fd,bytes,...args)=>{events.push(fd);return original(fd,bytes,...args)};
process.stdout.write('payload',()=>fs.writeFileSync('result.json',JSON.stringify(events)));`,
  'file inherited child output uses the descriptor': `const fs=require('fs'),events=[];
fs.writeFileSync('child.cjs',"process.stdout.write('payload')");
process.stdout.write=()=>{events.push('replaced-stream');return true};
require('child_process').spawn('node',['child.cjs'],{stdio:'inherit'}).on('close',code=>{if(code!==0)throw Error('child exit '+code);fs.writeFileSync('result.json',JSON.stringify(events))});`,
  'preinitialized file callbacks precede promises': `const fs=require('fs'),events=[];
void process.stdout;
Promise.resolve().then(()=>events.push('promise'));
process.stdout.write('payload',error=>events.push(['callback',error===null]));
events.push('sync');setTimeout(()=>fs.writeFileSync('result.json',JSON.stringify(events)),10);`,
  'file console captures fs write on first output': `const fs=require('fs'),original=fs.writeSync,events=[];
require('console');
fs.writeSync=(fd,bytes,...args)=>{events.push(fd);return original(fd,bytes,...args)};
console.log('payload');setTimeout(()=>fs.writeFileSync('result.json',JSON.stringify(events)),10);`,
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
