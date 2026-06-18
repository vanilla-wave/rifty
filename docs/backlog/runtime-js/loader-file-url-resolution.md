---
area: runtime-js
status: active
title: Resolve file://-URL specifiers in the loader resolver
created: 2026-06-18
why: prettier and tools using import(pathToFileURL(file).href) load config (.prettierrc.{js,mjs,ts}) and --plugin via computed file:// URLs; resolver.ts throws UNSUPPORTED_PROTOCOL today
user_story: As a dev running `prettier --write file.js --config .prettierrc.mjs` or `--plugin ./my-plugin.js`, I want prettier to load config/plugins via file:// URLs against the VFS — instead of failing with UNSUPPORTED_PROTOCOL.
sources: [ADR-0009, ADR-0150]
code: [packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/esm.ts]
---

## Context

`resolver.ts` recognises `node:` and relative/bare specifiers but has no handler for `file://` URLs. `pathToFileURL(file).href` (from `node:url`) is a standard Node idiom for constructing an absolute specifier from a filesystem path. prettier uses it to load config files and external plugins via `import(pathToFileURL(configPath).href)`. Without `file://` support, any prettier invocation that touches config or plugins throws `UNSUPPORTED_PROTOCOL` at the resolver boundary.

Baseline `prettier --write file.js` (no config, no plugin) does NOT need this; config/plugin invocations do. This is the third of three blockers for end-to-end prettier support.

## Options or Next

In `resolver.ts`, add a `file://` branch: strip the `file://` origin, normalise the path, resolve against the VFS root. Handle both absolute paths (`file:///project/src/foo.mjs`) and paths that are already VFS-relative. Validate against the VFS before handing off to the ESM loader.

Dependency order: `[[patch-function-import-routing]]` → `[[loader-file-url-resolution]]` → end-to-end prettier. `[[child-realm-async-lifecycle]]` must also be in place (all three together unblock baseline prettier).

## Reversibility

REVERSIBLE — additive resolver capability; no existing protocol handling changes. No ADR required; CHANGELOG entry on landing.
