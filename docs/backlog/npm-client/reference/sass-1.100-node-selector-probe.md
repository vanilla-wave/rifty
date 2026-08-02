# Sass 1.100.0 Node selector probe

Corrected 2026-08-02 on official Node v24.0.0 against exact
`sass@1.100.0`. `sass.dart.js` SHA-256:
`f558f0ddc8031343d8351e61ca0b364fb6143679b17b85cbd9be04b5ed74965f`.

The pinned source contains two selectors:

```text
13: var dartNodeIsActuallyNode = typeof process !== "undefined" &&
      (process.versions || {}).hasOwnProperty('node');
8520: isNodeJs() {
8521:   var t1 = self.process;
8525:     t1 = J.get$release$x(t1);
8526:     t1 = t1 == null ? null : J.get$name$x(t1);
8528:   return J.$eq$(t1, "node");
```

Reproduction uses an ordinary exact install and a missing path so the path API,
not only string compilation, must select Node:

```sh
npm install --prefix /tmp/rifty-sass-selector --ignore-scripts \
  --no-audit --no-fund sass@1.100.0
RIFTY_SASS_PROBE_ROOT=/tmp/rifty-sass-selector/node_modules/sass \
node -e "const root=process.env.RIFTY_SASS_PROBE_ROOT; const sass=require(root); try { sass.compile('/tmp/rifty-no-such.scss'); } catch (e) { console.log(e.message.split('\\n')[0]); }"
RIFTY_SASS_PROBE_ROOT=/tmp/rifty-sass-selector/node_modules/sass \
node -e "delete process.release; const root=process.env.RIFTY_SASS_PROBE_ROOT; const sass=require(root); try { sass.compile('/tmp/rifty-no-such.scss'); } catch (e) { console.log(e.message.split('\\n')[0]); }"
RIFTY_SASS_PROBE_ROOT=/tmp/rifty-sass-selector/node_modules/sass \
node -e "delete process.versions.node; const root=process.env.RIFTY_SASS_PROBE_ROOT; const sass=require(root); try { sass.compile('/tmp/rifty-no-such.scss'); } catch (e) { console.log(e.message.split('\\n')[0]); }"
```

```text
/tmp/rifty-no-such.scss: no such file or directory
The compile() method is only available in Node.js.
Unsupported operation: 'Uri.base' is not supported
```

The earlier probe deleted `process.release` but exercised only
`compileString()` with a missing import. That path still reports `Can't find
stylesheet to import.` and therefore did not prove filesystem-path selection.
Conclusion: Sass 1.100.0 requires both `process.versions.node` for its bootstrap
and `process.release.name === 'node'` for the Node path API.

The exact runtime identity was pinned separately with the official Node
v24.0.0 Darwin arm64 archive:

```sh
curl -fsSL \
  https://nodejs.org/download/release/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz \
  -o /tmp/node-v24.0.0-darwin-arm64.tar.gz
tar -xzf /tmp/node-v24.0.0-darwin-arm64.tar.gz -C /tmp
/tmp/node-v24.0.0-darwin-arm64/bin/node -e \
  "console.log(JSON.stringify({release:process.release,outer:Object.getOwnPropertyDescriptor(process,'release'),inner:Object.fromEntries(Object.keys(process.release).map(key=>[key,Object.getOwnPropertyDescriptor(process.release,key)])),extensible:Object.isExtensible(process.release),frozen:Object.isFrozen(process.release)}))"
```

The output contains only `name`, `sourceUrl`, and `headersUrl`; the outer and
three inner descriptors are `{writable:false, enumerable:true,
configurable:true}`, while `extensible` is `true` and `frozen` is `false`.
Those exact Node v24.0.0 values and descriptors are the ADR-0345 regression
contract.
