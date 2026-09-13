# Public agent release-readiness evidence

Checked 2026-09-14 against main `8889e9d5e` and npm registry.

## Registry and dependency facts

```text
$ npm view @riftydev/agent version --json
E404 Not Found

$ npm view @earendil-works/pi-agent-core@0.85.1 name version license dist.integrity --json
@earendil-works/pi-agent-core  0.85.1  MIT
sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==

$ npm view @earendil-works/pi-ai@0.85.1 name version license dist.integrity --json
@earendil-works/pi-ai  0.85.1  MIT
sha512-+VgVIJDkDO2efYJKEEqvPTH4zmnIaXdAppGbO+vKFA9qy5PdhFiAenuFAkU+oiCSfOC4dMHDyrjdQeL4ZoC5CQ==
```

The existing release filter already includes every `packages/*` directory.
`first-publish.sh --only` and `setup-trusted-publishers.sh --only` cover one new
name after its manifest becomes non-private.

## Native Pi seam

Published Pi 0.85.1 declares:

```text
StreamFn = (model: Model<Api>, context: Context, options?: SimpleStreamOptions)
  => AssistantMessageEventStream | Promise<AssistantMessageEventStream>
Context = { systemPrompt?: string; messages: Message[]; tools?: Tool[] }
```

`SimpleStreamOptions` carries `signal`. Pi's Agent supplies an `unknown` model
when no initial model is configured. Assistant messages carry actual `api`,
`provider`, `model`, `usage` and stop metadata. Therefore native `StreamFn`
already supplies the required callback boundary; another rifty callback type
would duplicate it.

## Current rifty gaps

- `packages/agent/src/types.ts`: `settings` is mandatory even with `streamFn`.
- `packages/agent/src/session.ts`: model and URL are created before stream
  selection; trace config always records those initial settings.
- `packages/agent/src/tools.ts`: shell text is only stdout+stderr and preview text
  only the response body; status/exit/error/worker/effects and HTTP status remain
  in `details`.
- Pi OpenAI serialization reads tool text but does not carry arbitrary `details`;
  quiet shell exit 0/nonzero/cancelled and empty preview 200/500 therefore collapse
  to the same model-facing text.
- The agent error formatter contains Playground proxy configuration, although
  the package is otherwise framework/product-neutral.

The landed packed consumer already includes `@riftydev/agent` and exercises a
real tarball-installed Workbench/no-COI flow. New proof must target only the
custom-without-settings contract and next-turn outcome text; it must not replace
that existing acceptance.

## RDY-6 final written-result check

PASS 2026-09-14 by fresh read-only reviewer
`/root/agent_publish_scope_final_2`: original request, raw evidence, ready item
and ADR agree; no consumer-specific names/paths/schema entered the repo; actual
publish remains confirm-first. Reviewed content identities: item `3d0c99b`,
evidence before this record `286c3e1`, ADR-0436 `cec6fae`.

## Contract RED

```text
$ pnpm exec vitest run packages/agent/src/session.test.ts packages/agent/src/publishing.test.ts
Vitest 2.1.9: 2 files failed, 6 tests failed
- private manifest rejected
- custom stream without settings dereferenced missing settings
- missing/mixed transport had no explicit admission error
- generic network error contained Playground proxy guidance
- four quiet shell outcomes produced identical empty text
- empty preview 200/500 produced identical empty text

$ pnpm --filter @riftydev/agent typecheck
exit 0
```

The REDs exercise the desired public entry, native Pi loop, standard tool result
boundary and generated manifest. They fail on the current product behavior, not
an import or fixture failure.
