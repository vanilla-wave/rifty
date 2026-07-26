# npm 11 extraneous `node_modules` probe

Recorded 2026-07-26 on Node v24.16.0 / npm 11.17.0 with
`ms@2.1.3` fetched once from `https://registry.npmjs.org`, then all
reconciliation run with `--offline`.

Reproduce in a disposable directory:

```sh
probe_dir="$(mktemp -d)"
cd "$probe_dir"
npm init -y >/dev/null
npm pkg set name=rifty-npm-extraneous-probe
npm install ms@2.1.3 --save-exact --registry=https://registry.npmjs.org --no-audit --no-fund

node -e "const fs=require('node:fs'); fs.mkdirSync('node_modules/.vite-temp',{recursive:true}); fs.writeFileSync('node_modules/.vite-temp/probe.mjs',\"export default 'vite-temp-survives';\\n\"); fs.writeFileSync('node_modules/ms/rifty-probe.txt','ordinary-extraneous-byte\\n')"
npm install --offline --ignore-scripts --no-audit
node -e "const fs=require('node:fs'); console.log(JSON.stringify({ms:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs'),stray:fs.readFileSync('node_modules/ms/rifty-probe.txt','utf8').trim()}))"
shasum -a 256 package-lock.json node_modules/ms/index.js

node -e "const fs=require('node:fs'); const p='node_modules/ms/index.js'; fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('module.exports = function (val, options) {',\"module.exports = function (val, options) {\\n  return 'rifty-tampered';\"))"
node -e "console.log(JSON.stringify({before:require('ms')(1000)}))"
shasum -a 256 node_modules/ms/index.js
npm install --offline --ignore-scripts --no-audit
node -e "const fs=require('node:fs'); console.log(JSON.stringify({after:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs'),stray:fs.readFileSync('node_modules/ms/rifty-probe.txt','utf8').trim()}))"
shasum -a 256 package-lock.json node_modules/ms/index.js

node -e "require('node:fs').renameSync('node_modules/ms','.removed-ms')"
node -e "try { require('ms'); console.log(JSON.stringify({loaded:true})) } catch (error) { console.log(JSON.stringify({name:error.name,code:error.code})) }"
npm install --offline --ignore-scripts --no-audit
node -e "const fs=require('node:fs'); console.log(JSON.stringify({restored:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs')}))"
shasum -a 256 package-lock.json node_modules/ms/index.js
```

Observed output:

```text
up to date
{"ms":"1s","viteTemp":true,"stray":"ordinary-extraneous-byte"}
d8d04a934fd3ce4c04ec998170dda2b79fd676c91aef699ae9181a73ad288601  package-lock.json
e5f0b6a946a9b2b356a28557728410717df54ea2f599edb619f9839df6b7b0e9  node_modules/ms/index.js

{"before":"rifty-tampered"}
e8b58afc0b3bcd8f778356b8443fb97a09c8e8fcf533298a9badfb0feacfc90a  node_modules/ms/index.js
up to date
{"after":"rifty-tampered","viteTemp":true,"stray":"ordinary-extraneous-byte"}
d8d04a934fd3ce4c04ec998170dda2b79fd676c91aef699ae9181a73ad288601  package-lock.json
e8b58afc0b3bcd8f778356b8443fb97a09c8e8fcf533298a9badfb0feacfc90a  node_modules/ms/index.js

{"name":"Error","code":"MODULE_NOT_FOUND"}
added 1 package
{"restored":"1s","viteTemp":true}
d8d04a934fd3ce4c04ec998170dda2b79fd676c91aef699ae9181a73ad288601  package-lock.json
e5f0b6a946a9b2b356a28557728410717df54ea2f599edb619f9839df6b7b0e9  node_modules/ms/index.js
```

Conclusion: npm does not survey or repair extraneous/tampered installed bytes
for an unchanged manifest and lockfile. It executes tampered bytes, preserves
extraneous files, and restores a missing package on the next explicit install
without changing the lockfile.
