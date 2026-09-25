---
area: npm-client
status: draft
title: Dependency and override spec classification follows npm-package-arg for case-insensitive `npm:`, tarball files and `@scope/pkg` directories
created: 2026-09-24
why: `unsupportedDependencySpec` checks only lowercase `npm:` and has no tarball-file or `@scope/…` directory reading, so specs npm reads as alias/file/directory reach the registry path and fail as a misleading `No matching version`/404 instead of the named non-registry ceiling
sources: [docs/adr/npm-client/0451-user-override-values-follow-npm-version-and-range-reading.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md, docs/backlog/npm-client/tar-symlink-and-nonregistry-dep-tracking.md, docs/public/compat/package-tooling.md]
code: [packages/npm-client/src/installer-request.ts, packages/npm-client/src/overrides.ts]
---

## Context

REV-12 discovery of `npm-client/reference/overrides-bare-version-spec-evidence.md`
(vitest-run-in-browser item 1; ADR-0451 §Divergences "`@scope/pkg` and
`*.tgz`/`*.tar(.gz)` values … uppercase `NPM:` aliases read as a package
name"); the same classifier guards `dependencies`, so it is not
override-only.
`installer-request.ts` `unsupportedDependencySpec`: `spec.startsWith('npm:')`
(case-sensitive), path/`file:`/`workspace:`/git/`http(s):`/GitHub-shorthand
checks only.

npm-package-arg 13.0.2 (bundled with npm 11.17.0, node v24.16.0), probe
2026-09-24 `npa.resolve('ms', spec)`:

```
NPM:vite@8 / Npm:vite@8    → alias (subSpec vite@8)
8.0.16.tgz / vite-8.0.16.tgz / foo.tar.gz / x.tar → file
@scope/pkg                 → directory
```

Rifty: none matches a ceiling, so the spec continues as a registry range
(dependency) or, for overrides, a registry read. Override probe 2026-09-25
`resolveOverride('vite', undefined, {vite: V})`:

```
8.0.16.tgz      → {name:'vite', range:'8.0.16.tgz'}  (ADR-0451 decision 5: loose range; npm semver validRange → 8.0.1-6.tgz)
vite-8.0.16.tgz → {name:'vite-8.0.16.tgz', range:null}  (decision 6: package name)
NPM:vite@8      → {name:'NPM:vite', range:'8'}       (decision 4)
```

`8.0.16.tgz` then fails `No matching version` (rifty `matchesRange`
matches no version against it, `8.0.16` included); non-version names 404.
`@scope/pkg` as an override value is also a rifty-dialect question (`npm-client/overrides-rifty-dialect-vs-npm`); as a dependency
spec it has no rifty meaning.

## Next

Owner npm-client. Trigger: a manifest using one of these spellings, or
the next dependency-spec unit (`npm-client/tar-symlink-and-nonregistry-dep-tracking`
owns the supported-install contract). Parity first: npa type per spelling
→ rifty's named `npm-client.dependency-spec.<npm-alias|file>` ceiling
before any registry read. In `overrides.ts` `userOverride` the npa-kind
check runs before `isLooseSemverRange`: npa tests file extensions before
semver (`npa.js` `resolve`: `isFileType` ahead of `fromRegistry`).
