# npm 11 same-command bin collision probe

Recorded 2026-07-28 on Node v24.16.0 / npm 11.17.0. The executable discovers
npm through `PATH` and its sources through `npm root -g`; the golden pins the
resolved runtime instead of a workstation path.

## Reproduce

All package installs use local packed tarballs and an isolated npm cache. The
one labelled directory-link case is retained only to show why a `file:`
directory is not an oracle for ordinary package reification.

```sh
node docs/backlog/npm-client/reference/npm-11-bin-collision-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/npm-11-bin-collision-probe-output.json
node docs/backlog/npm-client/reference/npm-11-bin-collision-probe.mjs \
  | shasum -a 256
shasum -a 256 docs/backlog/npm-client/reference/npm-11-bin-collision-probe.mjs
```

Two independent executions produced output SHA-256
`1b5315b57b49aeff1b745fc0d41c7942cb793db3858e94512a7bfa9b72a338f1`.
Probe source SHA-256:
`7e7d9887e0956a8c0e690826d8cac4a76ad7e2fc97d95b74504c0dfc11247e7e`.

Pinned source-library hashes:

| npm 11.17.0 source | SHA-256 |
|---|---|
| Arborist `rebuild.js` 9.8.0 | `1db859afb29e7e93531ba1f3933558468c7192569d581820ad1721001a0396cd` |
| Arborist `reify.js` 9.8.0 | `356e1b8f7663f32dfbd4355bf33f896eb9e6475b76e0287d245f0127475ee85b` |
| `bin-links/link-gently.js` 6.0.2 | `8e6e03105afe13f84f4efebdbe7e301f1e94c0f9b907989a4f473a4f4458997c` |
| `@isaacs/string-locale-compare/index.js` 1.1.0 | `cd6025c8f45932da9c61fac350542414cfbf2bad9f01f9ca78aa84f038e4a390` |

## Result

The previous lexical-package-name rule is false. Fresh installs and full
`npm rebuild` sort Arborist's bin queue by node depth, then
`@isaacs/string-locale-compare('en')(node.path)`. The `bin-links` invocation
keeps the first claim for each destination. Consequently:

- `a_a` beats `a-a`, independent of manifest insertion order;
- `@scope/a_a` beats `@scope/a-a`;
- `@zz/provider` beats bare `a-a`;
- root and nested `node_modules/.bin` scopes resolve independently.

Reify lifecycle is also observable authority, not an implementation detail:

- an ordinary packed-tarball ADD/CHANGE processes the added package, so adding
  `a_a` replaces `a-a` and adding `a-a` replaces `a_a`;
- a following no-op install preserves that result; full `npm rebuild`
  re-evaluates all packages and returns to the depth/path queue winner;
- removing either contender leaves the shared launcher absent at the end of
  that install; the next install or rebuild links the survivor;
- a direct `file:` directory link is rebuilt on every install and therefore
  does not establish packed-package incremental behavior.

The oracle therefore specifies a reify action set, scope, queue comparator, and
collision lifecycle. It does not justify “lexical minimum package name” or
“reconcile every install”.
