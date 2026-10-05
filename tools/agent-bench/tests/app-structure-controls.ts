import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import { freePort, killProcessGroup, runOrThrow, spawnLoggedServer, waitHttpReady } from '../src/proc.ts';
const root=await mkdtemp(join(tmpdir(),'rifty-app-structure-controls-'));
const browser=await chromium.launch();
const evidence=[];
try {
  const tasks=(await loadCorpus('pilot-v1')).filter(task=>task.group==='app');
  for (const task of tasks){
    const dir=join(root,task.id);await mkdir(dir);await writeTree(dir,task.files);
    await runOrThrow('npm',['install','--no-audit','--no-fund'],{cwd:dir,env:{...process.env,NODE_PATH:undefined},timeoutMs:300000});
    const reference=task.controls!.reference!;
    const sourcePath=task.id==='csv-workflow'?'src/main.tsx':'src/main.js';
    let source=reference[sourcePath]!;
    if (task.id==='csv-workflow') source=source.replace('<label>Exported CSV<textarea readOnly value={output}/></label>','<output aria-label="Exported CSV">{output}</output>').replace('<label>Filter<input value={query}','<label>Filter<input type="search" value={query}');
    else source=source.replace('<nav aria-label="Saved notes">','<section aria-label="Saved notes">').replace('</nav>','</section>').replace('<button data-open="${escape(note.id)}">${escape(note.title)}</button>','<a href="#" data-open="${escape(note.id)}">${escape(note.title)}</a>').replace('button.onclick=()=>open(button.dataset.open)','button.onclick=e=>{e.preventDefault();open(button.dataset.open)}').replace('<input aria-label="Search"','<input type="search" aria-label="Search"').replace('<section aria-label="Markdown preview">','<article aria-label="Rendered Markdown">').replace('</section></main>','</article></main>').replace('<strong>$1</strong>','<b>$1</b>');
    assert.notEqual(source,reference[sourcePath]);
    await writeTree(dir,{...reference,[sourcePath]:source});
    const port=await freePort();const url=`http://127.0.0.1:${port}/`;
    const server=spawnLoggedServer(join(dir,'node_modules/.bin/vite'),['--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:dir,env:{...process.env,NODE_PATH:undefined},logPath:join(dir,'server.log'),detached:true});
    const context=await browser.newContext();
    try {await waitHttpReady(url,30000,'structural alternative');const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);const result=await task.judge!({view:page,previewUrl:url});evidence.push({id:task.id,dir,result,errors,source});console.log(JSON.stringify({id:task.id,result,errors}));assert.equal(result.pass,true);assert.deepEqual(errors,[]);}
    finally {await context.close();await killProcessGroup(server);}
  }
}finally{await browser.close();await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(`APP_STRUCTURE_ARTIFACTS ${root}`);}
