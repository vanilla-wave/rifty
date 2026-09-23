# child-process-advanced-ipc-serialization — evidence

Oracle: host Node **v24.16.0** (darwin arm64), npm 11.17.0. Browser: Chromium
**148.0.7778.96** (Playwright `chromium-1223`, headless, dedicated Worker on a
COOP/COEP page, `crossOriginIsolated === true`). vitest **4.1.11** / vite
**8.0.16** tree from the goal scenario manifest. All runs 2026-09-23 on BASE
`92215e3b4f94bd20801f5d57b5e109e83f809d48`.

The four parity programs are the committed case files
`tools/node-parity-runner/cases/child_process/public-ipc-advanced{,-fault,-options,-same-realm}.case.ts`
(shared pieces: `advanced-ipc-program.ts`), plus the JSON-path Parity case 11
`public-ipc-json-refusal-text{,-same-realm}.case.ts` (`json-ipc-refusal-program.ts`,
one program for both routes). "Materialize" = write each setup
file (directory prefix dropped) plus `code` as `main.js` into one directory,
then `node main.js` there — the parity runner's Node side does the same with
its own temp layout.

## Baseline — rifty on BASE

```
$ pnpm test:parity public-ipc-advanced-options
  - option:bogus {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 'bogus'"}
  + option:bogus "forked"
  … (JSON, 1, null alike)
  - spawn-advanced-without-ipc {"send":"undefined","stdout":"plain-ran:undefined","code":0}
  - spawn-option:bogus {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 'bogus'"}
  + spawn-option:bogus "spawned"
  + spawn-advanced-without-ipc {"threw":"NotImplementedError:Not implemented: child_process.serialization.advanced (Node's advanced IPC serializer is not implemented; use default JSON)"}
$ pnpm test:parity public-ipc-json-refusal-text   (JSON path; Worker route and same-realm route alike)
  - parent:anonymous-function {…,"message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function "}
  + parent:anonymous-function {…,"message":"The \"message\" argument must be one of type string, object, number, or boolean"}
  … (parent and child: named-function, symbol, bigint alike; undefined and exit rows match)
  2 case(s) failed
$ pnpm test:parity public-ipc-advanced            (values, child-worker)
    error: physical-worker parity expected 1 typed-bootstrap Workers … constructed 0
$ same program, rifty same-realm route (diagnostic run, not committed)
    case-error:NotImplementedError:Not implemented: child_process.serialization.advanced (…)
```

`child_process.ts` `spawn()` throws `NotImplementedError('child_process.serialization.advanced')`
for any `serialization: 'advanced'` (plain spawn included) and forwards every
other value as JSON; `node-ipc-serialization.ts` words the JSON top-level
refusal without Node's `Received …` suffix (every send site: parent, Worker
child, same-realm child); `node-entry-runtime-config.ts` rejects a program launch
`ipc` other than `none`/`json`; the child's IPC keepalive is gated on
`#jsonIpc` (`process.ts` `#syncIpcKeepalive`).

## Oracle — value table both ways (values program)

`$ node main.js` (materialized `public-ipc-advanced.case.ts`), three runs byte-identical:

