#!/bin/sh
# Route B product shape, in-process parts: generate, check primordials, Bp columns (run.mjs, parity.mjs), zlib-diff.
# usage: sh run.sh REPO NODE_SRC ZLIB_PROBE_DIR ZLIB_DEPS ZLIB_BUILD OUT_DIR   (absolute paths; run from REPO; OUT_DIR: scratch)
# Product build (results/route-b-product-build.txt, the P columns): a throwaway worktree at b1270101a,
#   rm packages/runtime-js/src/builtins/fs-streams.ts (the patch recreates it); git apply wiring.patch; cp bindings.ts packages/io/src/streams/node/;
#   node generate.mjs REPO NODE_SRC packages/io/src/streams/node/generated --minify; pnpm build:libs;
#   pnpm test:client-bundles; RESULTS=… node --import tsx ../../run.mjs <worktree>; parity.mjs <worktree> NODE_SRC stream.
set -e
REPO=$1 NODE_SRC=$2 ZP=$3 ZD=$4 ZB=$5 T=$6
HERE=$(cd "$(dirname "$0")" && pwd)
GEN=$T/gen/node-streams.js
node "$HERE/generate.mjs" "$REPO" "$NODE_SRC" "$T/gen"
node --expose-internals --no-warnings --import tsx "$HERE/check-primordials.mts" "$GEN"
RESULTS=$T/programs ROUTE_B_GEN=$GEN node --import tsx "$HERE/../../run.mjs" "$REPO" "$NODE_SRC"
ROUTE_B_GEN=$GEN node --import tsx "$HERE/../parity.mjs" "$REPO" "$NODE_SRC" stream > "$T/parity-stream.txt"
ROUTE_B_GEN=$GEN node --import tsx "$HERE/../parity.mjs" "$REPO" "$NODE_SRC" fs stream > "$T/parity-fs.txt"
ROUTE_B_GEN=$GEN node "$HERE/../zlib-diff-b.mjs" "$ZP" "$ZD" "$ZB" "$REPO" "$NODE_SRC" > "$T/zlib-diff.txt"
ROUTE_B_GEN=$GEN ZLIB_RIFTY_BUFFER=1 node "$HERE/../zlib-diff-b.mjs" "$ZP" "$ZD" "$ZB" "$REPO" "$NODE_SRC" > "$T/zlib-diff-rifty-buffer.txt"
