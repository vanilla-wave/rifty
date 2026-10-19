import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, readOwnerFile } from './fixtures.ts';

const probes = {
  'crypto survives guest crypto replacement': `const c=require('crypto');
Object.defineProperty(globalThis,'crypto',{configurable:true,writable:true,value:{getRandomValues:v=>c.randomFillSync(v)}});
const b=Buffer.alloc(16);
require('fs').writeFileSync('result.json',JSON.stringify({fill:c.randomFillSync(b)===b,web:c.getRandomValues(b)===b,uuid:typeof c.randomUUID()}));`,
  'hrtime survives guest performance replacement': `const p=require('process');
globalThis.performance={now:()=>{const [s,n]=p.hrtime();return s*1000+n/1e6}};
const pair=p.hrtime();
require('fs').writeFileSync('result.json',JSON.stringify({pair:pair.map(Number.isFinite),bigint:typeof p.hrtime.bigint(),uptime:Number.isFinite(p.uptime())}));`,
  'child and pipe ref unref': `const fs=require('fs');fs.writeFileSync('child.cjs',"setTimeout(()=>console.log('child-finished'),1000)");
const c=require('child_process').spawn('node',['child.cjs']);
const result={child:[c.ref(),c.ref(),c.unref(),c.unref()],pipes:{}};
for(const name of ['stdin','stdout','stderr']) {
const stream=c[name];result.pipes[name]=[stream.ref()===stream,stream.ref()===stream,stream.unref()===stream,stream.unref()===stream];}
let childExited=false;c.on('exit',()=>{childExited=true;});
process.on('exit',()=>fs.writeFileSync('result.json',JSON.stringify({...result,childExited})));`,
  'unsupported sync routes': `const {Worker,MessageChannel}=require('worker_threads');
const {port1,port2}=new MessageChannel();let worker,errors={};
try {worker=new Worker('./child.cjs',{workerData:{port:port2},transferList:[port2]});worker.on('error',()=>{});}
catch(e){errors.worker=[e.name,e.feature];}
try{require('child_process').execFileSync('node',['-e','1']);}catch(e){errors.exec=[e.name,e.feature];}
port1.close();port2.close();if(worker)worker.terminate();
require('fs').writeFileSync('result.json',JSON.stringify(errors));`,
  'stdio write callbacks': `const p=require('process'), events=[];
for(const name of ['stdout','stderr']) {
 const s=p[name];
 events.push([name,s.write('A',(...args)=>events.push([name,'cb',args]))]);
 events.push([name,s.write('42','hex',(...args)=>events.push([name,'encoded',args]))]);
 events.push([name,s.write(Buffer.from('C'),(...args)=>events.push([name,'bytes',args]))]);
}
events.push('sync');
setTimeout(()=>require('fs').writeFileSync('result.json',JSON.stringify(events)),20);`,
  'numeric Stats fields': `const fs=require('fs');
fs.writeFileSync('file','hello');fs.mkdirSync('dir');
const fields=['dev','ino','mode','nlink','uid','gid','rdev','size','blksize','blocks','atimeMs','mtimeMs','ctimeMs','birthtimeMs'];
const fd=fs.openSync('file','r');
const values=[fs.statSync('file'),fs.lstatSync('file'),fs.fstatSync(fd),fs.statSync('dir'),fs.statSync('/')];
const shape=values.map(s=>({
 fields:fields.map(k=>[k,typeof s[k],Number.isFinite(s[k])]),
 dates:['atime','mtime','ctime','birthtime'].map(k=>[k,s[k] instanceof Date,Number.isFinite(+s[k])]),
 file:s.isFile(),directory:s.isDirectory(),type:s.mode & 0o170000,
 stable:s.isDirectory()||s.ino===values[0].ino,
}));
fs.closeSync(fd);
const before=fs.statSync('file');fs.writeFileSync('file','changed');
const written=fs.statSync('file');fs.renameSync('file','renamed');const renamed=fs.statSync('renamed');
fs.mkdirSync('dir/nested');
fs.writeFileSync('result.json',JSON.stringify({shape,
 identity:[before.ino===written.ino,written.ino===renamed.ino],
 birth:[before.birthtimeMs===written.birthtimeMs,written.birthtimeMs===renamed.birthtimeMs],
 links:fs.statSync('dir').nlink===values[3].nlink+1,
}));`,
};