```
round-trip:string {"child":"string:hello","facts":null,"back":"string:hello"}
round-trip:number {"child":"number:42","facts":null,"back":"number:42"}
round-trip:boolean {"child":"boolean:true","facts":null,"back":"boolean:true"}
round-trip:null {"child":"null","facts":null,"back":"null"}
round-trip:date {"child":{"date":"1970-01-01T00:00:00.000Z"},"facts":null,"back":{"date":"1970-01-01T00:00:00.000Z"}}
round-trip:invalid-date {"child":{"date":"invalid"},"facts":null,"back":{"date":"invalid"}}
round-trip:map {"child":{"map":[["number:1","string:a"],["string:k",{"object":"Object","tag":"Object","entries":[["n","number:1"]]}]]},"facts":null,"back":{"map":[["number:1","string:a"],["string:k",{"object":"Object","tag":"Object","entries":[["n","number:1"]]}]]}}
round-trip:set {"child":{"set":["number:1","string:two",{"object":"Object","tag":"Object","entries":[["three","number:3"]]}]},"facts":null,"back":{"set":["number:1","string:two",{"object":"Object","tag":"Object","entries":[["three","number:3"]]}]}}
round-trip:regexp {"child":{"regexp":"/a/g","lastIndex":0},"facts":null,"back":{"regexp":"/a/g","lastIndex":0}}
round-trip:nested-bigint {"child":{"object":"Object","tag":"Object","entries":[["b","bigint:1"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["b","bigint:1"]]}}
round-trip:negative-zero {"child":{"object":"Object","tag":"Object","entries":[["z","number:-0"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["z","number:-0"]]}}
round-trip:nan-infinity {"child":{"array":["number:NaN","number:Infinity","number:-Infinity"],"length":3,"holes":[]},"facts":null,"back":{"array":["number:NaN","number:Infinity","number:-Infinity"],"length":3,"holes":[]}}
round-trip:undefined-in-array {"child":{"array":["undefined"],"length":1,"holes":[]},"facts":null,"back":{"array":["undefined"],"length":1,"holes":[]}}
round-trip:undefined-property {"child":{"object":"Object","tag":"Object","entries":[["u","undefined"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["u","undefined"]]}}
round-trip:sparse-array {"child":{"array":["number:1","number:3"],"length":3,"holes":[1]},"facts":null,"back":{"array":["number:1","number:3"],"length":3,"holes":[1]}}
round-trip:array-extra-property {"child":{"array":["number:1","number:2"],"length":2,"holes":[],"extra":[["foo","string:bar"]]},"facts":null,"back":{"array":["number:1","number:2"],"length":2,"holes":[],"extra":[["foo","string:bar"]]}}
round-trip:circular {"child":{"object":"Object","tag":"Object","entries":[["a","number:1"],["self","ref:$"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["a","number:1"],["self","ref:$"]]}}
round-trip:shared-reference {"child":{"object":"Object","tag":"Object","entries":[["a",{"object":"Object","tag":"Object","entries":[["s","number:1"]]}],["b","ref:$.a"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["a",{"object":"Object","tag":"Object","entries":[["s","number:1"]]}],["b","ref:$.a"]]}}
round-trip:class-instance {"child":{"object":"Object","tag":"Object","entries":[["x","number:1"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["x","number:1"]]}}
round-trip:null-prototype {"child":{"object":"Object","tag":"Object","entries":[["a","number:1"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["a","number:1"]]}}
round-trip:non-enumerable {"child":{"object":"Object","tag":"Object","entries":[["visible","number:1"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["visible","number:1"]]}}
round-trip:symbol-key {"child":{"object":"Object","tag":"Object","entries":[["a","number:1"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["a","number:1"]]}}
round-trip:boxed {"child":{"array":[{"boxed":"Boolean","value":"false"},{"boxed":"Number","value":"3"},{"boxed":"String","value":"s"},{"boxed":"BigInt","value":"2"}],"length":4,"holes":[]},"facts":null,"back":{"array":[{"boxed":"Boolean","value":"false"},{"boxed":"Number","value":"3"},{"boxed":"String","value":"s"},{"boxed":"BigInt","value":"2"}],"length":4,"holes":[]}}
round-trip:error {"child":{"error":"Error","name":"Error","message":"boom","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"Error","name":"Error","message":"boom","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:type-error {"child":{"error":"TypeError","name":"TypeError","message":"tt","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"TypeError","name":"TypeError","message":"tt","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:range-error {"child":{"error":"RangeError","name":"RangeError","message":"r","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"RangeError","name":"RangeError","message":"r","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:error-subclass {"child":{"error":"Error","name":"Error","message":"mine","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"Error","name":"Error","message":"mine","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:error-custom-name {"child":{"error":"Error","name":"Error","message":"n","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"Error","name":"Error","message":"n","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:error-own-name-type-error {"child":{"error":"TypeError","name":"TypeError","message":"m","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"TypeError","name":"TypeError","message":"m","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:aggregate-error {"child":{"error":"Error","name":"Error","message":"agg","stack":"string","own":["message","stack"],"cause":"absent"},"facts":null,"back":{"error":"Error","name":"Error","message":"agg","stack":"string","own":["message","stack"],"cause":"absent"}}
round-trip:error-cause {"child":{"error":"Error","name":"Error","message":"outer","stack":"string","own":["cause","message","stack"],"cause":{"error":"TypeError","name":"TypeError","message":"inner","stack":"string","own":["message","stack"],"cause":"absent"}},"facts":null,"back":{"error":"Error","name":"Error","message":"outer","stack":"string","own":["cause","message","stack"],"cause":{"error":"TypeError","name":"TypeError","message":"inner","stack":"string","own":["message","stack"],"cause":"absent"}}}
round-trip:uint8array {"child":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3],"shared":false},"facts":null,"back":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3],"shared":false}}
round-trip:uint8array-own-property {"child":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3],"shared":false},"facts":null,"back":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3],"shared":false}}
round-trip:uint8array-subclass {"child":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2],"shared":false},"facts":null,"back":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2],"shared":false}}
round-trip:float64array {"child":{"view":"Float64Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,0,0,0,0,0,248,63,0,0,0,0,0,0,0,192],"shared":false},"facts":null,"back":{"view":"Float64Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,0,0,0,0,0,248,63,0,0,0,0,0,0,0,192],"shared":false}}
round-trip:float16array {"child":{"view":"Float16Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,62],"shared":false},"facts":null,"back":{"view":"Float16Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,62],"shared":false}}
round-trip:bigint64array {"child":{"view":"BigInt64Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,0,0,0,0,0,0,0,255,255,255,255,255,255,255,255],"shared":false},"facts":null,"back":{"view":"BigInt64Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,0,0,0,0,0,0,0,255,255,255,255,255,255,255,255],"shared":false}}
round-trip:dataview {"child":{"view":"DataView","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,0],"shared":false},"facts":null,"back":{"view":"DataView","isBuffer":false,"constructorIsBuffer":false,"bytes":[0,0],"shared":false}}
round-trip:arraybuffer {"child":{"arrayBuffer":[1,2,3,4,5,6,7,8]},"facts":null,"back":{"arrayBuffer":[1,2,3,4,5,6,7,8]}}
round-trip:subarray {"child":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[9,9],"shared":false},"facts":null,"back":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[9,9],"shared":false}}
round-trip:two-views-one-buffer {"child":{"object":"Object","tag":"Object","entries":[["a",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3,4,5,6],"shared":false}],["b",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[3,4,5,6,7,8],"shared":false}]]},"facts":{"bAfterWriteToA":[3,4,5,6,7,8]},"back":{"object":"Object","tag":"Object","entries":[["a",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,99,4,5,6],"shared":false}],["b",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[3,4,5,6,7,8],"shared":false}]]}}
round-trip:view-and-its-buffer {"child":{"object":"Object","tag":"Object","entries":[["buffer",{"arrayBuffer":[1,2,3,4]}],["view",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2],"shared":false}]]},"facts":{"bufferAfterWriteToView":[1,2,3,4]},"back":{"object":"Object","tag":"Object","entries":[["buffer",{"arrayBuffer":[1,2,3,4]}],["view",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[77,2],"shared":false}]]}}
round-trip:same-view-twice {"child":{"object":"Object","tag":"Object","entries":[["x",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[4,5,6],"shared":false}],["y","ref:$.x"]]},"facts":{"identical":true},"back":{"object":"Object","tag":"Object","entries":[["x",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[4,5,6],"shared":false}],["y","ref:$.x"]]}}
round-trip:map-with-view-key {"child":{"map":[[{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1],"shared":false},"string:v"]]},"facts":null,"back":{"map":[[{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1],"shared":false},"string:v"]]}}
round-trip:buffer {"child":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[97,98,99],"shared":false},"facts":null,"back":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[97,98,99],"shared":false}}
round-trip:buffer-alloc {"child":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[1,1,1],"shared":false},"facts":null,"back":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[1,1,1],"shared":false}}
round-trip:nested-buffer {"child":{"object":"Object","tag":"Object","entries":[["b",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[1,2],"shared":false}]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["b",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[1,2],"shared":false}]]}}
round-trip:own-constructor-buffer {"child":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[5],"shared":false},"facts":null,"back":{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[5],"shared":false}}
round-trip:shared-array-buffer-view {"child":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3,4],"shared":false},"facts":null,"back":{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3,4],"shared":false}}
round-trip:vitest:start {"child":{"object":"Object","tag":"Object","entries":[["type","string:start"],["poolId","number:1"],["workerId","number:0"],["__vitest_worker_request__","boolean:true"],["options",{"object":"Object","tag":"Object","entries":[["reportMemory","boolean:false"]]}],["context",{"object":"Object","tag":"Object","entries":[["environment",{"object":"Object","tag":"Object","entries":[["name","string:node"],["options","null"]]}],["config",{"object":"Object","tag":"Object","entries":[["mode","string:test"],["maxWorkers","undefined"],["setupFiles",{"array":[],"length":0,"holes":[]}],["defines",{"object":"Object","tag":"Object","entries":[]}]]}]]}]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["type","string:start"],["poolId","number:1"],["workerId","number:0"],["__vitest_worker_request__","boolean:true"],["options",{"object":"Object","tag":"Object","entries":[["reportMemory","boolean:false"]]}],["context",{"object":"Object","tag":"Object","entries":[["environment",{"object":"Object","tag":"Object","entries":[["name","string:node"],["options","null"]]}],["config",{"object":"Object","tag":"Object","entries":[["mode","string:test"],["maxWorkers","undefined"],["setupFiles",{"array":[],"length":0,"holes":[]}],["defines",{"object":"Object","tag":"Object","entries":[]}]]}]]}]]}}
round-trip:vitest:fetch-request {"child":{"object":"Object","tag":"Object","entries":[["m","string:fetch"],["a",{"array":["string:/src/sum.ts","string:/project/src/sum.test.ts","string:ssr",{"object":"Object","tag":"Object","entries":[["cached","boolean:false"],["startOffset","undefined"]]},"undefined"],"length":5,"holes":[]}],["t","string:q"],["i","string:aPH8akppJ9-emVNoCVaab"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["m","string:fetch"],["a",{"array":["string:/src/sum.ts","string:/project/src/sum.test.ts","string:ssr",{"object":"Object","tag":"Object","entries":[["cached","boolean:false"],["startOffset","undefined"]]},"undefined"],"length":5,"holes":[]}],["t","string:q"],["i","string:aPH8akppJ9-emVNoCVaab"]]}}
round-trip:vitest:reply {"child":{"object":"Object","tag":"Object","entries":[["t","string:s"],["i","string:sR5A-QOT0zXmxWAI7nJfw"],["r","undefined"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["t","string:s"],["i","string:sR5A-QOT0zXmxWAI7nJfw"],["r","undefined"]]}}
round-trip:vitest:collected {"child":{"object":"Object","tag":"Object","entries":[["m","string:onCollected"],["a",{"array":[{"array":[{"object":"Object","tag":"Object","entries":[["id","string:-1749414643"],["name","string:src/sum.test.ts"],["type","string:suite"],["mode","string:run"],["tasks",{"array":[{"object":"Object","tag":"Object","entries":[["id","string:-1749414643_0"],["name","string:passes"],["suite","undefined"],["each","undefined"],["type","string:test"],["file","ref:$.a[0][0]"],["timeout","number:5000"],["retry","undefined"],["meta",{"object":"Object","tag":"Object","entries":[]}],["annotations",{"array":[],"length":0,"holes":[]}]]}],"length":1,"holes":[]}],["meta",{"object":"Object","tag":"Object","entries":[]}],["shuffle","undefined"],["file","ref:$.a[0][0]"]]}],"length":1,"holes":[]}],"length":1,"holes":[]}],["t","string:q"],["i","string:WN4686iK_l184MbUoa42k"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["m","string:onCollected"],["a",{"array":[{"array":[{"object":"Object","tag":"Object","entries":[["id","string:-1749414643"],["name","string:src/sum.test.ts"],["type","string:suite"],["mode","string:run"],["tasks",{"array":[{"object":"Object","tag":"Object","entries":[["id","string:-1749414643_0"],["name","string:passes"],["suite","undefined"],["each","undefined"],["type","string:test"],["file","ref:$.a[0][0]"],["timeout","number:5000"],["retry","undefined"],["meta",{"object":"Object","tag":"Object","entries":[]}],["annotations",{"array":[],"length":0,"holes":[]}]]}],"length":1,"holes":[]}],["meta",{"object":"Object","tag":"Object","entries":[]}],["shuffle","undefined"],["file","ref:$.a[0][0]"]]}],"length":1,"holes":[]}],"length":1,"holes":[]}],["t","string:q"],["i","string:WN4686iK_l184MbUoa42k"]]}}
round-trip:vitest:finished {"child":{"object":"Object","tag":"Object","entries":[["type","string:testfileFinished"],["__vitest_worker_response__","boolean:true"],["error","undefined"],["usedMemory","undefined"]]},"facts":null,"back":{"object":"Object","tag":"Object","entries":[["type","string:testfileFinished"],["__vitest_worker_response__","boolean:true"],["error","undefined"],["usedMemory","undefined"]]}}
getter {"child":{"object":"Object","tag":"Object","entries":[["g","string:got"]]},"calls":1}
refused:undefined {"class":"TypeError","name":"TypeError","code":"ERR_MISSING_ARGS","message":"The \"message\" argument must be specified"}
refused:top-function {"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function "}
refused:top-symbol {"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type symbol (Symbol(m))"}
refused:top-bigint {"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type bigint (1n)"}
refused:nested-function {"class":"Error","name":"Error","code":null,"message":"fn() {} could not be cloned."}
refused:nested-arrow {"class":"Error","name":"Error","code":null,"message":"() => 1 could not be cloned."}
refused:nested-symbol {"class":"Error","name":"Error","code":null,"message":"Symbol(x) could not be cloned."}
refused:proxy {"class":"Error","name":"Error","code":null,"message":"#<Object> could not be cloned."}
refused:top-proxy {"class":"Error","name":"Error","code":null,"message":"#<Object> could not be cloned."}
refused:promise {"class":"Error","name":"Error","code":null,"message":"#<Promise> could not be cloned."}
refused:weakmap {"class":"Error","name":"Error","code":null,"message":"#<WeakMap> could not be cloned."}
refused:weakref {"class":"Error","name":"Error","code":null,"message":"#<WeakRef> could not be cloned."}
refused:generator {"class":"Error","name":"Error","code":null,"message":"[object Generator] could not be cloned."}
refused:intl {"class":"Error","name":"Error","code":null,"message":"#<NumberFormat> could not be cloned."}
refused:shared-array-buffer {"class":"Error","name":"Error","code":null,"message":"#<SharedArrayBuffer> could not be cloned."}
refused-getter-order {"error":{"class":"Error","name":"Error","code":null,"message":"() => {} could not be cloned."},"before":1,"after":0}
refused-throwing-getter {"class":"TypeError","name":"TypeError","code":null,"message":"getter-boom"}
after-refusals {"object":"Object","tag":"Object","entries":[["ok","boolean:true"]]}
child-refusals [["undefined",{"class":"TypeError","name":"TypeError","code":"ERR_MISSING_ARGS","message":"The \"message\" argument must be specified"}],["top-function",{"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function "}],["top-symbol",{"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type symbol (Symbol(child))"}],["top-bigint",{"class":"TypeError","name":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type bigint (1n)"}],["nested-function",{"class":"Error","name":"Error","code":null,"message":"fn() {} could not be cloned."}],["nested-symbol",{"class":"Error","name":"Error","code":null,"message":"Symbol(x) could not be cloned."}],["proxy",{"class":"Error","name":"Error","code":null,"message":"#<Object> could not be cloned."}],["promise",{"class":"Error","name":"Error","code":null,"message":"#<Promise> could not be cloned."}],["weakmap",{"class":"Error","name":"Error","code":null,"message":"#<WeakMap> could not be cloned."}],["shared-array-buffer",{"class":"Error","name":"Error","code":null,"message":"#<SharedArrayBuffer> could not be cloned."}]]
child:buffer {"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[99,104,105,108,100],"shared":false}
child:nested-buffer {"object":"Object","tag":"Object","entries":[["data",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[1,2],"shared":false}],["n","undefined"]]}
child:uint8array {"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[3,4],"shared":false}
child:map-set-date {"object":"Object","tag":"Object","entries":[["m",{"map":[["string:k",{"set":["number:1"]}]]}],["d",{"date":"1970-01-02T00:00:00.000Z"}]]}
child:error-cause {"error":"RangeError","name":"RangeError","message":"child-outer","stack":"string","own":["cause","message","stack"],"cause":{"error":"Error","name":"Error","message":"child-inner","stack":"string","own":["message","stack"],"cause":"absent"}}
child:shared-view {"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[7,8,9],"shared":false}
child:two-views {"object":"Object","tag":"Object","entries":[["a",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3,4],"shared":false}],["b",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[3,4,5,6],"shared":false}]]}
child:circular-task {"object":"Object","tag":"Object","entries":[["id","string:t"],["meta",{"object":"Object","tag":"Object","entries":[]}],["suite","undefined"],["file","ref:$"]]}
child-held-by-message-listener {"exitCode":null,"connected":true}
exit-after-disconnect {"code":0,"signal":null}
```

