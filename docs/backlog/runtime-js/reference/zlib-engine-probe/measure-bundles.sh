#!/bin/sh
# Bundle cost of each engine, measured on the real build: temporarily wire the engine into
# runtime-js's eager zlib module (a reachable `__probeEngine` member), then run the client-bundle
# gate and the isolate guest build. Restores both files on exit. Run on a clean tree.
# usage: measure-bundles.sh REPO DEPS BUILD none|pako|wasm
set -eu
REPO=${1:?}; DEPS=${2:?}; BUILD=${3:?}; VARIANT=${4:?}
ZT="$REPO/packages/runtime-js/src/builtins/zlib.ts"
PROBE="$REPO/packages/runtime-js/src/builtins/zlib-probe-engine.ts"
restore() { git -C "$REPO" checkout -- packages/runtime-js/src/builtins/zlib.ts; rm -f "$PROBE"; }
trap restore EXIT
case "$VARIANT" in
  none) ;;
  pako)
    { echo '// @ts-nocheck'; cat "$DEPS/pako3/package/dist/pako.mjs"; } > "$PROBE" ;;
  wasm)
    { echo '// @ts-nocheck'
      printf "const B64 = '%s';\n" "$(base64 < "$BUILD/zlib.wasm" | tr -d '\n')"
      cat <<'EOF'
let mod;
export function instance() {
  if (!mod) { const s = atob(B64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); mod = new WebAssembly.Module(b); }
  const x = new WebAssembly.Instance(mod, {}).exports; x._initialize(); return x;
}
EOF
    } > "$PROBE" ;;
  *) echo "variant: none|pako|wasm" >&2; exit 2 ;;
esac
if [ "$VARIANT" != none ]; then
  printf "import * as probeEngine from './zlib-probe-engine.ts';\n" | cat - "$ZT" > "$ZT.tmp" && mv "$ZT.tmp" "$ZT"
  node -e 'const f=process.argv[1],fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/^  codes: ZLIB_CODES,$/m,"  codes: ZLIB_CODES,\n  __probeEngine: probeEngine,"))' "$ZT"
  grep -q '__probeEngine' "$ZT"
fi
(cd "$REPO" && pnpm test:client-bundles 2>&1 | grep -E '^(main|sw|generic|toolchain): ')
(cd "$REPO/packages/isolate-guest" && node scripts/build-guest.mjs && printf 'guest.js %s B, gzip %s B\n' "$(wc -c < dist/guest.js | tr -d ' ')" "$(gzip -9c dist/guest.js | wc -c | tr -d ' ')")
