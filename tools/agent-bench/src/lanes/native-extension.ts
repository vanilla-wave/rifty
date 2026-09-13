import { getAgentPromptProfile } from '@riftydev/agent';
import type { Endpoint, Limits } from '../config.ts';

/** Public Pi extension hooks own admission and abort; no copied agent loop. */
export function nativeExtension(directory: string, endpoint: Endpoint, limits: Limits): string {
  const profile = getAgentPromptProfile();
  return `import {appendFileSync,writeFileSync} from 'node:fs';
export default function(pi) {
  const directory=${JSON.stringify(directory)};
  const profile=${JSON.stringify(profile)};
  const key=${endpoint.envKey ? `process.env[${JSON.stringify(endpoint.envKey)}]` : 'undefined'};
  const clean=value=>key ? JSON.stringify(value).replaceAll(key,'[REDACTED]') : JSON.stringify(value);
  let calls=0; let timer; let budget=null;
  const save=()=>writeFileSync(directory+'/native-admission.json',clean({calls,budget}));
  pi.on('before_agent_start', event=> {
    const systemPrompt=[profile.intro,profile.guidance,
      'Native Node project with the installed Pi CLI read/bash/edit/write tools. The tool schemas describe their actual protocols and output limits; these differ from the browser host. A dev server is running. No additional project context files were loaded.',
      profile.recovery,profile.verification,
      'Current working directory: '+process.cwd(),
      'Current date: '+new Date().toISOString().slice(0,10)].join('\\n\\n');
    writeFileSync(directory+'/system-prompt.txt',systemPrompt);
    return {systemPrompt};
  });
  pi.on('before_provider_headers', event=> { ${endpoint.envKey ? '' : 'event.headers.Authorization=null;'} });
  pi.on('before_provider_request', event=> {appendFileSync(directory+'/provider-requests.jsonl',clean(event.payload)+'\\n');});
  pi.on('agent_start', (_event,ctx)=>{ save();timer=setTimeout(()=>{budget='runTimeoutMs';save();ctx.abort();},${limits.runTimeoutMs}); });
  pi.on('agent_end', ()=> {clearTimeout(timer);save();});
  pi.on('tool_call', (event,ctx)=> {
    if(calls>=${limits.maxToolCalls}) {budget='maxToolCalls';save();ctx.abort();return {block:true,reason:'Benchmark maxToolCalls exceeded',terminate:true};}
    calls++;save();
  });
}`;
}
