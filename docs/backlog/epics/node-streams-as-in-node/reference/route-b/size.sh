#!/bin/sh
# File-level size estimate (esbuild --minify, gzip -9): Node's verbatim stream core (each file wrapped as
# a module function, as a bundler emits it) and lib/internal/fs/streams.js vs rifty's io streams bundle
# and fs-streams.ts. Not a client-bundle measurement (bindings and tree-shaking not included).
# usage: sh size.sh REPO NODE_SRC   (absolute paths; esbuild runs from a temp dir: run from the repo root,
# `--external:../*` also matches the entry's own siblings and the bundle comes out near-empty)
set -e
REPO=$1 L=$2/lib E=$1/node_modules/.bin/esbuild T=$(mktemp -d)
wrap() { echo 'var M={};'; for f in "$@"; do printf 'M["%s"]=function(exports,require,module,process,internalBinding,primordials){\n' "$(basename "$f")"; cat "$f"; printf '\n};\n'; done; }
row() { "$E" "$2" --minify --log-level=error > "$T/x.min"; echo "$1 | min $(wc -c < "$T/x.min" | tr -d ' ') | gzip $(gzip -9c "$T/x.min" | wc -c | tr -d ' ')"; }
cd "$T"
CORE=$(ls "$L"/internal/streams/*.js | grep -v fast-utf8-stream)
wrap $CORE "$L/stream.js" "$L/stream/promises.js" > "$T/core.js"
echo "node v24.16.0 source; esbuild $("$E" --version)"
row "verbatim core: internal/streams/* (without fast-utf8-stream), stream.js, stream/promises.js" "$T/core.js"
row "verbatim lib/internal/fs/streams.js" "$L/internal/fs/streams.js"
for f in operators compose duplexify; do row "  of which internal/streams/$f.js" "$L/internal/streams/$f.js"; done
"$E" "$REPO/packages/io/src/streams/index.ts" --bundle --format=esm --minify --log-level=error --external:'../*' > "$T/r.min"
echo "rifty packages/io/src/streams (bundle, siblings external) | min $(wc -c < "$T/r.min" | tr -d ' ') | gzip $(gzip -9c "$T/r.min" | wc -c | tr -d ' ')"
"$E" "$REPO/packages/runtime-js/src/builtins/fs-streams.ts" --bundle --format=esm --minify --log-level=error --external:'@riftydev/*' --external:'./*' > "$T/f.min"
echo "rifty runtime-js fs-streams.ts | min $(wc -c < "$T/f.min" | tr -d ' ') | gzip $(gzip -9c "$T/f.min" | wc -c | tr -d ' ')"
rm -rf "$T"