const childLifetime = (pipes: boolean, reref: boolean): string => `
const fs=require('fs');fs.writeFileSync('child.cjs',"setTimeout(()=>console.log('complete'),30)");
const c=require('child_process').spawn('node',['child.cjs']);
c.unref();let output='';c.stdout.on('data',chunk=>output+=chunk);
${pipes ? 'for(const stream of c.stdio)stream.unref();' : ''}
${reref ? 'c.ref();c.ref();' : ''}
c.on('close',()=>{c.ref();for(const stream of c.stdio)stream.ref();});
process.on('exit',()=>fs.writeFileSync('result.json',JSON.stringify({output})));
`;
const pendingWrites = (unref: boolean): string => `const fs=require('fs');
fs.writeFileSync('child.cjs',"setTimeout(()=>{process.stdin.on('data',()=>{});},100)");
const c=require('child_process').spawn('node',['child.cjs'],{stdio:['pipe','ignore','ignore']});
c.unref();${unref ? 'c.stdin.unref();' : ''}
const result={callbacks:[],errors:[]};c.stdin.on('error',e=>result.errors.push(e.code));
for(let i=0;i<2;i++)c.stdin.write(Buffer.alloc(8*1024*1024,65),e=>{
result.callbacks.push([i,e && e.code]);if(i===1)c.stdin.end();
});
process.on('exit',()=>fs.writeFileSync('result.json',JSON.stringify(result)));`;
const allProbes = {
  ...probes,
  'pending writes retain an unreferenced child': pendingWrites(false),
  'pending writes retain an unreferenced input pipe': pendingWrites(true),
  'referenced pipes retain an unreferenced child': childLifetime(false, false),
  'child reref retains parent and close releases references': childLifetime(true, true),
  'idle stdin does not retain parent': `const fs=require('fs');
fs.writeFileSync('child.cjs',"setTimeout(()=>require('fs').writeFileSync('child-done','yes'),300)");
const c=require('child_process').spawn('node',['child.cjs'],{stdio:['pipe','ignore','ignore']});
c.unref();c.stdin.ref();
process.on('exit',()=>fs.writeFileSync('result.json',JSON.stringify({completed:fs.existsSync('child-done')})));`,
};
for (const [name, source] of Object.entries(allProbes)) {
  test(`Node surface: ${name}`, async ({ page }) => {
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'rifty-node-surface-'));
    writeFileSync(join(root, 'probe.cjs'), source);
    if (name === 'unsupported sync routes') {
      writeFileSync(
        join(root, 'result.json'),
        JSON.stringify({
          worker: ['NotImplementedError', 'worker_threads.workerData.structuredClone'],
          exec: ['NotImplementedError', 'child_process.execFileSync'],
        }),
      );
    } else execFileSync(process.execPath, ['probe.cjs'], { cwd: root, timeout: 10_000 });
    const oracle = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
    rmSync(root, { recursive: true, force: true });
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-esbuild-surface-${name.replaceAll(' ', '-')}`,
      persistence: 'ephemeral',
      plan: {
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'node-surfaces',
        templateId: 'browser-unit:node-surfaces',
        files: {
          '/package.json': '{"name":"node-surfaces","private":true}',
          '/probe.cjs': source,
          '/child.cjs': '',
        },
        firstMaterialization: { kind: 'install' },
        entryPath: '/probe.cjs',
      },
    });
    try {
      const result = await execLine(page, 'node probe.cjs');
      expect(result.exit, result.out).toBe(0);
      const actual = await readOwnerFile(page, '/scratch/result.json');
      expect(actual.ok, actual.error).toBe(true);
      expect(JSON.parse(actual.text)).toEqual(oracle);
    } finally {
      await closeOwner(page);
    }
  });
}
