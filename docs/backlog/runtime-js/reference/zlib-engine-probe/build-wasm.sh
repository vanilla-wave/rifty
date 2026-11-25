#!/bin/sh
# Build Node v24.16.0's deps/zlib (Chromium fork) to wasm32, no SIMD (Node's own CPU_NO_SIMD branch
# of zlib.gyp), no WASI imports. Toolchain NOT pinned: whatever Homebrew llvm + lld + wasi-libc + wasi-runtimes
# + binaryen are installed (probe run: llvm 23.1.6, wasi-libc 34, binaryen 133).
# usage: build-wasm.sh DEPS OUT_DIR
set -eu
DEPS=${1:?usage: build-wasm.sh DEPS OUT}
OUT=${2:?usage: build-wasm.sh DEPS OUT}
Z="$DEPS/node-src/node-v24.16.0/deps/zlib"
CLANG=/opt/homebrew/opt/llvm/bin/clang
SYSROOT=/opt/homebrew/share/wasi-sysroot
mkdir -p "$OUT"
EXPORTS="deflateInit2_ inflateInit2_ deflate inflate deflateEnd inflateEnd deflateReset inflateReset deflateParams deflateSetDictionary inflateSetDictionary crc32 adler32 zlibVersion malloc free"
EXP=""
for e in $EXPORTS; do EXP="$EXP -Wl,--export=$e"; done
# shellcheck disable=SC2086
"$CLANG" --target=wasm32-wasip1 --sysroot="$SYSROOT" -mexec-model=reactor -O2 -DCPU_NO_SIMD -DHAVE_HIDDEN \
  -Wno-implicit-fallthrough -Wno-deprecated-non-prototype -I"$Z" \
  "$Z/adler32.c" "$Z/crc32.c" "$Z/deflate.c" "$Z/inflate.c" "$Z/inftrees.c" "$Z/inffast.c" \
  "$Z/trees.c" "$Z/zutil.c" "$Z/cpu_features.c" \
  -Wl,--no-entry $EXP -Wl,--strip-all -o "$OUT/zlib-raw.wasm"
wasm-opt -O3 "$OUT/zlib-raw.wasm" -o "$OUT/zlib.wasm"
for f in zlib-raw.wasm zlib.wasm; do echo "$f $(wc -c < "$OUT/$f" | tr -d ' ') B"; done
echo "zlib.wasm sha256 $(shasum -a 256 "$OUT/zlib.wasm" | cut -d' ' -f1)"
