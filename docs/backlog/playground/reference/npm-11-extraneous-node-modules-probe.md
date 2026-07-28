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
npm cache add ms@2.1.2 --registry=https://registry.npmjs.org

node -e "const fs=require('node:fs'); fs.mkdirSync('node_modules/.vite-temp',{recursive:true}); fs.writeFileSync('node_modules/.vite-temp/probe.mjs',\"export default 'vite-temp-survives';\\n\"); fs.writeFileSync('node_modules/ms/rifty-probe.txt','ordinary-extraneous-byte\\n')"
npm install --offline --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node -e "const fs=require('node:fs'); console.log(JSON.stringify({ms:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs'),stray:fs.readFileSync('node_modules/ms/rifty-probe.txt','utf8').trim()}))"
shasum -a 256 package-lock.json node_modules/ms/index.js

node -e "const fs=require('node:fs'); const p='node_modules/ms/index.js'; fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('module.exports = function (val, options) {',\"module.exports = function (val, options) {\\n  return 'rifty-tampered';\"))"
node -e "console.log(JSON.stringify({before:require('ms')(1000)}))"
shasum -a 256 node_modules/ms/index.js
npm install --offline --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node -e "const fs=require('node:fs'); console.log(JSON.stringify({after:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs'),stray:fs.readFileSync('node_modules/ms/rifty-probe.txt','utf8').trim()}))"
shasum -a 256 package-lock.json node_modules/ms/index.js

node -e "require('node:fs').renameSync('node_modules/ms','.removed-ms')"
node -e "try { require('ms'); console.log(JSON.stringify({loaded:true})) } catch (error) { console.log(JSON.stringify({name:error.name,code:error.code})) }"
npm install --offline --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node -e "const fs=require('node:fs'); console.log(JSON.stringify({restored:require('ms')(1000),viteTemp:fs.existsSync('node_modules/.vite-temp/probe.mjs')}))"
shasum -a 256 package-lock.json node_modules/ms/index.js

npm pkg set dependencies.ms=2.1.2
node -e "console.log(JSON.stringify({requested:require('./package.json').dependencies.ms,installed:require('ms/package.json').version}))"
shasum -a 256 package.json package-lock.json node_modules/ms/index.js
npm install --offline --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node -e "console.log(JSON.stringify({requested:require('./package.json').dependencies.ms,installed:require('ms/package.json').version,value:require('ms')(1000)}))"
shasum -a 256 package.json package-lock.json node_modules/ms/index.js

node -e "require('node:fs').appendFileSync('package-lock.json',' \n')"
shasum -a 256 package.json package-lock.json node_modules/ms/index.js
npm install --offline --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
shasum -a 256 package.json package-lock.json node_modules/ms/index.js
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

{"requested":"2.1.2","installed":"2.1.3"}
6001e32b0cf88f7eecde0eb6fb154a01d33721b37ac0fbeb06d53e369d80c36d  package.json
d8d04a934fd3ce4c04ec998170dda2b79fd676c91aef699ae9181a73ad288601  package-lock.json
e5f0b6a946a9b2b356a28557728410717df54ea2f599edb619f9839df6b7b0e9  node_modules/ms/index.js
changed 1 package
{"requested":"2.1.2","installed":"2.1.2","value":"1s"}
6001e32b0cf88f7eecde0eb6fb154a01d33721b37ac0fbeb06d53e369d80c36d  package.json
2adcc1b31f9e0953e2811f29584a7f9bd9bd76ebc4e035f2fa8ff07ca0cb333f  package-lock.json
55986972f5f3c9446f876c576e1cd30fd4f04cd26527efbb5ad834637c740e4c  node_modules/ms/index.js

6001e32b0cf88f7eecde0eb6fb154a01d33721b37ac0fbeb06d53e369d80c36d  package.json
46235e7b42d351ff7ce7fb06b48a7f1aad5dda7e7c5dd8409a773a64e11dabfe  package-lock.json
55986972f5f3c9446f876c576e1cd30fd4f04cd26527efbb5ad834637c740e4c  node_modules/ms/index.js
up to date
6001e32b0cf88f7eecde0eb6fb154a01d33721b37ac0fbeb06d53e369d80c36d  package.json
2adcc1b31f9e0953e2811f29584a7f9bd9bd76ebc4e035f2fa8ff07ca0cb333f  package-lock.json
55986972f5f3c9446f876c576e1cd30fd4f04cd26527efbb5ad834637c740e4c  node_modules/ms/index.js
```

Conclusion: npm does not survey or repair extraneous/tampered installed bytes
for an unchanged manifest and lockfile. It executes tampered bytes, preserves
extraneous files, and restores a missing package on the next explicit install
without changing the lockfile. An exact package.json request change reconciles
the installed version and lockfile from the offline cache. A byte-only
lockfile drift is observed by the next explicit install and normalized back to
the canonical bytes without replacing the already-matching package.
