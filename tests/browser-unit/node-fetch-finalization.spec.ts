import { type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { runNodeOracle, runOwnerCommand } from './fixtures/message-port-ref-cases.ts';

// Both subjects collect real fetched Responses; no finalizer or stream is mocked.
test.use({ launchOptions: { args: ['--js-flags=--expose-gc'] } });
function program(origin: string): string {
  return `(async()=>{
    let collect=globalThis.gc;
    if(typeof collect!=='function'){
      require('v8').setFlagsFromString('--expose_gc');
      collect=require('vm').runInNewContext('gc');
    }
    const registries=[];
    for(const state of ['readable','closed','errored']){
      let collected=false;
      const registry=new FinalizationRegistry(()=>{collected=true;});registries.push(registry);
      let response=await fetch(${JSON.stringify(origin)}+'/'+state);
      const retained=new Response(response.body);
      registry.register(response,0);response=null;
      if(state==='errored')await(await fetch(${JSON.stringify(origin)}+'/arm-error')).text();
      await new Promise(r=>setTimeout(r,20));
      console.log('FETCH-GC|before='+JSON.stringify([state,retained.bodyUsed]));
      for(let i=0;i<100&&!collected;i++){collect();await new Promise(r=>setTimeout(r,5));}
      for(let i=0;i<5;i++){collect();await new Promise(r=>setTimeout(r,5));}
      console.log('FETCH-GC|after='+JSON.stringify([state,collected,retained.bodyUsed]));
    }
    console.log('FETCH-GC|registries='+registries.length);
  })().catch(error=>{console.error(error);process.exitCode=1;});`;
}

test('Response finalization preserves retained closed/errored body state as in Node', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let pendingError: ServerResponse | undefined;
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    if (request.url === '/arm-error') {
      response.end('armed');
      pendingError?.destroy();
      pendingError = undefined;
    } else if (request.url === '/closed') response.end();
    else {
      if (request.url === '/errored') pendingError = response;
      response.writeHead(200);
      response.flushHeaders();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const source = program(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    const oracle = await runNodeOracle(source);
    expect(oracle.code, oracle.stderr).toBe(0);
    expect(oracle.stdout).toContain('after=["errored",true,false]');
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-fetch-finalization',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/finalization.cjs', source);
      const guest = await runOwnerCommand(page, 'node finalization.cjs', 30_000);
      expect(guest.timedOut, guest.out).toBe(false);
      expect(guest.exit, guest.out).toBe(oracle.code);
      const rows = (text: string) =>
        text
          .replaceAll('\r', '')
          .split('\n')
          .filter((line) => line.startsWith('FETCH-GC|'));
      expect(rows(guest.out), guest.out).toEqual(rows(oracle.stdout));
    } finally {
      await closeOwner(page);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
