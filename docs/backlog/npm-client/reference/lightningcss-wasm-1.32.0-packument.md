# lightningcss-wasm 1.32.0 registry projection

Captured 2026-07-26 from the configured primary npm registry:

```sh
curl -fsSL https://registry.npmjs.org/lightningcss-wasm/1.32.0 |
  jq '{name, version, dist: {integrity: .dist.integrity}, dependencies: (.dependencies // {}), optionalDependencies: (.optionalDependencies // {}), peerDependencies: (.peerDependencies // {}), bundleDependencies: (.bundleDependencies // .bundledDependencies // [])}'
```

```json
{
  "name": "lightningcss-wasm",
  "version": "1.32.0",
  "dist": {
    "integrity": "sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ=="
  },
  "dependencies": {
    "napi-wasm": "^1.0.1"
  },
  "optionalDependencies": {},
  "peerDependencies": {},
  "bundleDependencies": [
    "napi-wasm"
  ]
}
```

The recipe projection must therefore preserve the required
`napi-wasm@^1.0.1` range and its bundled membership. Empty fake-registry
metadata is not evidence for this package.
