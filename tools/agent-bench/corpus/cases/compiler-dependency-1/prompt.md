Integrate the real compiler engine behind supplied browser UI, level1; preserve UI and implement src/engine.mjs.

Starting installed pinned Vanilla JavaScript/Vite7.3.6 starter; TypeScript5.9.2. Only level1 behavior required; level2 addition not required.

Published requirement/API/user-action boundary:


Provided accessible controls: Source editor, Target select `es2015/es2020`,
Compile action, named read-only JavaScript/Diagnostics outputs. Level2 Compiler
select `typescript/esbuild`; real esbuild-wasm0.28.0 asset/API required.
TypeScript5.9.2 transpileModule promises transformation/syntax diagnostics,
not semantic type checking. Valid source emits runnable JavaScript; malformed
`const = ;` produces diagnostics and clears previously published output.
Raw emitted JavaScript must match the selected pinned compiler API result; no
post-processing or replacement compiler. This is its published developer API,
not a code-style score. Actual package output goldens captured independently.
Actual source with typed box/optional chaining must execute to42 in originating
browser. Preserve supplied UI; no requirement for a different DOM layout.


Engine interface used by supplied src/main.js is public; implement it and preserve its observable workflows. Provide regression tests. Do not fake or replace the actual compiler.
