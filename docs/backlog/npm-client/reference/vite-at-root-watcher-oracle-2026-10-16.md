# Vite 7.3.6 watched dev server at project root `/` — real Node oracle (run 6)

Executed 2026-10-16 by the independent Contract+RED reviewer of
the Vite root unit (closed; ADR-0533) @ `5aa5b7dc3`
(`/tmp/rifty-review-u5/verdict.json`): `docker --context colima create --name
rifty-review-oracle-5aa5b7dc3 node:24 node /probe/probe.mjs`, project of
evidence §Root at `/`, `npm install` (vite 7.3.6, @vitejs/plugin-react 5.2.0,
react 19.2.0), then the script below as `/probe/probe.mjs`. No file is edited
during the 15 s window.

Identity: `{"version":"v24.22.0","platform":"linux","arch":"arm64"}`.

Script (verbatim):

```js
import fs from 'node:fs';
import { spawn } from 'node:child_process';
console.log('IDENTITY',JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}));
console.log('VERSIONS',JSON.stringify(Object.fromEntries(['vite','@vitejs/plugin-react','react'].map(p=>[p,JSON.parse(fs.readFileSync('/node_modules/'+p+'/package.json','utf8')).version]))));
const config=`import react from '@vitejs/plugin-react';
export default { plugins:[react()], optimizeDeps:{entries:['index.html']}, server:{watch:{ignored: (p) => p !== '/' && !/^\\/(?:src(?:\\/|$)|index\\.html$|vite\\.config\\.js$|package(?:-lock)?\\.json$|node_modules(?:\\/|$))/.test(p)}} };\n`;
fs.writeFileSync('/vite.config.js',config);
console.log('CONFIG',config);
const child=spawn(process.execPath,['--max-old-space-size=512','/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','10534','--strictPort','--debug','hmr'],{cwd:'/',stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
await Promise.race([new Promise(r=>setTimeout(r,15000)),new Promise(r=>child.once('exit',r))]);
console.log('OBSERVED_BEFORE_TERMINATION',JSON.stringify({exitCode:child.exitCode,signalCode:child.signalCode,elapsedWindowMs:15000,restartLines:log.split('\n').filter(x=>/restarting server/.test(x)),changeLines:log.split('\n').filter(x=>/\[file change\]/.test(x))}));
if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}
console.log('SERVER_LOG',log);
fs.writeFileSync('/probe/watch-small-tree-server.log',log);
```

Summary (verbatim `watch-small-tree-summary.log`):

```
IDENTITY {"version":"v24.22.0","platform":"linux","arch":"arm64"}
VERSIONS {"vite":"7.3.6","@vitejs/plugin-react":"5.2.0","react":"19.2.0"}
{
  "exitCode": null,
  "signalCode": null,
  "elapsedWindowMs": 15000,
  "restart_count": 132,
  "file_change_count": 396,
  "first_restarts": [
    "11:35:19 AM [vite] vite.config.js changed, restarting server...",
    "11:35:19 AM [vite] vite.config.js changed, restarting server...",
    "11:35:19 AM [vite] vite.config.js changed, restarting server..."
  ],
  "first_changes": [
    "2026-10-16T11:35:19.754Z vite:hmr [file change] index.html",
    "2026-10-16T11:35:19.754Z vite:hmr [file change] package-lock.json",
    "2026-10-16T11:35:19.754Z vite:hmr [file change] package.json",
    "2026-10-16T11:35:19.867Z vite:hmr [file change] index.html",
    "2026-10-16T11:35:19.867Z vite:hmr [file change] package-lock.json",
    "2026-10-16T11:35:19.867Z vite:hmr [file change] package.json"
  ]
}
```

Server log head (first 20 of 1588 lines; every restart repeats the same three
root-file changes — 132 × `index.html`, `package.json`, `package-lock.json`):

```

  VITE v7.3.6  ready in 58 ms

  ➜  Local:   http://127.0.0.1:10534/
2026-10-16T11:35:19.743Z vite:hmr [config change] vite.config.js
11:35:19 AM [vite] vite.config.js changed, restarting server...
2026-10-16T11:35:19.754Z vite:hmr [file change] index.html
2026-10-16T11:35:19.754Z vite:hmr [file change] package-lock.json
2026-10-16T11:35:19.754Z vite:hmr [file change] package.json
11:35:19 AM [vite] (client) page reload index.html
2026-10-16T11:35:19.755Z vite:hmr (ssr) [no modules matched] index.html
2026-10-16T11:35:19.755Z vite:hmr (client) [no modules matched] package-lock.json
2026-10-16T11:35:19.755Z vite:hmr (ssr) [no modules matched] package-lock.json
2026-10-16T11:35:19.755Z vite:hmr (client) [no modules matched] package.json
2026-10-16T11:35:19.755Z vite:hmr (ssr) [no modules matched] package.json
11:35:19 AM [vite] server restarted.
2026-10-16T11:35:19.866Z vite:hmr [config change] vite.config.js
11:35:19 AM [vite] vite.config.js changed, restarting server...
2026-10-16T11:35:19.867Z vite:hmr [file change] index.html
2026-10-16T11:35:19.867Z vite:hmr [file change] package-lock.json
```

Reading: with the watcher limited to the project tree, chokidar at root `/`
still re-emits the root's own files and Vite restarts on `vite.config.js`
with no edit — upstream behavior at `/`, independent of system-file churn.
Restart count, timing and the eventual OOM of runs 2-3 are not part of the
oracle. The browser-unit row uses the same config with the ignore function
taken relative to the server cwd (identical at `/`).