Readings: every intrinsic V8 type keeps its type; class instances and
null-prototype objects arrive as plain `Object`; non-enumerable and symbol keys
drop; a getter runs once; an Error keeps `message`/`stack`/`cause`, maps its
`name` to a native constructor only for the six native names
(`MyErr`/`Custom`/`AggregateError` → `Error`); typed-array own properties drop;
a `Uint8Array` subclass arrives as `Uint8Array`; `Buffer` (and a view whose own
`constructor` is `Buffer`) arrives as `Buffer`; two views over one buffer arrive
independent (write to `a` leaves `b` unchanged) and independent of a sent
`ArrayBuffer`; the same view twice stays one object; a SharedArrayBuffer-backed
view arrives as an unshared copy; top-level `undefined` → `ERR_MISSING_ARGS`,
top-level function/symbol/bigint → `ERR_INVALID_ARG_TYPE` with Node's
`Received …` text; nested refused values → plain `Error` `<x> could not be
cloned.` (no `code`), getters before the refusal run and after it do not, a
throwing getter's own error propagates, the channel stays usable; the child
side refuses identically; a child with only a `'message'` listener is still
running after 300 ms idle and exits 0 after the parent disconnects.

## Oracle — process-boundary faults (fault program)

`$ node main.js` (materialized `public-ipc-advanced-fault.case.ts`), three runs byte-identical:

