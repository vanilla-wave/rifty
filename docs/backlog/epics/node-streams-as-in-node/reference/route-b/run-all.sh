#!/bin/sh
# Route B probe, all parts; writes ../results/route-b-*.txt (and run.mjs's per-program files with the B column).
# usage: sh run-all.sh REPO NODE_SRC ZLIB_PROBE_DIR ZLIB_DEPS ZLIB_BUILD
#   NODE_SRC: node-v24.16.0 extracted from the sha256-pinned tarball (zlib probe fetch.sh);
#   ZLIB_*: the zlib goal's probe dir copy and its fetch.sh/build-wasm.sh outputs.
set -e
REPO=$1 NODE_SRC=$2 ZP=$3 ZD=$4 ZB=$5
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../results
node --import tsx "$HERE/../run.mjs" "$REPO" "$NODE_SRC"
node --import tsx "$HERE/parity.mjs" "$REPO" "$NODE_SRC" stream > "$OUT/route-b-parity-stream.txt"
node --import tsx "$HERE/parity.mjs" "$REPO" "$NODE_SRC" fs stream > "$OUT/route-b-parity-fs-streams.txt"
node "$HERE/zlib-diff-b.mjs" "$ZP" "$ZD" "$ZB" "$REPO" "$NODE_SRC" > "$OUT/route-b-zlib-diff.txt"
T=$(mktemp -d)
cp "$HERE/bench.cjs" "$T/"
{
  echo "node $(node --version), median of 5 (order of magnitude)"
  echo "## node"; node "$T/bench.cjs"
  echo "## route A (rifty streams today, in-process)"; node --import tsx "$HERE/../inproc.mts" "$REPO" "$T" bench.cjs
  echo "## route B (Node stream core verbatim, in-process)"; ROUTE_B=1 NODE_SRC="$NODE_SRC" node --expose-internals --no-warnings --import tsx "$HERE/../inproc.mts" "$REPO" "$T" bench.cjs
} > "$OUT/route-b-bench.txt"
rm -rf "$T"
sh "$HERE/size.sh" "$REPO" "$NODE_SRC" > "$OUT/route-b-size.txt"
