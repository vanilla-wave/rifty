// rifty-arch — compact interactive architecture explorer (web component).
// Data mirrors apps/landing/src/explorer/data.ts (vanilla-wave/rifty@main).
(function(){
if (customElements.get('rifty-arch')) return;
const AC='#C7F05A', WARN='#E0A45C';
const RCOL={page:'#7AA2FF',worker:'#3BD6C6',sw:'#B58BFF',iframe:'#F2B95C',ext:'#8A93A6'};
const N={
 playground:['Playground UI','page','SolidJS + Monaco + xterm IDE-in-a-tab. UI policy only; runtime authority lives behind Workbench.'],
 workbench:['@riftydev/workbench','page','Framework-free project, session, run, file, document, terminal and preview API.'],
 owner:['workspace owner','worker','One owner Worker holds project, VFS, package, PTY and preview-producer state; supervises child Workers.'],
 sdk:['@riftydev/sdk','page','Umbrella front door. createSandbox() + a 6-feature capability probe. Framework-free.'],
 sandboxvfs:['standalone VFS init','page','createSandbox() attempts caller-realm VFS init; PAGE falls back to memory — sync OPFS is Worker-only.'],
 terminal:['terminal','page','xterm.js wrapper — line editor, history, ghost-text completions. Dispatches through Workbench.'],
 shell:['shell','worker','Bash-flavoured shell. Pure-JS coreutils over the VFS; .bin PATH; PTY.'],
 npm:['npm-client','worker','In-browser npm: semver resolve, registry fetch, gunzip + tar, SHA verify, link.'],
 runtimejs:['runtime-js','worker','Node-compatible JS runtime — CJS/ESM loader plus tested node: builtin subsets, driven in a Worker.'],
 runtimewasi:['runtime-wasi','worker','Raw WASI preview1 runner; createWasiProcess kernel-spawns a Worker with process-shaped stdio/exit.'],
 esbuild:['esbuild JS API','worker','esbuild@0.28 transform APIs via the registry-attested wasm adapter. The CLI/bin throws loudly.','warn'],
 vite:['vite dev server','worker','Exact Vite 7.3.6 dev + HMR; opt-in Vite 8 dev/build/preview uses Rolldown with HMR disabled.'],
 kernel:['kernel','worker','Process / scheduling / IPC core. Worker-as-process over SAB + Atomics. Node-API-agnostic.'],
 sab:['SAB ring + Atomics','worker','SharedArrayBuffer ring + Atomics.wait/notify — the synchronous cross-thread substrate.'],
 vfs:['virtual FS','worker','Memory + OPFS backends with sync mirrors; Workbench children reach the owner VFS through sync IPC.'],
 net:['net + port registry','worker','node:net/http/ws over virtual port registries, with cross-realm bind claims and preview bridges.'],
 httpserver:['http server','worker','http.createServer/listen — registers a port handler, emits request/upgrade/close.'],
 sw:['service worker','sw','Preview fetch-routing bridge. Intercepts /preview/<port>/ and routes to the in-tab server.'],
 preview:['preview iframe','iframe','The sandboxed preview pane. Loads /preview/<port>/; renders the in-tab server response.'],
 registry:['registry proxy','ext','npm egress through a configured CORS/CORP registry proxy.'],
};
const POS={playground:[135,110],workbench:[90,225],terminal:[180,300],sdk:[90,390],sandboxvfs:[180,480],
 owner:[395,105],kernel:[635,105],vfs:[395,200],sab:[635,200],shell:[395,295],npm:[635,295],
 runtimejs:[395,390],runtimewasi:[635,390],esbuild:[395,485],vite:[635,485],net:[395,580],httpserver:[635,580],
 sw:[810,335],preview:[955,430],registry:[1080,230]};
const EDGES=[
 ['playground','workbench','import'],['terminal','workbench','control'],['workbench','owner','ipc'],
 ['sdk','sandboxvfs','data'],['sdk','sw','control'],['sdk','runtimejs','control'],
 ['owner','shell','control'],['owner','npm','control'],['owner','kernel','control'],['owner','vfs','data'],['owner','net','control'],
 ['workbench','net','data'],['shell','npm','control'],['shell','vfs','import'],['npm','vfs','data'],['npm','registry','data'],
 ['kernel','runtimejs','control'],['kernel','runtimewasi','control'],
 ['runtimejs','owner','ipc'],['runtimejs','net','data'],['runtimejs','vfs','data'],['runtimejs','sab','ipc'],
 ['runtimewasi','vfs','data'],['vite','esbuild','control'],['vite','net','data'],
 ['net','preview','ipc'],['sab','owner','ipc'],['net','httpserver','control'],
 ['preview','sw','data'],['sw','workbench','ipc']];
const ZONES=[
 ['page','PAGE','UI · public façades',0,270],['worker','WORKERS','owner · supervised children',270,480],
 ['sw','SERVICE WORKER','fetch router',750,120],['iframe','PREVIEW IFRAME','sandboxed',870,170],
 ['ext','EXTERNAL','configured egress',1040,140]];
const SCN={
 boot:{label:'Boot a sandbox',cmd:'await createSandbox({ workerUrl, serviceWorkerUrl })',steps:[
  ['sdk','createSandbox() probes COI, SAB, Atomics.waitAsync, OPFS sync access, Service Worker and Worker'],
  ['sandboxvfs','Attempt caller-realm VFS init; PAGE falls back to memory because sync OPFS is Worker-only'],
  ['sw','Register the service worker (skippable; a failure is non-fatal)'],
  ['runtimejs','Spawn a dedicated runtime Worker; return Sandbox while Sandbox.runtime reports its lifecycle']]},
 npm:{label:'npm install express',cmd:'npm install express',steps:[
  ['terminal','Submit npm install express through the Workbench terminal'],
  ['owner','The workspace owner executes the shell command'],
  ['npm','Resolve the graph — semver picks the best version per package'],
  ['registry','Fetch packuments + tarballs through the configured CORS/CORP registry proxy'],
  ['npm','gunzip (DecompressionStream) + JS tar extract + SHA integrity verify'],
  ['vfs','Link the resolved dependency tree onto the VFS — flat-first-wins, nested on conflict']]},
 express:{label:'Express server + live preview',cmd:'node server.js',steps:[
  ['runtimejs','node server.js runs in a supervised child — app.listen(3000)'],
  ['net','http.createServer publishes port 3000 to the virtual port registry'],
  ['preview','The preview iframe requests /preview/3000/'],
  ['sw','The service worker intercepts the fetch and resolves the current page registration'],
  ['workbench','The page-side Workbench preview bridge routes the request to the child HTTP server'],
  ['httpserver','Express writes the finite HTML response'],
  ['preview','The bridge buffers the finite body; the Service Worker returns it to the iframe']]},
 vite:{label:'Vite dev server + HMR',cmd:'vite  (then edit src/main.js)',steps:[
  ['playground','Edit src/main.js in Monaco and save'],
  ['vite','The real Vite 7 worker re-transforms the changed module'],
  ['esbuild','Vite 7 uses the registry-attested esbuild JS adapter; there is no host WASM URL'],
  ['net','HMR payload rides RFC6455 frames over the BroadcastChannel WS bridge'],
  ['preview','@vite/client applies the update — the module hot-swaps, state survives']]},
 wasi:{label:'Run a raw WASI guest',cmd:'createWasiProcess({ wasm })',steps:[
  ['runtimewasi','createWasiProcess receives raw wasi_snapshot_preview1 module bytes'],
  ['kernel','The kernel spawns a WASI Worker and returns its ProcessHandle'],
  ['runtimewasi','The Worker instantiates the guest with wasi_snapshot_preview1 imports'],
  ['vfs',"Guest syscalls use that Worker's realm-local synchronous mirror and supplied preopens"],
  ['runtimewasi','stdout, stderr and the honest exit code propagate through ProcessHandle']]},
 sync:{label:'Workbench child sync fs',cmd:'fs.readFileSync("/app.js")',steps:[
  ['runtimejs','A supervised child calls fs.readFileSync — a blocking syscall'],
  ['sab','The remote sync client writes a SAB request and waits with Atomics.wait'],
  ['owner','The owner dispatcher handles the request and replies with Atomics.notify'],
  ['vfs','The owner VFS reads and returns the bytes'],
  ['runtimejs','Atomics.wait returns; the child unblocks and returns synchronously']]}};
const ORDER=[['boot','Boot'],['npm','npm install'],['express','Express + preview'],['vite','Vite HMR'],['wasi','Raw WASI'],['sync','Child sync fs (SAB)']];
const W=1180,H=660,STEP=1400;
const IDS=Object.keys(N);
const ADJ={}; IDS.forEach(id=>ADJ[id]=new Set());
EDGES.forEach(([a,b])=>{ADJ[a].add(b);ADJ[b].add(a);});
const ek=(a,b)=>a<b?a+'|'+b:b+'|'+a;
function bfs(from,to){
 if(from===to) return [from];
 const prev={},q=[from],seen={[from]:1};
 while(q.length){const c=q.shift();for(const n of ADJ[c]){if(seen[n])continue;seen[n]=1;prev[n]=c;if(n===to){const p=[to];let x=to;while(x!==from){x=prev[x];p.unshift(x);}return p;}q.push(n);}}
 return [from,to];
}
function segments(id){
 const st=SCN[id].steps,segs=[{nodes:[st[0][0]],edges:[]}];
 for(let i=1;i<st.length;i++){const p=bfs(st[i-1][0],st[i][0]),nodes=[],edges=[];
  for(let j=1;j<p.length;j++){nodes.push(p[j]);edges.push(ek(p[j-1],p[j]));}
  segs.push({nodes,edges});}
 return segs;
}
const CSS=`
:host{display:block;font-family:'Roboto Mono',monospace}
*{box-sizing:border-box}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px 14px;border:2px solid rgba(255,255,255,0.16);border-bottom:none;background:#12151B}
.lbl{font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,0.4);margin-right:4px}
.chip{font-family:inherit;font-size:11px;font-weight:600;padding:6px 10px;background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.65);cursor:pointer}
.chip:hover{border-color:rgba(255,255,255,0.45);color:#fff}
.chip.on{background:${AC};border-color:${AC};color:#15170B}
.status{display:flex;flex-direction:column;gap:4px;padding:10px 14px;border:2px solid rgba(255,255,255,0.16);border-bottom:none;background:#0E1014;min-height:64px}
.strow{display:flex;gap:12px;align-items:baseline}
.sttl{font-size:12px;font-weight:700;color:#fff}
.stnum{font-size:10.5px;color:${AC}}
.stcap{font-size:11.5px;line-height:1.5;color:rgba(255,255,255,0.6)}
.prog{height:2px;background:rgba(255,255,255,0.1);margin-top:auto}
.prog i{display:block;height:100%;background:${AC};width:0;transition:width .5s}
.wrap{position:relative;overflow:hidden;border:2px solid rgba(255,255,255,0.16);background:#0E1014}
.world{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
.zone{position:absolute;top:0;bottom:0;border-right:1px dashed rgba(255,255,255,0.09)}
.zone:last-child{border-right:none}
.zhead{padding:10px 12px}
.zname{font-size:11px;font-weight:700;letter-spacing:.08em}
.zsub{font-size:9.5px;color:rgba(255,255,255,0.35);margin-top:2px}
.zone.on{background:rgba(255,255,255,0.03)}
svg{position:absolute;inset:0;pointer-events:none}
.node{position:absolute;transform:translate(-50%,-50%);padding:7px 11px;background:#12151B;border:1px solid rgba(255,255,255,0.22);border-left-width:3px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap;cursor:pointer;transition:opacity .2s}
.node .w{color:${WARN};margin-left:4px}
.node.dim{opacity:.22}
.node.nb{border-color:rgba(199,240,90,0.55)}
.node.tc{border-color:rgba(199,240,90,0.5);background:rgba(199,240,90,0.07)}
.node.cur{border-color:${AC};background:rgba(199,240,90,0.16);box-shadow:0 0 0 1px ${AC};animation:pulse 1.4s ease-out infinite}
.node.pin{outline:1px solid ${AC};outline-offset:2px}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(199,240,90,0.55)}100%{box-shadow:0 0 0 12px rgba(199,240,90,0)}}
.insp{display:flex;gap:12px;align-items:baseline;padding:11px 14px;border:2px solid rgba(255,255,255,0.16);border-top:none;background:#12151B;min-height:44px}
.iname{font-size:11.5px;font-weight:700;color:${AC};white-space:nowrap}
.irealm{font-size:9.5px;letter-spacing:.1em;white-space:nowrap}
.irole{font-size:11px;line-height:1.5;color:rgba(255,255,255,0.6)}
.hint{font-size:10.5px;color:rgba(255,255,255,0.35)}
`;
class RiftyArch extends HTMLElement{
 connectedCallback(){
  if(this.__b)return; this.__b=1;
  const r=this.attachShadow({mode:'open'});
  const st=document.createElement('style'); st.textContent=CSS; r.appendChild(st);
  this.scn=null; this.step=0; this.timer=null; this.hover=null; this.pin=null; this.segCache={};
  // chip bar
  const bar=el('div','bar'); bar.appendChild(el('span','lbl','SCENARIO'));
  this.chips={};
  const whole=el('button','chip on','Whole schema'); whole.onclick=()=>this.setScn(null);
  bar.appendChild(whole); this.chips['none']=whole;
  ORDER.forEach(([id,label])=>{const c=el('button','chip',label);c.onclick=()=>this.scn===id?this.play():this.setScn(id);bar.appendChild(c);this.chips[id]=c;});
  r.appendChild(bar);
  // status
  const status=el('div','status');
  const row=el('div','strow');
  this.ttl=el('span','sttl','Whole schema'); this.num=el('span','stnum','');
  row.appendChild(this.ttl); row.appendChild(this.num); status.appendChild(row);
  this.cap=el('div','stcap','Hover a module to see its links; click to pin its description. Pick a scenario to follow its narrated steps.');
  status.appendChild(this.cap);
  const prog=el('div','prog'); this.fill=document.createElement('i'); prog.appendChild(this.fill); status.appendChild(prog);
  r.appendChild(status);
  // board
  this.wrap=el('div','wrap'); this.world=el('div','world'); this.wrap.appendChild(this.world); r.appendChild(this.wrap);
  this.zoneEls={};
  ZONES.forEach(([id,name,sub,x,w])=>{
   const z=el('div','zone'); z.style.left=x+'px'; z.style.width=w+'px';
   const h=el('div','zhead'); const nm=el('div','zname',name); nm.style.color=RCOL[id];
   h.appendChild(nm); h.appendChild(el('div','zsub',sub)); z.appendChild(h);
   this.world.appendChild(z); this.zoneEls[id]=z;});
  // edges svg
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  svg.innerHTML='<defs>'+
   '<marker id="ag" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8Z" fill="rgba(255,255,255,0.5)"/></marker>'+
   '<marker id="aa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8Z" fill="'+AC+'"/></marker></defs>';
  this.lines={};
  EDGES.forEach(([a,b,kind])=>{
   const l=document.createElementNS('http://www.w3.org/2000/svg','line');
   const p1=POS[a],p2=POS[b],dx=p2[0]-p1[0],dy=p2[1]-p1[1],len=Math.hypot(dx,dy)||1;
   const t0=Math.min(.45,60/len),t1=1-Math.min(.45,66/len);
   l.setAttribute('x1',p1[0]+dx*t0); l.setAttribute('y1',p1[1]+dy*t0);
   l.setAttribute('x2',p1[0]+dx*t1); l.setAttribute('y2',p1[1]+dy*t1);
   if(kind==='control')l.setAttribute('stroke-dasharray','5 4');
   if(kind==='ipc')l.setAttribute('stroke-dasharray','3 4');
   l.dataset.kind=kind; this.lines[ek(a,b)]=l; svg.appendChild(l);});
  this.world.appendChild(svg);
  // nodes
  this.nodeEls={};
  IDS.forEach(id=>{
   const d=N[id],n=el('div','node',d[0]);
   if(d[3]==='warn'){const w=el('span','w','\u26A0');n.appendChild(w);}
   n.style.left=POS[id][0]+'px'; n.style.top=POS[id][1]+'px'; n.style.borderLeftColor=RCOL[d[1]];
   n.onpointerenter=()=>{this.hover=id;this.paint();};
   n.onpointerleave=()=>{if(this.hover===id){this.hover=null;this.paint();}};
   n.onclick=()=>{this.pin=this.pin===id?null:id;this.paint();};
   this.world.appendChild(n); this.nodeEls[id]=n;});
  // inspector
  this.insp=el('div','insp'); r.appendChild(this.insp);
  // scale
  const fit=()=>{const w=this.wrap.clientWidth||this.clientWidth; if(!w)return;
   const s=w/W; this.world.style.transform='scale('+s+')'; this.wrap.style.height=(H*s)+'px';};
  new ResizeObserver(fit).observe(this.wrap); fit();
  this.paint();
 }
 segs(id){return this.segCache[id]||(this.segCache[id]=segments(id));}
 setScn(id){
  clearTimeout(this.timer); this.hover=null;
  this.scn=id; this.step=0;
  if(id) this.tick(); else this.paint();
 }
 play(){clearTimeout(this.timer); this.step=0; this.tick();}
 tick(){
  this.paint();
  const steps=SCN[this.scn].steps;
  if(this.step<steps.length-1){this.timer=setTimeout(()=>{this.step++;this.tick();},STEP);}
 }
 paint(){
  const scn=this.scn, hover=this.hover;
  for(const k in this.chips) this.chips[k].classList.toggle('on',(scn||'none')===k);
  // path state
  let cur=null,touched=new Set(),segE=new Set(),doneE=new Set(),allN=new Set(),allE=new Set();
  if(scn){
   const segs=this.segs(scn);
   for(let i=0;i<=this.step&&i<segs.length;i++){segs[i].nodes.forEach(n=>touched.add(n));segs[i].edges.forEach(e=>doneE.add(e));}
   (segs[this.step]||{edges:[]}).edges.forEach(e=>segE.add(e));
   segs.forEach(s=>{s.nodes.forEach(n=>allN.add(n));s.edges.forEach(e=>allE.add(e));});
   cur=SCN[scn].steps[this.step][0];
  }
  // status
  if(scn){
   const steps=SCN[scn].steps;
   this.ttl.textContent=SCN[scn].label;
   this.num.textContent=(this.step+1)+' / '+steps.length+'  ·  $ '+SCN[scn].cmd;
   this.cap.textContent=steps[this.step][1];
   this.fill.style.width=(((this.step+1)/steps.length)*100)+'%';
  }else{
   this.ttl.textContent='Whole schema'; this.num.textContent='';
   this.cap.textContent='Hover a module to see its links; click to pin its description. Pick a scenario to follow its narrated steps.';
   this.fill.style.width='0%';
  }
  // zones
  const curRealm=cur?N[cur][1]:null;
  for(const z in this.zoneEls) this.zoneEls[z].classList.toggle('on',z===curRealm);
  // nodes
  const nb=hover?ADJ[hover]:null;
  IDS.forEach(id=>{
   const n=this.nodeEls[id]; n.className='node';
   n.style.borderColor=''; n.style.borderLeftColor=RCOL[N[id][1]];
   if(hover){ if(id===hover)n.classList.add('cur');
    else if(nb.has(id))n.classList.add('nb'); else n.classList.add('dim'); }
   else if(scn){ if(id===cur)n.classList.add('cur');
    else if(touched.has(id))n.classList.add('tc');
    else if(allN.has(id))n.classList.add('nb'); else n.classList.add('dim'); }
   if(this.pin===id)n.classList.add('pin');
  });
  // edges
  for(const key in this.lines){
   const l=this.lines[key],[a,b]=key.split('|');
   let stroke='rgba(255,255,255,0.28)',w=1.2,mk='';
   const kind=l.dataset.kind;
   if(kind!=='import')mk='url(#ag)';
   if(hover){ if(a===hover||b===hover){stroke=AC;w=1.6;if(kind!=='import')mk='url(#aa)';} else stroke='rgba(255,255,255,0.07)'; }
   else if(scn){
    if(segE.has(key)){stroke=AC;w=1.8;if(kind!=='import')mk='url(#aa)';}
    else if(doneE.has(key)){stroke='rgba(199,240,90,0.5)';w=1.4;if(kind!=='import')mk='url(#aa)';}
    else if(allE.has(key)){stroke='rgba(199,240,90,0.22)';}
    else stroke='rgba(255,255,255,0.06)';
   }
   l.setAttribute('stroke',stroke); l.setAttribute('stroke-width',w);
   if(mk)l.setAttribute('marker-end',mk); else l.removeAttribute('marker-end');
  }
  // inspector
  const act=hover||this.pin;
  this.insp.innerHTML='';
  if(act){
   const d=N[act];
   const nm=el('span','iname',d[0]);
   const rl=el('span','irealm',d[1].toUpperCase()); rl.style.color=RCOL[d[1]];
   this.insp.appendChild(nm); this.insp.appendChild(rl); this.insp.appendChild(el('span','irole',d[2]));
  }else if(scn&&cur){
   const d=N[cur];
   const nm=el('span','iname',d[0]);
   const rl=el('span','irealm',d[1].toUpperCase()); rl.style.color=RCOL[d[1]];
   this.insp.appendChild(nm); this.insp.appendChild(rl); this.insp.appendChild(el('span','irole',d[2]));
  }else{
   this.insp.appendChild(el('span','hint','// selected runtime topology — solid = import · arrow = data · dashed = control · dotted = ipc'));
  }
 }
 disconnectedCallback(){clearTimeout(this.timer);}
}
function el(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;if(tag==='button')e.type='button';return e;}
customElements.define('rifty-arch',RiftyArch);
})();
