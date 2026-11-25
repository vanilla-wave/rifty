#!/usr/bin/env bash
# Key rows of life.mjs on Linux (arm64 container, Node 24, isolated-vm 7.0.2 prebuilt).
# The guest bundle, the Node-side realm module and the host bridge are built on the host by
# `LIFE_PREBUILT_OUT=<dir> node life.mjs <node_modules> prebuild`; the container only needs
# isolated-vm. Usage: ./linux.sh <four-library node_modules> <prebuilt dir> [sections...]
set -euo pipefail
NM=$1; PRE=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd)
docker run --rm --cpus 4 -m 6g \
  -v "$HERE":/probe:ro -v "$NM":/nm:ro -v "$PRE":/pre:ro \
  -e LIFE_PREBUILT=/pre -e LIMIT -e N -e ARMS -e K -e MEMW -e HN -e WL -e PAUSE -e TK -e TR \
  node:24.16.0-bookworm bash -c "
    set -e; mkdir -p /w && cd /w && npm init -y >/dev/null && npm i --silent isolated-vm@7.0.2 >/dev/null
    cp /probe/life.mjs /w/life.mjs && mkdir -p /w/attacks && cp /probe/attacks/* /w/attacks/
    node --no-node-snapshot --expose-gc /w/life.mjs /nm $*"
