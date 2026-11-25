#!/bin/sh
# Fetch every probe input, pinned by sha256, into DEPS (untrusted data; never run from there).
# usage: fetch.sh DEPS
set -eu
DEPS=${1:?usage: fetch.sh DEPS}
mkdir -p "$DEPS"

pack() { # spec dir sha256
  mkdir -p "$DEPS/$2"
  (cd "$DEPS/$2" && npm pack "$1" --silent >/dev/null && echo "$3  $(ls *.tgz)" | shasum -a 256 -c - >/dev/null && tar xzf *.tgz)
}
pack pako@1.0.11 pako1 0d4028dc0352a740c30cbfd772917f2744986d42bfa0b06ec7642bffe7ad3941
pack pako@2.2.0 pako2 62510b5d8ce95dd70942540dd5e9360dcd5b475a5cfe525be27b26d2908a2d64
pack pako@3.0.3 pako3 50623ace3ae006597034b699a643bd5295fb064eab6fcd12b6587e7292f977aa
pack fflate@0.8.3 fflate 38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92
pack zlib-wasm@1.0.7 zlib-wasm 71b3ecbb066be7b63ebc1f4a8f0da429bf72b71c9709c2e20457e1758d59b9db
pack wasm-flate@1.0.2-browser wasm-flate 40e708fadb9d2c8b107685eb93b5d67fcdd9b33f0eb626c32d54c6a88e00df47

# Node v24.16.0 source: deps/zlib (Chromium fork, zlib 1.3.1), node_zlib.cc, lib/zlib.js.
mkdir -p "$DEPS/node-src"
cd "$DEPS/node-src"
[ -f node-v24.16.0.tar.xz ] || curl -sSfLO https://nodejs.org/dist/v24.16.0/node-v24.16.0.tar.xz
echo "2ff84a6de70b6165290111b0fc656ded1ad207a799816fe720cc7c31232df30f  node-v24.16.0.tar.xz" | shasum -a 256 -c - >/dev/null
tar xJf node-v24.16.0.tar.xz node-v24.16.0/deps/zlib node-v24.16.0/src/node_zlib.cc node-v24.16.0/lib/zlib.js
echo "fetched into $DEPS"
