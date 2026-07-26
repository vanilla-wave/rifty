# Sass 1.100.0 Node selector probe

Recorded 2026-07-26 on Node v24.16.0 against exact `sass@1.100.0`.
`sass.dart.js` SHA-256:
`f558f0ddc8031343d8351e61ca0b364fb6143679b17b85cbd9be04b5ed74965f`.

```sh
SASS_ROOT=./node_modules/.pnpm/sass@1.100.0/node_modules/sass
node -e "const fs=require('node:fs'); const root=process.env.SASS_ROOT; const source=fs.readFileSync(root+'/sass.dart.js','utf8'); console.log(process.version); console.log(require(root+'/package.json').version); console.log(source.includes(\"typeof process !== \\\"undefined\\\" && (process.versions || {}).hasOwnProperty('node')\")); delete process.release; const sass=require(root); try { sass.compileString('@use \"__rifty_missing__\";'); } catch (e) { console.log(String(e.message).split('\\n')[0]); }"
```

```text
v24.16.0
1.100.0
true
Can't find stylesheet to import.
```

Removing `process.release` preserves Sass's Node filesystem path. Removing the
actual selector as well switches to the browser path:

```sh
SASS_ROOT=./node_modules/.pnpm/sass@1.100.0/node_modules/sass
node -e "const root=process.env.SASS_ROOT; delete process.release; delete process.versions.node; const sass=require(root); try { sass.compileString('@use \"__rifty_missing__\";'); } catch (e) { console.log(String(e.message).split('\\n')[0]); }"
```

```text
Unsupported operation: 'Uri.base' is not supported
```

Conclusion: Sass 1.100.0 selects Node through `process.versions.node`;
`process.release.name` is not a prerequisite.
