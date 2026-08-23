# npm 11 package-bin normalization probe

Recorded 2026-08-23 on Node v24.16.0 / npm 11.17.0. The executable uses
only local packed tarballs and an isolated npm cache. It compares npm's active
`@npmcli/package-json@7.0.5` normalizer with the legacy
`npm-normalize-package-bin@5.0.0`, then records fresh install and offline
lockfile replay.

## Reproduce

```sh
node docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json
shasum -a 256 \
  docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe.mjs \
  docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json
```

Probe SHA-256:
`b9abfcf54d7b4d51d268ecdfb26a091f53d36cc971d0ba99602541fc68502362`.
Golden SHA-256:
`48b78f60588f22069fb4bf4706b51af62051e574d807bc2927a84c1dc5eb194d`.

Pinned npm sources:

| Source | SHA-256 |
|---|---|
| `@npmcli/package-json@7.0.5/lib/normalize.js` | `ba75d512103e404d6125fb658211069f3eb0db0d6687d499130cd86a2b817014` |
| `npm-normalize-package-bin@5.0.0/lib/index.js` | `5d5fb5cae6d9c04079c01e6e1978de69d19c77ff160f523df462d08bca44b2dd` |

## Result

npm's active authority is `@npmcli/package-json`, not the legacy package.
That distinction is observable:

- `{ "bad/name": "renamed-first.js", "name": "canonical-second.js" }`
  keeps the first target because normalization mutates the input object;
- target colons are separators: `C:\\bin\\drive.js` becomes
  `C/bin/drive.js`, while the legacy helper keeps `C:/bin/drive.js`;
- string, string-array, and object forms become one command/target map;
  scoped string commands use the package basename;
- slash, backslash, and colon command keys become their basename; dot,
  absolute, parent-traversal, and backslash target segments are rooted and
  collapsed inside the package;
- empty/falsy/primitive top-level forms, empty keys/targets, and non-string
  object targets are removed; basename collisions follow the in-place
  iteration recorded by the golden;
- a non-string array member throws Node `ERR_INVALID_ARG_TYPE` before a map is
  produced.

Packed package manifests remain byte-faithful to the tarball's raw `bin`
metadata. Fresh and offline replay nevertheless write the same normalized lock
map and the same relative `.bin` symlink targets. Rifty's no-symlink carrier
(ADR-0050) must therefore preserve that command/target identity while retaining
its existing exact launcher-shim bytes.