```
echo-replies [["mutated-after-send",{"object":"Object","tag":"Object","entries":[["list",{"array":["number:1","number:2"],"length":2,"holes":[]}],["nested",{"object":"Object","tag":"Object","entries":[["k","string:v"]]}]]}],["shared-view-written-after-send",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2,3],"shared":false}],["buffer-written-after-send",{"object":"Object","tag":"Object","entries":[["buffer",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[107,101,101,112],"shared":false}]]}],["before-refusal","number:1"],["last","number:2"]]
refusal {"class":"Error","name":"Error","code":null,"message":"fn() {} could not be cloned."}
echo-exit {"code":0,"signal":null}
burst-then-natural-exit {"events":[["message",{"object":"Object","tag":"Object","entries":[["n","number:1"],["u","undefined"]]}],["message",{"object":"Object","tag":"Object","entries":[["n","number:2"],["b",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[98,117,114,115,116],"shared":false}]]}],["message",{"array":["number:3",{"map":[["string:k","string:v"]]}],"length":2,"holes":[]}],["disconnect",false],["exit",0,null]],"sendAfterExit":false}
crash-after-send {"events":[["message",{"object":"Object","tag":"Object","entries":[["a","number:1"],["u","undefined"]]}],["message",{"object":"Object","tag":"Object","entries":[["b",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[120],"shared":false}]]}],["disconnect",false],["exit",1,null]],"sendAfterExit":false}
```

