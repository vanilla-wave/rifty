# Packed Workbench Vite consumer

External framework-free host used only through published package surfaces. The
acceptance harness replaces every dependency with a locally packed `.tgz`,
installs with an empty offline npm cache, runs TypeScript and a Vite production
build, then boots that production artifact in real Chromium.

The page opens the generic root, deploys the four documented generic worker
subpaths, creates exact Vite 7.3.6, and calls `.run()`. Chromium awaits
`window.__RIFTY_PACKED_WORKBENCH__`, proves runtime-asset readiness, loads
`previewUrl`, calls `writeMessage()` for HMR proof, and finally `close()`.

Run from the repository root:

```sh
pnpm test:packed-consumer
```

Set `RIFTY_PACKED_CONSUMER_REGISTRY_PORT` to an unused loopback port when a
matched before/after response-byte gate requires the exact same origin.

The harness supplies `RIFTY_PACKED_CONSUMER_REGISTRY_TARGET` from a loopback
registry built from the committed Vite snapshot plus the catalog-pinned exact
esbuild tarball. The fixture itself contains no external registry URL.
