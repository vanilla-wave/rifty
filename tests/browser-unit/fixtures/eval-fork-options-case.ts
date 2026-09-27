import type { ParityCase } from '../../../tools/node-parity-runner/src/types.ts';

export const evalForkChild = `console.log('FILE|' + JSON.stringify({argv:process.execArgv,evalOwn:Object.hasOwn(process,'_eval')})); process.disconnect();`;
export const evalForkSource = `
if (typeof process.send === 'function') {
  console.log('INLINE|' + JSON.stringify(process.execArgv.map(arg=>arg===process._eval?'SOURCE':arg)));
  process.disconnect();
} else {
  const {fork}=require('node:child_process');
  const originalArgs=[...process.execArgv];
  const originalDescriptor=Object.getOwnPropertyDescriptor(process,'_eval');
  const originalEval=process._eval;
  let assignmentError=null;
  try {process._eval='assignment-must-not-change-source';} catch(error) {assignmentError=error.name;}
  const assignmentRetains=process._eval===originalEval;
  if(originalDescriptor) Object.defineProperty(process,'_eval',originalDescriptor);
  else delete process._eval;
  console.log('META|'+JSON.stringify({own:!!originalDescriptor,matches:originalEval===originalArgs[1],writable:originalDescriptor?.writable,enumerable:originalDescriptor?.enumerable,configurable:originalDescriptor?.configurable,assignmentRetains,assignmentError}));
  function restore() {
    process.execArgv.splice(0,process.execArgv.length,...originalArgs);
    if(originalDescriptor) Object.defineProperty(process,'_eval',originalDescriptor);
    else delete process._eval;
  }
  function run(mode) { return new Promise(resolve=>{
    const options={silent:true};
    if(mode==='empty') options.execArgv=[];
    if(mode==='same-array') options.execArgv=process.execArgv;
    if(mode==='cloned-array') options.execArgv=[...process.execArgv];
    if(mode==='unmatched-eval') Object.defineProperty(process,'_eval',{value:'not-present-in-argv',configurable:true});
    if(mode==='last-match') process.execArgv.push('--conditions',originalArgs[1]);
    const before=JSON.stringify(process.execArgv);
    try {
      const worker=fork('./child.cjs',[],options);
      const unchanged=JSON.stringify(process.execArgv)===before;
      restore();
      let stdout='',stderr='';
      worker.stdout.on('data',bytes=>{stdout+=bytes.toString()});
      worker.stderr.on('data',bytes=>{stderr+=bytes.toString()});
      worker.on('error',error=>{stderr+='ERROR:'+error.message});
      worker.on('close',code=>resolve({mode,unchanged,code,stdout,stderr}));
    } catch(error) {
      const unchanged=JSON.stringify(process.execArgv)===before;
      restore();
      resolve({mode,unchanged,thrown:{name:error.name,feature:error.feature??null}});
    }
  }); }
  void (async()=>{for(const mode of ['default','empty','same-array','cloned-array','unmatched-eval','last-match']) console.log('RESULT|'+JSON.stringify(await run(mode)));})();
}
undefined;`;

export function evalForkCase(flag: '-e' | '-p'): ParityCase {
  return {
    kind: 'node-cli-eval',
    cwd: '/scratch',
    code: '',
    expectedPhysicalWorkers: 1,
    setup: { files: { 'scratch/child.cjs': evalForkChild } },
    nodeCliEval: { sequential: [{ label: flag, nodeArgv: [flag, evalForkSource] }] },
  };
}
