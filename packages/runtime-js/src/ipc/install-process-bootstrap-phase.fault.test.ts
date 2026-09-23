import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const url = (path: string) => new URL(path, import.meta.url).href;

it.each(['runtime-bootstrap', 'ts-service-bootstrap', 'plain-url', 'source'] as const)(
  'keeps trusted capture separate from guest execution: %s',
  (role) => {
    const trusted = role === 'runtime-bootstrap' || role === 'ts-service-bootstrap';
    const entry =
      role === 'source'
        ? { kind: 'source', code: '', sourceUrl: '/guest.js' }
        : {
            kind: 'url',
            url: 'https://host.invalid/bootstrap.js',
            ...(trusted ? { role: 'runtime-bootstrap' } : {}),
          };
    const source = `
import {installNodeRuntime} from ${JSON.stringify(url('./install-process.ts'))};
import {publishKernelProcessSpec,publishKernelEntryBootstrap,publishKernelSyncApi} from ${JSON.stringify(url('../../../kernel/src/shared-globals.ts'))};
import {setVmEngineOverride} from ${JSON.stringify(url('../builtins/vm/engine-config.ts'))};
import {readRuntimeGlobal} from ${JSON.stringify(url('../internal/worker-globals.ts'))};
${role === 'ts-service-bootstrap' ? `import {bootTsLanguageServiceWorker} from ${JSON.stringify(url('../../../ts-language-service/src/worker/entry.ts'))};` : ''}
const hostProcess=process; const write=hostProcess.stdout.write.bind(hostProcess.stdout);
const channels=[new MessageChannel(),new MessageChannel()];
setVmEngineOverride('rewrite');
publishKernelEntryBootstrap(null);
const spec={pid:7,ppid:1,argv:['rifty','/guest.js'],env:{},cwd:'/',stdio:{
 stdout:{write(){}},stderr:{write(){}},stdin:channels[0].port1,ipc:channels[1].port1,
}};
publishKernelProcessSpec(spec);
await installNodeRuntime({...spec,entry:${JSON.stringify(entry)}});
let copied=false, failure=null, sealed=false;
try {
 const second=await import(${JSON.stringify(`${url('../internal/proxy-provenance.ts')}?trusted-second-bundle`)});
 copied=true;
 const runtime=await import(${JSON.stringify(url('../index.ts'))});
 ${
   role === 'ts-service-bootstrap'
     ? `publishKernelSyncApi({call(){throw new Error('unexpected RPC')},callBinary(){throw new Error('unexpected RPC')}});
 bootTsLanguageServiceWorker();`
     : 'runtime.sealNodeRuntimeBootstrap();'
 }
} catch(error){failure=error.message;}
try{readRuntimeGlobal('proxyProvenance').acquireDuringBootstrap();}catch{sealed=true;}
write(JSON.stringify({copied,failure,sealed})+'\\n');
for(const channel of channels){channel.port1.close();channel.port2.close();}
hostProcess.exit(0);
`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
      input: source,
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      trusted
        ? { copied: true, failure: null, sealed: true }
        : { copied: false, failure: 'Proxy provenance bootstrap is sealed', sealed: true },
    );
  },
);
