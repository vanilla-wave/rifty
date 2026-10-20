import { test } from '@playwright/test';
import { bootProjectFiles, expectViteDevServerReady, openShellTerminal, runTerminalLine, terminalBuffer } from './helpers/playground.ts';
for (const rate of [1]) test(`diagnostic startup CPU ${rate}`, async ({page}) => {
  test.setTimeout(240000);
  const start=Date.now();
  const mark=(event:string, detail:unknown={})=>console.log('STARTUP_PROBE', JSON.stringify({rate,ms:Date.now()-start,event,detail}));
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate',{rate});
  page.on('worker', w=>{mark('worker',w.url());w.on('close',()=>mark('worker-close',w.url()));});
  page.on('pageerror', e=>mark('pageerror',e.message));
  await bootProjectFiles(page); mark('boot-return');
  await expectViteDevServerReady(page,5174,90000);mark('primary-ready');
  await openShellTerminal(page);mark('second-terminal');
  await runTerminalLine(page,'npm run vite');mark('command-submitted');
  try {await expectViteDevServerReady(page,5173,30000);mark('original-criterion-pass');}
  catch (e) {mark('original-criterion-fail',String(e));await expectViteDevServerReady(page,5173,90000);mark('late-ready');}
  mark('second-output',await terminalBuffer(page));
});
