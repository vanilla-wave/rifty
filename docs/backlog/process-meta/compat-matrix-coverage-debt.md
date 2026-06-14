---
area: process-meta
status: active
title: Compat-matrix coverage debt — missing node-builtins ❌ rows and a shell/coreutils dimension in the public matrix
created: 2026-06-13
why: The public compat matrix is the M11 "honest, auditable" pitch, but it omits whole dimensions — ~42 runtime-js loud stubs have no ❌ row and there is no shell/coreutils dimension — so an adopter cannot learn from the matrix what will not run; two ADRs make ❌-registration an explicit acceptance criterion.
user_story: As a maintainer auditing the compat story, I want the matrix to carry ❌ rows for the ~42 `NotImplementedError` builtins (os/tty/tls/dns…) and a shell/coreutils dimension for the 11 `shell.<cmd>.<flag>` throws, but currently neither dimension exists so the matrix hides what won't run.
sources: [ADR-0088, ADR-0093, ADR-0010]
code: [tools/compat-matrix-generator/cli.js, packages/runtime-js/src/builtins/os.ts, packages/shell/src/commands/find.ts]
---

## Context

The generator (`cli.js`) models only `node:*` fs/streams/http; `docs/public/compat/` holds buffer/fs/http/modules/streams/wasi/incompatible-packages. Two missing dimensions:

- **node-builtins ❌ rows.** ~42 runtime-js `NotImplementedError` stubs (os/perf_hooks/tty/string_decoder/v8/tls/dns/readline + dgram/vm/crypto.Hash.copy/fs O_SYNC) throw honestly but appear in no compat row and no matrix dimension — the ❌ rows have nowhere to live, so a user reading the matrix cannot learn these are absent. The capability absence itself is tracked in `runtime-js/node-builtins-loud-stub-capability-gaps`; this is the matrix/visibility half. Add a node-builtins dimension (one page or per-module) wired into `pnpm compat:generate`; note the dns localhost-only subset honestly.
- **No shell/coreutils dimension.** ADR-0088/0093 require every unimplemented shell flag ❌-registered and named GNU-divergences captured as notes; the matrix has zero shell rows. 11 `NotImplementedError('shell.<cmd>.<flag>')` throws span find/ls/head/tail/seq/which/realpath/basename/dirname. The generator only scans `tests/conformance/`, but shell tests live at `packages/shell/tests/` with byte-fixtures at `packages/shell/fixtures/` — extend `validateMatrixSources` to accept package-level test paths (or move shell coverage under `tests/conformance/`), then emit ✅/❌ rows + a Known-Limitations block (locale sort, `wc -c` vs `-m`, `-A` vs `-a`, LS_COLORS vs hand-rolled SGR, ASCII-only column width).

## Options or Next

Add the two generator dimensions (a static skeleton can land first), regenerate at the next milestone DoD (A-033, `pnpm compat:generate`). No runtime implementation implied — this only makes honest gaps visible. Pairs with the per-feature `runtime-js/node-builtins-loud-stub-capability-gaps` item and the existing `compat-matrix-test-result-sink` / `compat-generate-io-tests` backlog.

## Reversibility

REVERSIBLE — generator-internal rows + new compat pages under `docs/public/compat/`, no package public API or new dep. Implementing any networked builtin (in-browser TLS/DoH) to flip a ❌ to ✅ would be IRREVERSIBLE → ADR, out of scope here.