A message is fixed at `send()` (later writes to the object, a
SharedArrayBuffer view and a Buffer are not seen); a refused send posts nothing
and keeps order; a child that ends naturally or crashes (`throw` in a timer)
after sending delivers its messages, then `'disconnect'`, then `'exit'` (0 /
1); `send()` after exit returns `false` (Node also emits an async
`ERR_IPC_CHANNEL_CLOSED` `'error'`, absorbed by the program's listener and not
printed — the JSON path's same gap is unchanged here).

## Oracle — the option (options program)

`$ node main.js` (materialized `public-ipc-advanced-options.case.ts`):

```
option:bogus {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 'bogus'"}
option:JSON {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 'JSON'"}
option:1 {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 1"}
option:null {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received null"}
spawn-option:bogus {"class":"TypeError","code":"ERR_INVALID_ARG_VALUE","message":"The property 'options.serialization' must be one of: undefined, 'json', 'advanced'. Received 'bogus'"}
spawn-advanced-without-ipc {"send":"undefined","stdout":"plain-ran:undefined","code":0}
```

A plain `spawn` validates `serialization` like `fork` (three runs byte-identical,
2026-09-23 re-run with the `spawn-option` row).

## Oracle — JSON top-level refusal text (Parity case 11)

`$ node --version` → `v24.16.0`; `$ node main.js` (materialized
`public-ipc-json-refusal-text.case.ts`; the same-realm case materializes to the
identical program), three runs byte-identical:

```
parent:undefined {"class":"TypeError","code":"ERR_MISSING_ARGS","message":"The \"message\" argument must be specified"}
parent:anonymous-function {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function "}
parent:named-function {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function namedFn"}
parent:symbol {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type symbol (Symbol(parent))"}
parent:bigint {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type bigint (1n)"}
child:undefined {"class":"TypeError","code":"ERR_MISSING_ARGS","message":"The \"message\" argument must be specified"}
child:anonymous-function {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function "}
child:named-function {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received function namedFn"}
child:symbol {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type symbol (Symbol(child))"}
child:bigint {"class":"TypeError","code":"ERR_INVALID_ARG_TYPE","message":"The \"message\" argument must be one of type string, object, number, or boolean. Received type bigint (1n)"}
exit {"code":0,"signal":null}
```

Default JSON serialization words its top-level refusals exactly as the
advanced values program does (`refused:top-*`, `child-refusals`), on both
sides; a function's name follows `Received function`.

## Oracle — same-realm program

`$ node main.js` (materialized `public-ipc-advanced-same-realm.case.ts`):

```
refused {"class":"Error","code":null,"message":"fn() {} could not be cloned."}
child-saw {"object":"Object","tag":"Object","entries":[["list",{"array":["number:1"],"length":1,"holes":[]}],["map",{"map":[["string:k",{"set":["number:1"]}]]}],["date",{"date":"1970-01-01T00:00:00.000Z"}],["u","undefined"],["buffer",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[104,105],"shared":false}],["bytes",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2],"shared":false}],["error",{"error":"TypeError","name":"TypeError","message":"t","stack":"string","own":["message","stack"],"cause":"absent"}],["circular",{"object":"Object","tag":"Object","entries":[["name","string:c"],["self","ref:$.circular"]]}]]}
echo {"object":"Object","tag":"Object","entries":[["list",{"array":["number:1","string:child-write"],"length":2,"holes":[]}],["map",{"map":[["string:k",{"set":["number:1"]}]]}],["date",{"date":"1970-01-01T00:00:00.000Z"}],["u","undefined"],["buffer",{"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[104,105],"shared":false}],["bytes",{"view":"Uint8Array","isBuffer":false,"constructorIsBuffer":false,"bytes":[1,2],"shared":false}],["error",{"error":"TypeError","name":"TypeError","message":"t","stack":"string","own":["message","stack"],"cause":"absent"}],["circular",{"object":"Object","tag":"Object","entries":[["name","string:c"],["self","ref:$.circular"]]}]]}
from-child {"view":"Buffer","isBuffer":true,"constructorIsBuffer":true,"bytes":[99,104,105,108,100],"shared":false}
parent-object-after-reply {"array":["number:1","string:parent-write"],"length":2,"holes":[]}
echo-is-not-sent-object true
exit 0
events ["disconnect"]
```

## Oracle — values rifty refuses by name (ceilings)

```
$ node ceilings-node.cjs   (fork echo child, advanced; send each {label, value})
blob {"v":{}}                                   ← Node Blob → plain object
dom-exception {"v": Error, message "", own ["stack"]}
url {"v":{}}
message-port {"v":{}}
detached-array-buffer THREW Error: An ArrayBuffer is detached and could not be cloned.
detached-view THREW TypeError: Cannot perform Construct on a detached ArrayBuffer
getter-beside-buffer {"count":1,"data":Buffer [120]}
getter-returns-buffer {"data":Buffer [120]}
getter-beside-float64array {"count":1,"numbers":Float64Array}
$ node main.cjs            (browser-unit ceiling program, `ceilingProgram`; echo child replies with each label; three runs identical)
CEIL|blob|sent
CEIL|file|sent
CEIL|dom-exception|sent
CEIL|url|sent
CEIL|abort-controller|sent
CEIL|text-encoder|sent
CEIL|headers|sent
CEIL|message-port|sent
CEIL|detached-array-buffer|Error:An ArrayBuffer is detached and could not be cloned.
CEIL|detached-view|TypeError:Cannot perform Construct on a detached ArrayBuffer
CEIL|getter-beside-buffer|sent
CEIL|after|true
CEIL|received|["blob","file","dom-exception","url","abort-controller","text-encoder","headers","message-port","getter-beside-buffer","after"]
$ fork + send({ wasm: new WebAssembly.Module(<8-byte empty module>) })
child exit 1: "Error: Unable to deserialize cloned data." (receiver crashes)
```

## Oracle — received view layout (not claimed)

```
$ node layout.cjs   (child reports byteOffset / buffer.byteLength of received views)
single-view  {"off":38,"bufLen":43,"len":3}
buffer-pool  {"off":38,"bufLen":43,"len":3,"isBuffer":true}   (Buffer.from('abc'))
two-views    {"sameBuffer":true,"aOff":40,"bOff":53,"bufLen":63,"bAfterWriteA":[3,4,5,6,7,8]}
view-and-ab  {"sameAb":false,"abLen":8,"abAfter":[1,2,3,4,5,6,7,8]}
```

A received view sits inside the per-message deserialization buffer at a
wire-format offset (Node `v8.js` `DefaultDeserializer._readHostObject`); the
offset and the shared backing are framing artifacts, like Buffer pool offsets.

## Oracle — traversal side effects and precedence

```
$ node traps.cjs
proxy with ownKeys/get/getOwnPropertyDescriptor/getPrototypeOf traps → "#<Object> could not be cloned.", no trap ran
getter before a nested function: before=1, after=0; successful send with one getter: calls=1
{ s: SharedArrayBuffer, f() {} } → "#<SharedArrayBuffer> could not be cloned."
{ f() {}, s: SharedArrayBuffer } → "f() {} could not be cloned."
```

The first refused value in V8 traversal order names the error.

## Chromium 148 structured clone (dedicated Worker, COI)

`$ node chromium-probe.cjs` (Playwright; `structuredClone` / `MessagePort#postMessage` inside the Worker):

Clone results:
```
errorSubclass: {"error": "Error", "name": "Error", "message": "mine", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}
namedError: {"error": "Error", "name": "Error", "message": "n", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}
ownNameType: {"error": "TypeError", "name": "TypeError", "message": "m", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}
aggError: {"error": "Error", "name": "Error", "message": "agg", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}
errCause: {"error": "Error", "name": "Error", "message": "outer", "hasStack": true, "ownKeys": ["cause", "message", "stack"], "cause": {"error": "TypeError", "name": "TypeError", "message": "inner", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}, "extra": "none"}
rangeError: {"error": "RangeError", "name": "RangeError", "message": "r", "hasStack": true, "ownKeys": ["message", "stack"], "cause": "none", "extra": "none"}
classInstance: {"obj": "Object", "tag": "Object", "props": [["x", "num:1"]]}
float16: {"view": "Float16Array", "isBuffer": false, "len": 2, "bytes": [0, 62], "shared": false, "own": []}
domException: {"error": "DOMException", "name": "AbortError", "message": "dm", "hasStack": false, "ownKeys": [], "cause": "none", "extra": "none"}
blob: {"obj": "Blob", "tag": "Blob", "props": []}
regexpLastIndex: {"re": "/a/g", "lastIndex": 0}
boxed: {"arr": [{"boxed": "Boolean", "v": "false"}, {"boxed": "Number", "v": "3"}, {"boxed": "String", "v": "s"}, {"boxed": "BigInt", "v": "2"}], "len": 4, "holes": []}
```
Errors (`DOMException` `DataCloneError`, code 25):
```
fn: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': fn() {} could not be cloned."
arrow: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': () => 1 could not be cloned."
sym: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': Symbol(x) could not be cloned."
proxy: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': #<Object> could not be cloned."
promise: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': #<Promise> could not be cloned."
weakmap: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': #<WeakMap> could not be cloned."
gen: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': [object Generator] could not be cloned."
intl: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': #<NumberFormat> could not be cloned."
url: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': URL object could not be cloned."
port: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': A MessagePort could not be cloned because it was not transferred."
abort: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': AbortController object could not be cloned."
textenc: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': TextEncoder object could not be cloned."
headers: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': Headers object could not be cloned."
detached: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': An ArrayBuffer is detached and could not be cloned."
detachedView: DataCloneError "Failed to execute 'structuredClone' on 'WorkerGlobalScope': An ArrayBuffer is detached and could not be cloned."
postMessageFn: DataCloneError "Failed to execute 'postMessage' on 'MessagePort': fn() {} could not be cloned."
sabClone:  "no-throw"
```
```
sabShared: {"same": false, "viewShared": false, "isSab": true}      ← new SAB object, same memory
twoViews:  {"same": true, "aOff": 0, "bOff": 2, "len": 8}       ← clone keeps one backing buffer
getterOrder: before=1 after=0; proxyTraps: []
```

Readings: V8 decides the same types, Error mapping, getter order and refusal
text in both runtimes; Chromium prefixes `Failed to execute '<op>' on '<iface>': `,
throws a `DOMException`, clones platform objects (`Blob`, `DOMException`) or
refuses them with Blink text (`URL object could not be cloned.`, `A MessagePort
could not be cloned because it was not transferred.`), shares SharedArrayBuffer
memory, and keeps views on one cloned backing buffer (Buffer → `Uint8Array`).

## Node-host structured clone (the parity runner's rifty side)

```
$ node -e "structuredClone({v}) for URL, AbortController, TextEncoder, Headers, Blob, MessagePort, Buffer, SharedArrayBuffer, DOMException"
url DataCloneError "Cannot clone object of unsupported type."
ac ok [object Object]         te ok [object Object]
headers DataCloneError "Cannot clone object of unsupported type."
blob ok [object Blob]          dom ok [object DOMException]
port DataCloneError "Object that needs transfer was found in message but not listed in transferList"
buf ok [object Uint8Array]     sab ok [object SharedArrayBuffer]
$ node -e "detached view / buffer"  → both DataCloneError "An ArrayBuffer is detached and could not be cloned."
```

## vitest 4.1.11 forks-pool traffic (Node)

```
$ NODE_OPTIONS="--require ipc-spy.cjs" node node_modules/vitest/vitest.mjs run   (scenario project)
fork: node_modules/vitest/dist/workers/forks.js, serialization 'advanced',
      execArgv [--experimental-import-meta-resolve, --require …/suppress-warnings.cjs, --conditions node, --conditions development]
value kinds (per direction, summed): Array, Object, null-prototype Object, boolean, number, string, undefined (30 child→parent, 43 parent→child);
no Buffer, typed array, Map, Set, Date, RegExp, Error or getter.
 Tests  1 failed | 1 passed (2)   [exit 1]
$ NODE_OPTIONS="--require ipc-dump.cjs" … (util.inspect of each frame; samples)
P->C { t: 's', i: 'sR5A-QOT0zXmxWAI7nJfw', r: undefined }
C->P { m: 'fetch', a: [ '/src/sum.ts', '<root>/src/sum.test.ts', 'ssr', { cached: false, startOffset: undefined }, undefined ], t: 'q', i: 'aPH8akppJ9-emVNoCVaab' }
C->P { m: 'onCollected', a: [ [ <ref *1> { …, tasks: [ { …, file: [Circular *1], meta: [Object: null prototype] {} } ], meta: [Object: null prototype] {}, file: [Circular *1] } ] ], t: 'q', i: … }
C->P { type: 'testfileFinished', __vitest_worker_response__: true, error: undefined, usedMemory: undefined }
```

The pool needs `undefined` members and arguments kept and circular task
graphs accepted — JSON would drop the first and throw on the second.

## Keepalive (Node)

```
$ node listen2.cjs   (child: process.on('message', m => process.send({echo:m})) only)
EV send1 true / EV message {"echo":1} / EV connected true null (after 300 ms) / EV message {"echo":2}
EV disconnect / EV stdout "child-disconnect\n" / EV exit 0 null
$ node main.cjs      (v24.16.0; default JSON; child: process.on('disconnect', …) only; parent disconnects at 300 ms)
alive-after-300ms true true
child-disconnect
exit 0 null
```

A `'disconnect'` listener alone holds the child too; rifty counts only
`'message'` — a discovery outside this unit (contract Decisions).
