#!/bin/sh
# Whole probe: fetch → build → every measurement → results/*.txt. Needs Node v24.16.0, the repo's
# pnpm install, Homebrew llvm lld wasi-libc wasi-runtimes binaryen; ~45 min on M3 Pro (bundles: 3 builds).
# usage: run-all.sh DEPS BUILD   (two empty dirs outside the repo)
set -eu
DEPS=${1:?usage: run-all.sh DEPS BUILD}
BUILD=${2:?usage: run-all.sh DEPS BUILD}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
R="$HERE/results"
mkdir -p "$R"
sh "$HERE/fetch.sh" "$DEPS"
(cd "$DEPS/node-src" && tar xJf node-v24.16.0.tar.xz --include='node-v24.16.0/test/parallel/test-zlib*' --include='node-v24.16.0/test/common/*' --include='node-v24.16.0/test/fixtures/*')
mkdir -p "$DEPS/consumers" && (cd "$DEPS/consumers" && npm init -y >/dev/null && npm install --ignore-scripts --no-audit --no-fund pdfkit@0.17.2 pngjs@7.0.0 >/dev/null)
sh "$HERE/build-wasm.sh" "$DEPS" "$BUILD" > "$R/build-wasm.txt"
cd "$HERE"
node cases.mjs "$DEPS" "$BUILD" > "$R/cases.txt"
node highlevel.mjs "$DEPS" > "$R/highlevel.txt"
node node-suite.mjs "$DEPS" "$BUILD" > "$R/node-suite.txt"
node consumers.mjs "$DEPS" "$BUILD" "$REPO" > "$R/consumers.txt"
node bench-node.mjs "$DEPS" "$BUILD" > "$R/bench-node.txt"
node bench-isolate.mjs "$DEPS" "$BUILD" "$REPO" > "$R/bench-isolate.txt"
node bench-browser.mjs "$DEPS" "$BUILD" "$REPO" > "$R/bench-browser.txt"
node bench-bridge.mjs "$REPO" > "$R/bench-bridge.txt"
node --expose-gc memory.mjs "$DEPS" "$BUILD" > "$R/memory.txt"
node streams-cap.mjs "$DEPS" "$BUILD" > "$R/streams-cap.txt"
node --import tsx guest-wasm.mjs "$REPO" > "$R/guest-wasm.txt"
for v in none pako wasm none; do echo "== $v"; sh measure-bundles.sh "$REPO" "$DEPS" "$BUILD" "$v"; done > "$R/bundles.txt" 2>&1
node --import tsx main-red.mjs "$REPO" > "$R/main-red.txt"
node --import tsx transform-path.mjs "$DEPS" "$BUILD" "$REPO" > "$R/transform-path.txt"
# chromium108.mjs: needs the floor lane runner (README §Run), not run here.
